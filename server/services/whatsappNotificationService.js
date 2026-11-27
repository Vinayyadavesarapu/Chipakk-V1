/**
 * WhatsApp Notification Service — THE MARSHANS (Store ID 2)
 * server/services/whatsappNotificationService.js
 *
 * Implements server-side Meta WhatsApp Cloud API integration for THE MARSHANS.
 *
 * Supported Approved Meta Templates:
 * 1. marshans_order_confirmation  (Triggered on verified Razorpay payment)
 * 2. marshans_shipping_update      (Triggered when order actually shipped)
 * 3. marshans_out_for_delivery     (Triggered when courier/admin marks out for delivery)
 * 4. marshans_order_delivered      (Triggered when delivery is confirmed)
 * 5. marshans_customer_feedback    (Triggered ~24h after confirmed delivery)
 *
 * Architectural & Safety Guarantees:
 * - Multi-Store Isolation: Exclusively activated for Store ID 2. Store ID 1 (CHIPAKK)
 *   is strictly excluded and never receives WhatsApp notifications or THE MARSHANS branding.
 * - Payment Gate: Order confirmation is sent ONLY for verified PAID payments.
 *   Pending and failed payments NEVER receive the order-placed confirmation.
 * - Meta Template Approval Gating: Gated by MARSHANS_WHATSAPP_TEMPLATE_APPROVAL_STATUS.
 *   Live API calls are withheld unless status is 'APPROVED' and MARSHANS_WHATSAPP_ENABLED is true.
 * - Phone Validation: Normalizes Indian phone numbers (+91, leading 0, 10-digit mobile).
 * - Idempotency & Deduplication: In-memory lock and database unique constraint
 *   (store_id, event_type, order_id, is_custom_forge) prevent duplicate messages.
 * - Fault Tolerance: Fully non-blocking. An API or network failure NEVER fails checkout,
 *   payment reconciliation, or Admin operations.
 * - Secret Sanitization: Access tokens and credentials are never exposed in logs or API responses.
 */

const https = require('https');
const { pool } = require('../config/database');
const { normalizeIndianPhoneNumber } = require('../utils/phoneUtils');

// Supported Event Types
const EVENT_TYPES = {
  ORDER_CONFIRMATION: 'order_confirmation',
  SHIPPING_UPDATE: 'shipping_update',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  ORDER_DELIVERED: 'order_delivered',
  CUSTOMER_FEEDBACK: 'customer_feedback'
};

// In-flight mutex set to prevent concurrent duplicate sends
const inFlightLocks = new Set();

/**
 * Builds the unique lock key for an event
 */
function getLockKey(storeId, eventType, orderId, isCustomForge) {
  return `${storeId}:${eventType}:${orderId}:${isCustomForge ? 1 : 0}`;
}

/**
 * Resolves current WhatsApp configuration from environment variables
 */
