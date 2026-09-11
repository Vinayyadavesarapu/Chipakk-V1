const pool = require('../config/database');
const razorpayService = require('./razorpayService');

/**
 * CHIPAKK — Payment Service Layer
 * 
 * Handles order payment eligibility, Razorpay payment order initiation,
 * server-side signature verification, and idempotent webhook reconciliation.
 * 
 * CORE PRINCIPLE: The browser is NEVER authoritative for payment success.
 */

/**
 * Helper: Find MySQL user by Firebase UID
 */
const findUserByFirebaseUid = async (firebaseUid, connection = pool) => {
  if (!firebaseUid) return null;
  const [rows] = await connection.execute(
    'SELECT id, email, role FROM users WHERE firebase_uid = ? LIMIT 1',
    [firebaseUid]
  );
  return rows[0] || null;
};

/**
 * Create a Gateway Payment Order for an eligible CHIPAKK order
 * 
 * @param {number|string} orderId - Internal CHIPAKK order ID
 * @param {Object} firebaseUser - Verified customer Firebase auth token payload
 */
const createPaymentOrder = async (orderId, firebaseUser) => {
  const numId = parseInt(orderId, 10);
  if (isNaN(numId) || numId <= 0) {
    const err = new Error('Invalid order ID provided.');
    err.status = 400;
    throw err;
  }

  // 1. Load order from MySQL
  const [orderRows] = await pool.execute(
    `SELECT id, order_number, customer_id, customer_email, customer_name,
            shipping_address, payment_method, payment_status, fulfillment_status,
            total_price, gateway_order_id
     FROM orders 
     WHERE id = ? 
     LIMIT 1`,
    [numId]
  );

  if (!orderRows || orderRows.length === 0) {
    const err = new Error('Order not found.');
    err.status = 404;
    throw err;
  }

  const order = orderRows[0];

  // 2. Verify order ownership
  const user = await findUserByFirebaseUid(firebaseUser.uid);
  const isOwner = (user && order.customer_id && Number(user.id) === Number(order.customer_id)) ||
                  (order.customer_email && firebaseUser.email && order.customer_email.toLowerCase() === firebaseUser.email.toLowerCase());

  if (!isOwner) {
    const err = new Error('Access denied. You do not have permission to pay for this order.');
    err.status = 403;
    throw err;
  }

  // 3. Verify payment eligibility
  if (order.payment_status === 'paid') {
    return {
      already_paid: true,
      order_id: order.id,
      order_number: order.order_number,
      payment_status: 'paid',
      message: 'This order has already been paid.'
    };
  }

  if (order.fulfillment_status === 'cancelled') {
    const err = new Error('This order has been cancelled and cannot be paid.');
    err.status = 400;
    throw err;
  }

  const totalPricePaise = parseInt(order.total_price, 10);
  if (isNaN(totalPricePaise) || totalPricePaise <= 0) {
    const err = new Error('Order total must be greater than zero to initiate payment.');
    err.status = 400;
    throw err;
  }

  // 4. Create Gateway Payment Order (amount in paise, 1:1 with DB total_price)
  const gatewayOrder = await razorpayService.createRazorpayOrder({
    amountPaise: totalPricePaise,
    receipt: order.order_number,
    notes: {
      order_id: String(order.id),
      order_number: order.order_number,
      customer_id: String(order.customer_id || '')
    }
  });

  // 5. Record gateway order ID on the order and create payment attempt record
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.execute(
      'UPDATE orders SET gateway_order_id = ?, updated_at = NOW() WHERE id = ?',
      [gatewayOrder.gateway_order_id, order.id]
    );

    // Insert payment record (safe check in case payments table exists)
    try {
      await connection.execute(
        `INSERT INTO payments (
          order_id, provider, gateway_order_id, amount, currency, status, created_at
        ) VALUES (?, 'razorpay', ?, ?, ?, 'created', NOW())`,
        [order.id, gatewayOrder.gateway_order_id, totalPricePaise, gatewayOrder.currency || 'INR']
      );
    } catch (tblErr) {
      console.warn('[PaymentService] payments table insertion notice:', tblErr.message);
    }

    await connection.commit();
  } catch (dbErr) {
    await connection.rollback();
    throw dbErr;
  } finally {
    connection.release();
  }

  // Parse phone from shipping address if available
  let phone = '';
  try {
    const addr = typeof order.shipping_address === 'string' 
      ? JSON.parse(order.shipping_address) 
      : order.shipping_address;
    phone = addr?.phone || '';
  } catch (e) {}

  // 6. Return only safe public checkout configuration to browser
  return {
    already_paid: false,
    key_id: razorpayService.getKeyId(),
    gateway_order_id: gatewayOrder.gateway_order_id,
    amount: gatewayOrder.amount, // in paise
    currency: gatewayOrder.currency || 'INR',
    order_id: order.id,
    order_number: order.order_number,
    customer_name: order.customer_name || '',
    customer_email: order.customer_email || '',
    customer_phone: phone
  };
};

