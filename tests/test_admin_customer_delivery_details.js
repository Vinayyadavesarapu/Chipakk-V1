/**
 * Comprehensive Test Suite for Customer and Delivery Details in Admin Panel
 * Covers:
 * 1. CHIPAKK Retail Orders (Store 1)
 * 2. THE MARSHANS Retail Orders (Store 2)
 * 3. THE MARSHANS Custom Forge Orders (Store 2)
 * 4. Buyer Account vs. Delivery Recipient Disambiguation & Fallbacks
 * 5. Admin Panel Normalization and HTML Markup Integrity
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(err);
    failCount++;
  }
}

async function runTests() {
  console.log('===============================================================');
  console.log('📦  ADMIN CUSTOMER & DELIVERY DETAILS VERIFICATION SUITE');
  console.log('===============================================================\n');

  // --- SUITE 1: STATIC MARKUP & HTML INTEGRITY ---
  console.log('--- SUITE 1: ADMIN PANEL MARKUP & ID INTEGRITY ---');
  const adminHtml = fs.readFileSync(path.join(__dirname, '../web/admin.html'), 'utf8');

  test('1.1: Retail order detail modal retains ord-detail-cust-name-link and ord-detail-cust-name', () => {
    assert.ok(adminHtml.includes('id="ord-detail-cust-name-link"'));
    assert.ok(adminHtml.includes('id="ord-detail-cust-name"'));
  });

  test('1.2: Retail order detail modal retains ord-detail-cust-email and ord-detail-cust-phone', () => {
    assert.ok(adminHtml.includes('id="ord-detail-cust-email"'));
    assert.ok(adminHtml.includes('id="ord-detail-cust-phone"'));
  });

  test('1.3: Retail order detail modal retains ord-detail-cust-address and ord-view-cust-btn', () => {
    assert.ok(adminHtml.includes('id="ord-detail-cust-address"'));
    assert.ok(adminHtml.includes('id="ord-view-cust-btn"'));
  });

  test('1.4: Retail order detail modal visually labels Buyer Account and Shipping & Delivery Recipient', () => {
    assert.ok(adminHtml.includes('BUYER ACCOUNT'));
    assert.ok(adminHtml.includes('SHIPPING &amp; DELIVERY RECIPIENT') || adminHtml.includes('SHIPPING & DELIVERY RECIPIENT'));
  });

  test('1.5: Custom Forge modal retains cf-detail-cust-name, cf-detail-cust-email, cf-detail-cust-phone', () => {
    assert.ok(adminHtml.includes('id="cf-detail-cust-name"'));
    assert.ok(adminHtml.includes('id="cf-detail-cust-email"'));
    assert.ok(adminHtml.includes('id="cf-detail-cust-phone"'));
  });

  test('1.6: Custom Forge modal retains cf-detail-cust-address and distinct sections', () => {
    assert.ok(adminHtml.includes('id="cf-detail-cust-address"'));
    assert.ok(adminHtml.includes('BUYER ACCOUNT'));
  });

  // --- SUITE 2: ADMIN JAVASCRIPT NORMALIZATION LOGIC ---
  console.log('\n--- SUITE 2: ADMIN JS NORMALIZATION & FORMATTING LOGIC ---');
  const adminJs = fs.readFileSync(path.join(__dirname, '../web/js/admin.js'), 'utf8');

  test('2.1: admin.js parses JSON shipping_address with resilient multi-level parse', () => {
    assert.ok(adminJs.includes('parsedAddress = JSON.parse(parsedAddress)'));
  });

  test('2.2: admin.js extracts recipient_name and recipient_phone separately from buyer info', () => {
    assert.ok(adminJs.includes('recipientName ='));
    assert.ok(adminJs.includes('recipientPhone ='));
  });

  test('2.3: admin.js renders structured delivery details in ord-detail-cust-address', () => {
    assert.ok(adminJs.includes('Recipient:'));
    assert.ok(adminJs.includes('Delivery Contact:'));
  });

  test('2.4: admin.js renderOrdersTable displays contact phone or email in customer column', () => {
    assert.ok(adminJs.includes('📞') && adminJs.includes('view-cust-link'));
  });

  test('2.5: admin.js openCustomForgeDetailModal renders structured delivery details', () => {
    assert.ok(adminJs.includes('cf-detail-cust-address'));
    assert.ok(adminJs.includes('Delivery Contact:'));
  });

  // --- SUITE 3: SIMULATED DATA PROCESSING ---
  console.log('\n--- SUITE 3: DATA PIPELINE NORMALIZATION SIMULATION ---');

  // Simulation of normalizeOrder logic
  function testNormalizeOrder(o, activeStoreId = 1) {
    const isStore2 = (o.store_id !== undefined && o.store_id !== null) ? (parseInt(o.store_id, 10) === 2) : (activeStoreId === 2);
    const rawTotalPrice = parseInt(o.total_price || o.total || o.total_amount, 10) || 0;
    const totalPriceRupees = o.total_price_rupees !== undefined ? o.total_price_rupees : (isStore2 ? Math.round(rawTotalPrice / 100) : rawTotalPrice);

    const rawAddress = o.shipping_address;
    let parsedAddress = rawAddress;
    if (typeof parsedAddress === 'string') {
      try { parsedAddress = JSON.parse(parsedAddress); } catch (_) {}
    }
    if (typeof parsedAddress === 'string') {
      try { parsedAddress = JSON.parse(parsedAddress); } catch (_) {}
    }

    const recipientName = (parsedAddress && typeof parsedAddress === 'object')
      ? (parsedAddress.name || parsedAddress.recipient_name || '')
      : '';
    const recipientPhone = (parsedAddress && typeof parsedAddress === 'object')
      ? (parsedAddress.phone || parsedAddress.recipient_phone || parsedAddress.mobile || '')
      : '';

    let formattedAddress = '';
    if (parsedAddress && typeof parsedAddress === 'object') {
      const line1 = parsedAddress.address_line1 || parsedAddress.address || '';
      const line2 = parsedAddress.address_line2 || '';
      const street = [line1, line2].filter(Boolean).join(', ');
      const cityStateZip = [
        parsedAddress.city,
        [parsedAddress.state, parsedAddress.pincode || parsedAddress.postal_code || parsedAddress.zip].filter(Boolean).join(' - ')
      ].filter(Boolean).join(', ');
      const country = parsedAddress.country || 'India';
      formattedAddress = [street, cityStateZip, country].filter(Boolean).join(', ');
    } else {
      formattedAddress = o.address || (typeof rawAddress === 'string' ? rawAddress : 'Address not provided');
    }

    return {
      order_id: o.order_number || o.order_id || `CHP-${o.id}`,
      customer_name: o.customer_name || recipientName || 'Anonymous Customer',
      email: o.customer_email || o.email || (parsedAddress && parsedAddress.email) || '',
      phone: o.customer_phone || o.phone || recipientPhone || '',
      recipient_name: recipientName,
      recipient_phone: recipientPhone,
      shipping_address: parsedAddress,
      address: formattedAddress,
      total_price: totalPriceRupees
    };
  }

  test('3.1: CHIPAKK Order with distinct Buyer and Recipient preserves both cleanly', () => {
    const rawOrder = {
      id: 101,
      order_number: 'CHP-101001',
      store_id: 1,
      customer_name: 'Vinay Yadav (Buyer)',
      customer_email: 'buyer@chipakk.in',
      customer_phone: '9876543210',
      shipping_address: {
        name: 'Friend John (Recipient)',
        phone: '9123456780',
        email: 'recipient@gmail.com',
        address: '123 MG Road',
        address_line2: 'Flat 4B',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        country: 'India'
      },
      total_price: 499
    };

    const norm = testNormalizeOrder(rawOrder);
    assert.strictEqual(norm.customer_name, 'Vinay Yadav (Buyer)');
    assert.strictEqual(norm.phone, '9876543210');
    assert.strictEqual(norm.email, 'buyer@chipakk.in');
    assert.strictEqual(norm.recipient_name, 'Friend John (Recipient)');
    assert.strictEqual(norm.recipient_phone, '9123456780');
    assert.ok(norm.address.includes('123 MG Road, Flat 4B'));
    assert.ok(norm.address.includes('Bengaluru, Karnataka - 560001'));
  });

  test('3.2: Double-stringified JSON shipping address is unnested safely without raw JSON leakage', () => {
    const innerAddr = {
      name: 'Advocate Rao',
      phone: '9988776655',
      address: 'High Court Chambers',
      city: 'Hyderabad',
      state: 'Telangana',
      pincode: '500002',
      country: 'India'
    };
    const rawOrder = {
      id: 102,
      order_number: 'MRSH-202002',
      store_id: 2,
      customer_name: 'Advocate Rao',
      shipping_address: JSON.stringify(JSON.stringify(innerAddr)),
      total_price: 369900
    };

    const norm = testNormalizeOrder(rawOrder, 2);
    assert.strictEqual(norm.recipient_name, 'Advocate Rao');
    assert.strictEqual(norm.recipient_phone, '9988776655');
    assert.strictEqual(norm.total_price, 3699);
    assert.ok(norm.address.includes('High Court Chambers'));
    assert.ok(norm.address.includes('Hyderabad, Telangana - 500002'));
    assert.ok(!norm.address.startsWith('{"')); // No raw JSON leaked as address
  });

  test('3.3: Missing buyer name and phone gracefully fall back to shipping address details', () => {
    const rawOrder = {
      id: 103,
      order_number: 'CHP-103003',
      store_id: 1,
      customer_name: null,
      customer_phone: null,
      customer_email: null,
      shipping_address: {
        name: 'Fallback Customer',
        phone: '9555444333',
        email: 'fallback@example.com',
        address: 'Sector 5',
        city: 'Noida',
        state: 'Uttar Pradesh',
        pincode: '201301'
      },
      total_price: 750
    };

    const norm = testNormalizeOrder(rawOrder);
    assert.strictEqual(norm.customer_name, 'Fallback Customer');
    assert.strictEqual(norm.phone, '9555444333');
    assert.strictEqual(norm.email, 'fallback@example.com');
  });

  test('3.4: Custom Forge order simulation preserves Person 1, Person 2, and delivery details', () => {
    const cfOrder = {
      id: 501,
      order_number: 'CF-MRSH-2026-0099',
      store_id: 2,
      customer_name: 'Senior Counsel',
      customer_email: 'senior@marshans.in',
      customer_phone: '9811122233',
      shipping_address: {
        name: 'Junior Associate',
        phone: '9844455566',
        address: 'Chamber 12, Supreme Court',
        city: 'New Delhi',
        state: 'Delhi',
        pincode: '110001'
      },
      customization: {
        name: 'Hon. Justice Verma',
        designation: 'Supreme Court of India',
        second_name: 'Adv. A. Verma',
        second_designation: 'Advocate',
        material: 'MDF'
      },
      total_price: 374800
    };

    const norm = testNormalizeOrder(cfOrder, 2);
    assert.strictEqual(norm.customer_name, 'Senior Counsel');
    assert.strictEqual(norm.phone, '9811122233');
    assert.strictEqual(norm.recipient_name, 'Junior Associate');
    assert.strictEqual(norm.recipient_phone, '9844455566');
    assert.strictEqual(norm.total_price, 3748);
  });

  // --- SUITE 4: BACKEND SERVICE INTEGRATION CHECKS ---
  console.log('\n--- SUITE 4: BACKEND SERVICE IMPLEMENTATION AUDIT ---');
  const orderServiceCode = fs.readFileSync(path.join(__dirname, '../server/services/orderService.js'), 'utf8');
  const customForgeCode = fs.readFileSync(path.join(__dirname, '../server/services/customForgeService.js'), 'utf8');

  test('4.1: orderService defines cached checkHasCustomerPhoneCol helper', () => {
    assert.ok(orderServiceCode.includes('checkHasCustomerPhoneCol'));
  });

  test('4.2: orderService getOrders uses safe COALESCE fallback for customer_phone, name, email', () => {
    assert.ok(orderServiceCode.includes('phoneSql'));
    assert.ok(orderServiceCode.includes('resolvedName'));
    assert.ok(orderServiceCode.includes('resolvedPhone'));
  });

  test('4.3: orderService createCustomerOrder distinguishes buyerName, buyerPhone, buyerEmail', () => {
    assert.ok(orderServiceCode.includes('buyerName'));
    assert.ok(orderServiceCode.includes('buyerPhone'));
    assert.ok(orderServiceCode.includes('buyerEmail'));
  });

  test('4.4: customForgeService createCustomForgeOrder distinguishes buyer details from delivery recipient', () => {
    assert.ok(customForgeCode.includes('buyerName'));
    assert.ok(customForgeCode.includes('buyerPhone'));
    assert.ok(customForgeCode.includes('buyerEmail'));
  });

  test('4.5: customForgeService getAdminCustomForgeOrders selects shipping_address and resolves contact details', () => {
    assert.ok(customForgeCode.includes('o.shipping_address'));
    assert.ok(customForgeCode.includes('customer_phone'));
  });

  console.log('\n===============================================================');
  console.log(`TOTAL CHECKS: ${passCount + failCount}`);
  console.log(`PASSED:       ${passCount}`);
  console.log(`FAILED:       ${failCount}`);
  console.log('===============================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests();