function getConfig() {
  const isEnabled = process.env.MARSHANS_WHATSAPP_ENABLED === 'true' || process.env.MARSHANS_WHATSAPP_ENABLED === true;
  const rawApproval = (process.env.MARSHANS_WHATSAPP_TEMPLATE_APPROVAL_STATUS || 'PENDING').trim().toUpperCase();
  const isApproved = rawApproval === 'APPROVED';

  const phoneNumberId = (process.env.MARSHANS_WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const accessToken = (process.env.MARSHANS_WHATSAPP_ACCESS_TOKEN || '').trim();
  const wabaId = (process.env.MARSHANS_WHATSAPP_WABA_ID || '').trim();
  const languageCode = (process.env.MARSHANS_WHATSAPP_TEMPLATE_LANG || 'en').trim();
  const storefrontUrl = (process.env.MARSHANS_STOREFRONT_URL || 'https://themarshans.shop').replace(/\/$/, '');

  const templates = {
    [EVENT_TYPES.ORDER_CONFIRMATION]: (process.env.MARSHANS_WHATSAPP_TEMPLATE_ORDER_CONFIRMATION || process.env.MARSHANS_WHATSAPP_TEMPLATE_NAME || 'marshans_order_confirmation').trim(),
    [EVENT_TYPES.SHIPPING_UPDATE]: (process.env.MARSHANS_WHATSAPP_TEMPLATE_SHIPPING_UPDATE || 'marshans_shipping_update').trim(),
    [EVENT_TYPES.OUT_FOR_DELIVERY]: (process.env.MARSHANS_WHATSAPP_TEMPLATE_OUT_FOR_DELIVERY || 'marshans_out_for_delivery').trim(),
    [EVENT_TYPES.ORDER_DELIVERED]: (process.env.MARSHANS_WHATSAPP_TEMPLATE_ORDER_DELIVERED || 'marshans_order_delivered').trim(),
    [EVENT_TYPES.CUSTOMER_FEEDBACK]: (process.env.MARSHANS_WHATSAPP_TEMPLATE_CUSTOMER_FEEDBACK || 'marshans_customer_feedback').trim()
  };

  const hasCredentials = Boolean(phoneNumberId && accessToken);
  const isSendingActive = isEnabled && isApproved && hasCredentials;

  let activationState = 'ACTIVE';
  if (!isEnabled) {
    activationState = 'DISABLED';
  } else if (!hasCredentials) {
    activationState = 'CREDENTIALS_MISSING';
  } else if (!isApproved) {
    activationState = 'PENDING_APPROVAL';
  }

  return {
    isEnabled,
    approvalStatus: rawApproval,
    isApproved,
    hasCredentials,
    isSendingActive,
    activationState,
    phoneNumberId,
    accessToken,
    wabaId,
    languageCode,
    storefrontUrl,
    templates
  };
}

/**
 * Checks if live outbound sending is active for Store 2
 */
function isSendingActive(storeId) {
  if (parseInt(storeId, 10) !== 2) return false;
  const cfg = getConfig();
  return cfg.isSendingActive;
}

/**
 * Normalizes customer phone number to WhatsApp international format (e.g. 919876543210)
 */
function resolveWhatsAppRecipientPhone(rawPhone) {
  if (!rawPhone) return null;
  const check = normalizeIndianPhoneNumber(rawPhone);
  if (!check.valid || !check.phone) return null;
  return `91${check.phone}`;
}

/**
 * Resolves customer name safely
 */
function resolveCustomerName(order) {
  if (!order) return 'Customer';
  const name = order.customer_name || (order.shipping_address && typeof order.shipping_address === 'object' && order.shipping_address.name);
  if (name && typeof name === 'string' && name.trim()) {
    return name.trim();
  }
  return 'Customer';
}

/**
 * Formats rupee amount string from order data
 */
function formatOrderTotalRupees(order, isCustomForge = false) {
  if (!order) return '₹0';
  if (order.total_price_rupees !== undefined) {
    return `₹${Number(order.total_price_rupees).toLocaleString('en-IN')}`;
  }
  const rawTotal = parseInt(order.total_price, 10) || 0;
  // Store 2 prices are in paise
  const rupees = Math.round(rawTotal / 100);
  return `₹${rupees.toLocaleString('en-IN')}`;
}

/**
 * Formats payment method for customer notification
 */
function formatPaymentMethod(paymentMethod) {
  const method = String(paymentMethod || '').trim().toUpperCase();
  if (method === 'UPI') return 'UPI (Prepaid)';
  if (method === 'CARD') return 'Debit/Credit Card (Prepaid)';
  if (method === 'NETBANKING') return 'Net Banking (Prepaid)';
  if (method === 'RAZORPAY' || method === 'ONLINE') return 'Online Payment (Prepaid)';
  return 'Prepaid';
}

/**
 * Safe database helper to check if whatsapp_notification_logs table exists
 */
let tableChecked = false;
let tableExists = false;
async function checkTableExists() {
  if (tableChecked) return tableExists;
  try {
    const [rows] = await pool.execute(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'whatsapp_notification_logs' LIMIT 1"
    );
    tableExists = rows && rows.length > 0;
    tableChecked = true;
  } catch (_) {
    tableExists = false;
  }
  return tableExists;
}

/**
 * Checks if an event has already been recorded/sent for this order
 */
async function hasEventBeenRecorded(storeId, eventType, orderId, isCustomForge) {
  const hasTable = await checkTableExists();
  if (!hasTable) return false;

  try {
    const [rows] = await pool.execute(
      `SELECT id, status, meta_message_id, created_at
       FROM whatsapp_notification_logs
       WHERE store_id = ? AND event_type = ? AND order_id = ? AND is_custom_forge = ?
       LIMIT 1`,
      [storeId, eventType, orderId, isCustomForge ? 1 : 0]
    );
    return rows && rows.length > 0 ? rows[0] : false;
  } catch (err) {
    console.warn('[WhatsApp Service] Check recorded event error:', err.message);
    return false;
  }
}

/**
 * Logs or updates notification record in the database
 */
async function logNotificationRecord({
  storeId,
  orderId,
  orderNumber,
  isCustomForge,
  eventType,
  recipientPhone,
  customerName,
  templateName,
  templateLanguage,
  templateStatus,
  payload,
  metaMessageId = null,
  status = 'queued',
  errorMessage = null,
  scheduledAt = null,
  sentAt = null
}) {
  const hasTable = await checkTableExists();
  if (!hasTable) {
    return null;
  }

  try {
    const query = `
      INSERT INTO whatsapp_notification_logs (
        store_id, order_id, order_number, is_custom_forge, event_type,
        recipient_phone, customer_name, template_name, template_language,
        template_status, payload, meta_message_id, status, error_message,
        scheduled_at, sent_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        recipient_phone = VALUES(recipient_phone),
        customer_name = VALUES(customer_name),
        template_name = VALUES(template_name),
        template_status = VALUES(template_status),
        payload = VALUES(payload),
        meta_message_id = COALESCE(VALUES(meta_message_id), meta_message_id),
        status = VALUES(status),
        error_message = VALUES(error_message),
        attempts = attempts + 1,
        scheduled_at = COALESCE(VALUES(scheduled_at), scheduled_at),
        sent_at = COALESCE(VALUES(sent_at), sent_at),
        updated_at = NOW()
    `;

    const params = [
      storeId,
      orderId,
      orderNumber,
      isCustomForge ? 1 : 0,
      eventType,
      recipientPhone,
      customerName,
      templateName,
      templateLanguage,
      templateStatus,
      payload ? JSON.stringify(payload) : null,
      metaMessageId,
      status,
      errorMessage,
      scheduledAt,
      sentAt
    ];

    const [result] = await pool.execute(query, params);
    return result.insertId || result.affectedRows;
  } catch (err) {
    console.warn('[WhatsApp Service] Failed to log notification record:', err.message);
    return null;
  }
}

/**
 * Builds Meta Cloud API template parameters according to template event type
 */
function buildTemplateBodyParameters(eventType, order, isCustomForge = false, extraData = {}) {
  const customerName = resolveCustomerName(order);
  const orderNumber = String(order.order_number || '');
  const cfg = getConfig();
  const orderUrl = `${cfg.storefrontUrl}/account/orders`;

  switch (eventType) {
    case EVENT_TYPES.ORDER_CONFIRMATION: {
      const orderTotal = formatOrderTotalRupees(order, isCustomForge);
      const paymentMethod = formatPaymentMethod(order.payment_method);
      const paymentStatus = 'Paid';
      return [
        { type: 'text', text: customerName },
        { type: 'text', text: orderNumber },
        { type: 'text', text: orderTotal },
        { type: 'text', text: paymentMethod },
        { type: 'text', text: paymentStatus },
        { type: 'text', text: orderUrl }
      ];
    }

    case EVENT_TYPES.SHIPPING_UPDATE: {
      const courier = (extraData.courier || order.courier || 'Velocity Express').trim();
      const trackingNo = (extraData.tracking_no || order.tracking_no || orderNumber).trim();
      const trackingUrl = extraData.tracking_url || orderUrl;
      return [
        { type: 'text', text: customerName },
        { type: 'text', text: orderNumber },
        { type: 'text', text: courier },
        { type: 'text', text: trackingNo },
        { type: 'text', text: trackingUrl }
      ];
    }

    case EVENT_TYPES.OUT_FOR_DELIVERY: {
      let deliveryCity = 'your address';
      if (order.shipping_address && typeof order.shipping_address === 'object') {
        deliveryCity = order.shipping_address.city || order.shipping_address.state || 'your address';
      }
      return [
        { type: 'text', text: customerName },
        { type: 'text', text: orderNumber },
        { type: 'text', text: deliveryCity },
        { type: 'text', text: orderUrl }
      ];
    }

    case EVENT_TYPES.ORDER_DELIVERED: {
      const deliveryDate = extraData.delivery_date || new Date().toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
      return [
        { type: 'text', text: customerName },
        { type: 'text', text: orderNumber },
        { type: 'text', text: deliveryDate },
        { type: 'text', text: orderUrl }
      ];
    }

    case EVENT_TYPES.CUSTOMER_FEEDBACK: {
      const reviewUrl = `${cfg.storefrontUrl}/review?order=${encodeURIComponent(orderNumber)}`;
      return [
        { type: 'text', text: customerName },
        { type: 'text', text: orderNumber },
        { type: 'text', text: reviewUrl }
      ];
    }

    default:
      return [
        { type: 'text', text: customerName },
        { type: 'text', text: orderNumber }
      ];
  }
}

/**
 * Builds the complete Meta Graph API payload
 */
function buildMetaMessagePayload({ recipientPhone, templateName, languageCode, parameters = [] }) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipientPhone,
    type: 'template',
    template: {
      name: templateName,
      language: {
        code: languageCode
      },
      components: [
        {
          type: 'body',
          parameters
        }
      ]
    }
  };
}