/**
 * Verify Customer Payment Signature (Called by browser on successful checkout popup completion)
 * 
 * @param {Object} params
 * @param {number|string} params.order_id - Internal CHIPAKK order ID
 * @param {string} params.razorpay_order_id
 * @param {string} params.razorpay_payment_id
 * @param {string} params.razorpay_signature
 * @param {Object} firebaseUser - Verified customer Firebase auth token payload
 */
const verifyPayment = async (params, firebaseUser) => {
  const { order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature } = params;

  const numId = parseInt(order_id, 10);
  if (isNaN(numId) || numId <= 0) {
    const err = new Error('Invalid order ID provided.');
    err.status = 400;
    throw err;
  }

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    const err = new Error('Missing required payment verification parameters.');
    err.status = 400;
    throw err;
  }

  // 1. Load order from MySQL
  const [orderRows] = await pool.execute(
    `SELECT id, order_number, customer_id, customer_email, total_price,
            payment_status, fulfillment_status, gateway_order_id
     FROM orders 
     WHERE id = ? 
     LIMIT 1`,
    [numId]
  );

  if (!orderRows || orderRows.length === 0) {
    const err = new Error('Order not found.');
    err.status = 404;
    throw err;
  }

  const order = orderRows[0];

  // 2. Verify order ownership
  const user = await findUserByFirebaseUid(firebaseUser.uid);
  const isOwner = (user && order.customer_id && Number(user.id) === Number(order.customer_id)) ||
                  (order.customer_email && firebaseUser.email && order.customer_email.toLowerCase() === firebaseUser.email.toLowerCase());

  if (!isOwner) {
    const err = new Error('Access denied. You cannot verify payment for this order.');
    err.status = 403;
    throw err;
  }

  // 3. Verify gateway order ID matches
  if (order.gateway_order_id && order.gateway_order_id !== razorpay_order_id) {
    const err = new Error('Gateway order identifier mismatch.');
    err.status = 400;
    throw err;
  }

  // 4. Verify cryptographic signature
  const isValid = razorpayService.verifyPaymentSignature({
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature
  });

  if (!isValid) {
    // Record failed verification attempt for security auditing
    try {
      await pool.execute(
        `INSERT INTO payments (
          order_id, provider, gateway_order_id, gateway_payment_id, gateway_signature,
          amount, currency, status, error_code, error_description, created_at
        ) VALUES (?, 'razorpay', ?, ?, ?, ?, 'INR', 'failed', 'INVALID_SIGNATURE', 'Cryptographic signature mismatch', NOW())
        ON DUPLICATE KEY UPDATE status = 'failed', error_code = 'INVALID_SIGNATURE', updated_at = NOW()`,
        [order.id, razorpay_order_id, razorpay_payment_id, razorpay_signature, order.total_price]
      );
    } catch (e) {}

    const err = new Error('Payment signature verification failed. The payment could not be validated.');
    err.status = 400;
    throw err;
  }

  // 5. Update Order and Payment records atomically to PAID
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.execute(
      `UPDATE orders 
       SET payment_status = 'paid',
           payment_method = 'RAZORPAY',
           fulfillment_status = CASE WHEN fulfillment_status = 'pending' THEN 'processing' ELSE fulfillment_status END,
           updated_at = NOW()
       WHERE id = ?`,
      [order.id]
    );

    try {
      await connection.execute(
        `INSERT INTO payments (
          order_id, provider, gateway_order_id, gateway_payment_id, gateway_signature,
          amount, currency, status, created_at
        ) VALUES (?, 'razorpay', ?, ?, ?, ?, 'INR', 'captured', NOW())
        ON DUPLICATE KEY UPDATE 
          status = 'captured',
          gateway_signature = VALUES(gateway_signature),
          updated_at = NOW()`,
        [order.id, razorpay_order_id, razorpay_payment_id, razorpay_signature, order.total_price]
      );
    } catch (e) {}

    await connection.commit();
  } catch (dbErr) {
    await connection.rollback();
    throw dbErr;
  } finally {
    connection.release();
  }

  return {
    success: true,
    payment_status: 'paid',
    order_id: order.id,
    order_number: order.order_number
  };
};