/**
 * Executes an HTTPS POST request to Meta Cloud API
 */
async function callMetaCloudApi(payload, cfg) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    const options = {
      hostname: 'graph.facebook.com',
      port: 443,
      path: `/v21.0/${cfg.phoneNumberId}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, body: parsed });
          } else {
            const errMsg = parsed?.error?.message || `Meta API returned HTTP ${res.statusCode}`;
            const err = new Error(errMsg);
            err.statusCode = res.statusCode;
            err.metaResponse = parsed;
            reject(err);
          }
        } catch (parseErr) {
          reject(new Error(`Failed to parse Meta API response: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', (err) => { reject(err); });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Meta Cloud API request timed out (10s)'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Central notification dispatcher
 */
async function dispatchNotification({
  order,
  orderId,
  storeId,
  isCustomForge = false,
  eventType,
  extraData = {}
}) {
  try {
    const sId = parseInt(storeId, 10);

    // 1. Multi-Store Isolation Gate: Exclusively for Store 2 (THE MARSHANS)
    if (sId !== 2) {
      return {
        success: true,
        status: 'skipped',
        reason: 'STORE_ISOLATION_EXCLUDED',
        message: 'WhatsApp notifications are exclusively active for Store ID 2 (THE MARSHANS).'
      };
    }

    if (!order) {
      return {
        success: false,
        status: 'skipped',
        reason: 'ORDER_DATA_MISSING',
        message: 'Order data is required to dispatch WhatsApp notification.'
      };
    }

    const numOrderId = parseInt(orderId || order.id, 10);
    const orderNumber = String(order.order_number || '');

    // 2. In-flight lock deduplication
    const lockKey = getLockKey(sId, eventType, numOrderId, isCustomForge);
    if (inFlightLocks.has(lockKey)) {
      return {
        success: true,
        status: 'skipped',
        reason: 'IN_FLIGHT_LOCKED',
        message: `Notification for ${eventType} on order ${orderNumber} is already in flight.`
      };
    }
    inFlightLocks.add(lockKey);

    try {
      // 3. Database deduplication check
      const existing = await hasEventBeenRecorded(sId, eventType, numOrderId, isCustomForge);
      if (existing && (existing.status === 'sent' || existing.status === 'delivered')) {
        return {
          success: true,
          status: 'already_sent',
          meta_message_id: existing.meta_message_id,
          message: `Notification for ${eventType} on order ${orderNumber} has already been sent.`
        };
      }

      // 4. Resolve customer recipient phone number
      const candidatePhone = order.customer_phone ||
        (order.shipping_address && typeof order.shipping_address === 'object' && (order.shipping_address.phone || order.shipping_address.phoneNumber)) ||
        null;

      const recipientPhone = resolveWhatsAppRecipientPhone(candidatePhone);
      if (!recipientPhone) {
        await logNotificationRecord({
          storeId: sId,
          orderId: numOrderId,
          orderNumber,
          isCustomForge,
          eventType,
          recipientPhone: candidatePhone || 'UNKNOWN',
          customerName: resolveCustomerName(order),
          templateName: getConfig().templates[eventType] || 'unknown',
          templateLanguage: getConfig().languageCode,
          templateStatus: getConfig().approvalStatus,
          status: 'skipped',
          errorMessage: 'Valid Indian mobile phone number not found on order record.'
        });

        return {
          success: true,
          status: 'skipped',
          reason: 'PHONE_NUMBER_INVALID_OR_MISSING',
          message: 'Order has no valid 10-digit Indian recipient phone number.'
        };
      }

      // 5. Check configuration and gating
      const cfg = getConfig();
      const templateName = cfg.templates[eventType];
      const customerName = resolveCustomerName(order);
      const parameters = buildTemplateBodyParameters(eventType, order, isCustomForge, extraData);
      const metaPayload = buildMetaMessagePayload({
        recipientPhone,
        templateName,
        languageCode: cfg.languageCode,
        parameters
      });

      // 6. Template Approval Gate / Master Toggle Gate
      if (!cfg.isSendingActive) {
        const logStatus = cfg.activationState === 'PENDING_APPROVAL' ? 'gated' : 'skipped';
        const reasonMsg = cfg.activationState === 'PENDING_APPROVAL'
          ? `Meta template '${templateName}' is in review (${cfg.approvalStatus}). Outbound delivery held.`
          : `WhatsApp notifications are inactive (state: ${cfg.activationState}).`;

        await logNotificationRecord({
          storeId: sId,
          orderId: numOrderId,
          orderNumber,
          isCustomForge,
          eventType,
          recipientPhone,
          customerName,
          templateName,
          templateLanguage: cfg.languageCode,
          templateStatus: cfg.approvalStatus,
          payload: metaPayload,
          status: logStatus,
          errorMessage: reasonMsg
        });

        return {
          success: true,
          status: logStatus,
          activation_state: cfg.activationState,
          approval_status: cfg.approvalStatus,
          template_name: templateName,
          reason: reasonMsg
        };
      }

      // 7. Execute live dispatch to Meta Cloud API
      try {
        const apiRes = await callMetaCloudApi(metaPayload, cfg);
        const metaMessageId = apiRes.body?.messages?.[0]?.id || null;

        await logNotificationRecord({
          storeId: sId,
          orderId: numOrderId,
          orderNumber,
          isCustomForge,
          eventType,
          recipientPhone,
          customerName,
          templateName,
          templateLanguage: cfg.languageCode,
          templateStatus: cfg.approvalStatus,
          payload: metaPayload,
          metaMessageId,
          status: 'sent',
          sentAt: new Date()
        });

        return {
          success: true,
          status: 'sent',
          meta_message_id: metaMessageId,
          recipient: recipientPhone,
          template_name: templateName
        };
      } catch (sendErr) {
        console.error(`[WhatsApp Service Error] Failed to send ${eventType} to ${recipientPhone}:`, sendErr.message);

        await logNotificationRecord({
          storeId: sId,
          orderId: numOrderId,
          orderNumber,
          isCustomForge,
          eventType,
          recipientPhone,
          customerName,
          templateName,
          templateLanguage: cfg.languageCode,
          templateStatus: cfg.approvalStatus,
          payload: metaPayload,
          status: 'failed',
          errorMessage: sendErr.message
        });

        return {
          success: false,
          status: 'failed',
          error: sendErr.message
        };
      }
    } finally {
      inFlightLocks.delete(lockKey);
    }
  } catch (err) {
    console.error('[WhatsApp Service Dispatch Fatal Exception]', err);
    return {
      success: false,
      status: 'error',
      error: err.message
    };
  }
}

/**
 * 1. Order Confirmation Trigger
 * Strictly checks that payment_status is 'paid'.
 * Pending and failed payments MUST NOT receive order confirmation!
 */
async function notifyOrderConfirmation({ order, orderId, storeId = 2, isCustomForge = false, paymentUpdated = false }) {
  try {
    const sId = parseInt(storeId, 10);
    if (sId !== 2) {
      return { success: true, status: 'skipped', reason: 'STORE_ISOLATION_EXCLUDED' };
    }

    if (!order) return { success: false, status: 'skipped', reason: 'ORDER_DATA_MISSING' };

    // STRICT PAYMENT REQUIREMENT: Pending or Failed orders NEVER receive order confirmation
    const paymentStatus = String(order.payment_status || '').trim().toLowerCase();
    if (paymentStatus !== 'paid') {
      return {
        success: true,
        status: 'skipped',
        reason: 'PAYMENT_NOT_PAID',
        message: `Order payment status is '${paymentStatus}'. Confirmation message withheld until verified payment.`
      };
    }

    return dispatchNotification({
      order,
      orderId,
      storeId: sId,
      isCustomForge,
      eventType: EVENT_TYPES.ORDER_CONFIRMATION
    });
  } catch (err) {
    console.warn('[WhatsApp notifyOrderConfirmation Non-blocking Error]', err.message);
    return { success: false, status: 'error', error: err.message };
  }
}

/**
 * 2. Shipping Update Trigger
 * Triggered when order is marked shipped with tracking details
 */
async function notifyShippingUpdate({ order, orderId, storeId = 2, isCustomForge = false, trackingInfo = {} }) {
  try {
    const sId = parseInt(storeId, 10);
    if (sId !== 2) {
      return { success: true, status: 'skipped', reason: 'STORE_ISOLATION_EXCLUDED' };
    }

    return dispatchNotification({
      order,
      orderId,
      storeId: sId,
      isCustomForge,
      eventType: EVENT_TYPES.SHIPPING_UPDATE,
      extraData: trackingInfo
    });
  } catch (err) {
    console.warn('[WhatsApp notifyShippingUpdate Non-blocking Error]', err.message);
    return { success: false, status: 'error', error: err.message };
  }
}

/**
 * 3. Out for Delivery Trigger
 * Triggered when courier or Admin confirms out for delivery
 */
async function notifyOutForDelivery({ order, orderId, storeId = 2, isCustomForge = false }) {
  try {
    const sId = parseInt(storeId, 10);
    if (sId !== 2) {
      return { success: true, status: 'skipped', reason: 'STORE_ISOLATION_EXCLUDED' };
    }

    return dispatchNotification({
      order,
      orderId,
      storeId: sId,
      isCustomForge,
      eventType: EVENT_TYPES.OUT_FOR_DELIVERY
    });
  } catch (err) {
    console.warn('[WhatsApp notifyOutForDelivery Non-blocking Error]', err.message);
    return { success: false, status: 'error', error: err.message };
  }
}

/**
 * 4. Order Delivered Trigger
 * Triggered when delivery is confirmed. Also automatically schedules 24h feedback request.
 */
async function notifyOrderDelivered({ order, orderId, storeId = 2, isCustomForge = false, deliveryDate = null }) {
  try {
    const sId = parseInt(storeId, 10);
    if (sId !== 2) {
      return { success: true, status: 'skipped', reason: 'STORE_ISOLATION_EXCLUDED' };
    }

    const deliveryResult = await dispatchNotification({
      order,
      orderId,
      storeId: sId,
      isCustomForge,
      eventType: EVENT_TYPES.ORDER_DELIVERED,
      extraData: { delivery_date: deliveryDate }
    });

    // Automatically schedule feedback request for 24 hours later
    try {
      if (order) {
        const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const customerName = resolveCustomerName(order);
        const candidatePhone = order.customer_phone ||
          (order.shipping_address && typeof order.shipping_address === 'object' && (order.shipping_address.phone || order.shipping_address.phoneNumber));
        const recipientPhone = resolveWhatsAppRecipientPhone(candidatePhone);

        if (recipientPhone) {
          const numOrderId = parseInt(orderId || order.id, 10);
          const orderNumber = String(order.order_number || '');
          const cfg = getConfig();
          const templateName = cfg.templates[EVENT_TYPES.CUSTOMER_FEEDBACK];

          await logNotificationRecord({
            storeId: sId,
            orderId: numOrderId,
            orderNumber,
            isCustomForge,
            eventType: EVENT_TYPES.CUSTOMER_FEEDBACK,
            recipientPhone,
            customerName,
            templateName,
            templateLanguage: cfg.languageCode,
            templateStatus: cfg.approvalStatus,
            status: 'scheduled',
            scheduledAt
          });
        }
      }
    } catch (schedErr) {
      console.warn('[WhatsApp Schedule Feedback Warning]', schedErr.message);
    }

    return deliveryResult;
  } catch (err) {
    console.warn('[WhatsApp notifyOrderDelivered Non-blocking Error]', err.message);
    return { success: false, status: 'error', error: err.message };
  }
}

/**
 * 5. Customer Feedback Trigger
 * Dispatches customer feedback request ~24h after delivery
 */
async function notifyCustomerFeedback({ order, orderId, storeId = 2, isCustomForge = false }) {
  try {
    const sId = parseInt(storeId, 10);
    if (sId !== 2) {
      return { success: true, status: 'skipped', reason: 'STORE_ISOLATION_EXCLUDED' };
    }

    return dispatchNotification({
      order,
      orderId,
      storeId: sId,
      isCustomForge,
      eventType: EVENT_TYPES.CUSTOMER_FEEDBACK
    });
  } catch (err) {
    console.warn('[WhatsApp notifyCustomerFeedback Non-blocking Error]', err.message);
    return { success: false, status: 'error', error: err.message };
  }
}

/**
 * Worker: Process all feedback notifications that are due (scheduled_at <= NOW())
 */
async function processDueFeedbackNotifications() {
  const hasTable = await checkTableExists();
  if (!hasTable) return { processed: 0, errors: [] };

  try {
    const [dueRows] = await pool.execute(`
      SELECT
        id, store_id, order_id, order_number, is_custom_forge, recipient_phone, customer_name
      FROM whatsapp_notification_logs
      WHERE event_type = ? AND status = 'scheduled' AND scheduled_at <= NOW()
      ORDER BY scheduled_at ASC
      LIMIT 50
    `, [EVENT_TYPES.CUSTOMER_FEEDBACK]);

    let processed = 0;
    const errors = [];

    for (const row of dueRows) {
      try {
        let order = null;
        if (row.is_custom_forge) {
          const { getCustomForgeOrderByIdInternal } = require('./customForgeService');
          order = await getCustomForgeOrderByIdInternal(row.order_id);
        } else {
          const { getOrderById } = require('./orderService');
          order = await getOrderById(row.order_id, 2);
        }

        if (order) {
          await dispatchNotification({
            order,
            orderId: row.order_id,
            storeId: 2,
            isCustomForge: Boolean(row.is_custom_forge),
            eventType: EVENT_TYPES.CUSTOMER_FEEDBACK
          });
          processed++;
        }
      } catch (itemErr) {
        errors.push({ order_id: row.order_id, error: itemErr.message });
      }
    }

    return { processed, errors };
  } catch (err) {
    console.warn('[WhatsApp processDueFeedbackNotifications Warning]', err.message);
    return { processed: 0, errors: [err.message] };
  }
}

/**
 * Returns safe diagnostic information for the Admin Panel
 */
async function getWhatsAppStatus() {
  const cfg = getConfig();
  let recentLogs = [];
  const hasTable = await checkTableExists();

  if (hasTable) {
    try {
      const [rows] = await pool.execute(`
        SELECT
          id, store_id, order_number, is_custom_forge, event_type,
          CONCAT(SUBSTRING(recipient_phone, 1, 4), '****', SUBSTRING(recipient_phone, 9)) AS masked_phone,
          customer_name, template_name, status, error_message, scheduled_at, sent_at, created_at
        FROM whatsapp_notification_logs
        ORDER BY id DESC
        LIMIT 25
      `);
      recentLogs = rows;
    } catch (_) {}
  }

  return {
    service: 'marshans-whatsapp-cloud-api',
    store_id: 2,
    store_name: 'THE MARSHANS',
    activation_state: cfg.activationState,
    is_active: cfg.isSendingActive,
    template_approval_status: cfg.approvalStatus,
    is_enabled: cfg.isEnabled,
    phone_number_id_configured: Boolean(cfg.phoneNumberId),
    access_token_configured: Boolean(cfg.accessToken),
    waba_id_configured: Boolean(cfg.wabaId),
    language_code: cfg.languageCode,
    storefront_url: cfg.storefrontUrl,
    templates: cfg.templates,
    notification_table_available: hasTable,
    recent_logs: recentLogs
  };
}

module.exports = {
  EVENT_TYPES,
  getConfig,
  isSendingActive,
  resolveWhatsAppRecipientPhone,
  buildTemplateBodyParameters,
  buildMetaMessagePayload,
  dispatchNotification,
  notifyOrderConfirmation,
  notifyShippingUpdate,
  notifyOutForDelivery,
  notifyOrderDelivered,
  notifyCustomerFeedback,
  processDueFeedbackNotifications,
  getWhatsAppStatus
};