/**
 * Handle Gateway Webhook Asynchronously with Cryptographic Verification and Idempotency
 * 
 * @param {string} rawBody - Unparsed request body string
 * @param {string} signatureHeader - Value of 'x-razorpay-signature'
 */
const handleWebhook = async (rawBody, signatureHeader) => {
  // 1. Verify webhook signature
  const isValid = razorpayService.verifyWebhookSignature({
    rawBody,
    signature: signatureHeader
  });

  if (!isValid) {
    const err = new Error('Invalid webhook signature.');
    err.status = 400;
    throw err;
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    const err = new Error('Malformed webhook JSON payload.');
    err.status = 400;
    throw err;
  }

  const eventId = event.event_id || event.id || '';
  const eventType = event.event || '';

  // Safe non-sensitive logging
  console.log(`[Payment Webhook] Processing event: ${eventType} (ID: ${eventId})`);

  // 2. Idempotency check via raw_event_reference
  if (eventId) {
    try {
      const [existing] = await pool.execute(
        'SELECT id, status FROM payments WHERE raw_event_reference = ? LIMIT 1',
        [eventId]
      );
      if (existing && existing.length > 0) {
        console.log(`[Payment Webhook] Event ${eventId} already processed. Skipping duplicate.`);
        return { status: 'already_processed', event_id: eventId };
      }
    } catch (e) {}
  }

  // 3. Handle Supported Webhook Events
  if (eventType === 'payment.captured' || eventType === 'order.paid') {
    const paymentEntity = event.payload?.payment?.entity || {};
    const gatewayOrderId = paymentEntity.order_id || event.payload?.order?.entity?.id || '';
    const gatewayPaymentId = paymentEntity.id || '';
    const amountPaise = paymentEntity.amount || 0;
    const method = paymentEntity.method || '';

    if (!gatewayOrderId) {
      console.warn('[Payment Webhook] No gateway order_id found in payment.captured payload.');
      return { status: 'skipped', reason: 'no_order_id' };
    }

    // Lookup order by gateway_order_id or notes.order_id
    let order = null;
    const [orderRows] = await pool.execute(
      'SELECT id, order_number, total_price, payment_status, fulfillment_status FROM orders WHERE gateway_order_id = ? LIMIT 1',
      [gatewayOrderId]
    );

    if (orderRows && orderRows.length > 0) {
      order = orderRows[0];
    } else if (paymentEntity.notes?.order_id) {
      const [orderById] = await pool.execute(
        'SELECT id, order_number, total_price, payment_status, fulfillment_status FROM orders WHERE id = ? LIMIT 1',
        [parseInt(paymentEntity.notes.order_id, 10)]
      );
      if (orderById && orderById.length > 0) order = orderById[0];
    }

    if (!order) {
      console.warn(`[Payment Webhook] Order not found for gateway order: ${gatewayOrderId}`);
      return { status: 'order_not_found', gateway_order_id: gatewayOrderId };
    }

    // Atomic update
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.execute(
        `UPDATE orders 
         SET payment_status = 'paid',
             payment_method = 'RAZORPAY',
             fulfillment_status = CASE WHEN fulfillment_status = 'pending' THEN 'processing' ELSE fulfillment_status END,
             updated_at = NOW()
         WHERE id = ?`,
        [order.id]
      );

      try {
        await connection.execute(
          `INSERT INTO payments (
            order_id, provider, gateway_order_id, gateway_payment_id,
            amount, currency, status, method, raw_event_reference, created_at
          ) VALUES (?, 'razorpay', ?, ?, ?, 'INR', 'captured', ?, ?, NOW())
          ON DUPLICATE KEY UPDATE 
            status = 'captured',
            method = VALUES(method),
            raw_event_reference = VALUES(raw_event_reference),
            updated_at = NOW()`,
          [order.id, gatewayOrderId, gatewayPaymentId, amountPaise || order.total_price, method, eventId]
        );
      } catch (e) {}

      await connection.commit();
      console.log(`[Payment Webhook] Successfully reconciled order #${order.order_number} to PAID.`);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    return { status: 'reconciled', order_number: order.order_number, payment_status: 'paid' };
  }

  if (eventType === 'payment.failed') {
    const paymentEntity = event.payload?.payment?.entity || {};
    const gatewayOrderId = paymentEntity.order_id || '';
    const gatewayPaymentId = paymentEntity.id || '';
    const errorCode = paymentEntity.error_code || 'GATEWAY_ERROR';
    const errorDesc = paymentEntity.error_description || 'Payment failed at gateway';

    if (gatewayOrderId) {
      try {
        const [orderRows] = await pool.execute(
          'SELECT id, order_number FROM orders WHERE gateway_order_id = ? LIMIT 1',
          [gatewayOrderId]
        );
        if (orderRows && orderRows.length > 0) {
          const ord = orderRows[0];
          await pool.execute(
            `INSERT INTO payments (
              order_id, provider, gateway_order_id, gateway_payment_id,
              amount, currency, status, error_code, error_description, raw_event_reference, created_at
            ) VALUES (?, 'razorpay', ?, ?, ?, 'INR', 'failed', ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE 
              status = 'failed',
              error_code = VALUES(error_code),
              error_description = VALUES(error_description),
              raw_event_reference = VALUES(raw_event_reference),
              updated_at = NOW()`,
            [ord.id, gatewayOrderId, gatewayPaymentId, paymentEntity.amount || 0, errorCode, errorDesc, eventId]
          );
        }
      } catch (e) {}
    }

    return { status: 'recorded_failure', event: eventType };
  }

  return { status: 'ignored', event: eventType };
};

/**
 * Get Authoritative Payment Status for an Order
 * 
 * @param {number|string} orderId
 * @param {Object} firebaseUser
 */
const getPaymentStatus = async (orderId, firebaseUser) => {
  const numId = parseInt(orderId, 10);
  if (isNaN(numId) || numId <= 0) {
    const err = new Error('Invalid order ID.');
    err.status = 400;
    throw err;
  }

  const [rows] = await pool.execute(
    `SELECT id, order_number, customer_id, customer_email, payment_method, 
            payment_status, fulfillment_status, total_price, gateway_order_id
     FROM orders 
     WHERE id = ? 
     LIMIT 1`,
    [numId]
  );

  if (!rows || rows.length === 0) {
    const err = new Error('Order not found.');
    err.status = 404;
    throw err;
  }

  const order = rows[0];

  const user = await findUserByFirebaseUid(firebaseUser.uid);
  const isOwner = (user && order.customer_id && Number(user.id) === Number(order.customer_id)) ||
                  (order.customer_email && firebaseUser.email && order.customer_email.toLowerCase() === firebaseUser.email.toLowerCase());

  if (!isOwner) {
    const err = new Error('Access denied.');
    err.status = 403;
    throw err;
  }

  return {
    order_id: order.id,
    order_number: order.order_number,
    payment_status: order.payment_status,
    fulfillment_status: order.fulfillment_status,
    payment_method: order.payment_method,
    total_price: order.total_price,
    gateway_order_id: order.gateway_order_id
  };
};

module.exports = {
  createPaymentOrder,
  verifyPayment,
  handleWebhook,
  getPaymentStatus
};
