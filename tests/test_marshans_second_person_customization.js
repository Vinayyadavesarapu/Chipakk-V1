/**
 * Tests for Lady Justice Second Person Personalization & Migration 020
 * tests/test_marshans_second_person_customization.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { createFakePool, installFakePool } = require('./helpers/fake_db');

const ROOT = path.join(__dirname, '..');
let passCount = 0;
let failCount = 0;

function check(name, condition, extra = '') {
  if (condition) {
    passCount++;
    console.log(`[PASS] ${name}`);
  } else {
    failCount++;
    console.error(`[FAIL] ${name} ${extra ? '— ' + extra : ''}`);
  }
}

async function runTests() {
  console.log('===============================================================');
  console.log('⚖️  THE MARSHANS — LADY JUSTICE SECOND PERSON PERSONALIZATION');
  console.log('===============================================================\n');

  // ===========================================================================
  // SUITE 1: MIGRATION 020 & STATIC CODE CHECKS
  // ===========================================================================
  console.log('--- SUITE 1: MIGRATION 020 & STATIC STRUCTURE ---');

  const migration020Path = path.join(ROOT, 'database/migration_020_marshans_second_person_customization.sql');
  check('1.1 migration_020 file exists', fs.existsSync(migration020Path));

  const mig020Content = fs.readFileSync(migration020Path, 'utf8');
  check('1.2 migration_020 adds second_customer_name VARCHAR(35) NULL',
    mig020Content.includes('second_customer_name') &&
    mig020Content.includes('VARCHAR(35)')
  );
  check('1.3 migration_020 adds second_customer_designation VARCHAR(50) NULL',
    mig020Content.includes('second_customer_designation') &&
    mig020Content.includes('VARCHAR(50)')
  );
  check('1.4 migration_020 contains idempotent check against INFORMATION_SCHEMA',
    mig020Content.includes('INFORMATION_SCHEMA.COLUMNS') &&
    mig020Content.includes('AddSecondPersonCustomizationColumns')
  );
  check('1.5 migration_020 reuses existing table custom_forge_order_customizations',
    mig020Content.includes('custom_forge_order_customizations') &&
    !mig020Content.includes('CREATE TABLE custom_forge_order_second_person')
  );

  const adminHtml = fs.readFileSync(path.join(ROOT, 'web/admin.html'), 'utf8');
  check('1.6 admin.html defines Person 1 and Person 2 in detail modal',
    adminHtml.includes('id="cf-detail-person2-block"') &&
    adminHtml.includes('id="cf-detail-person2-fields"') &&
    adminHtml.includes('id="cf-detail-person2-not-added"') &&
    adminHtml.includes('Second person: Not added')
  );

  const adminJs = fs.readFileSync(path.join(ROOT, 'web/js/admin.js'), 'utf8');
  check('1.7 admin.js conditionally displays second person or Not Added',
    adminJs.includes('cf-detail-person2-not-added') &&
    adminJs.includes('cf-detail-person2-fields') &&
    adminJs.includes('secondName')
  );

  // Frontend files in themarshans workspace
  const marshansRoot = path.join(ROOT, '..', 'themarshans', 'web', 'Marshan V 1', 'v 1.o');
  if (fs.existsSync(marshansRoot)) {
    const ljPurchase = fs.readFileSync(path.join(marshansRoot, 'src/components/react/LadyJusticePurchase.tsx'), 'utf8');
    check('1.8 LadyJusticePurchase.tsx defines + Add Another Person button',
      ljPurchase.includes('+ Add Another Person') &&
      ljPurchase.includes('cf-add-second-person-btn')
    );
    check('1.9 LadyJusticePurchase.tsx defines Person 2 inputs and remove button',
      ljPurchase.includes('cf-second-person-panel') &&
      ljPurchase.includes('cf-remove-second-person-btn') &&
      ljPurchase.includes('secondCustomName') &&
      ljPurchase.includes('secondCustomDesignation')
    );
    check('1.10 LadyJusticePurchase.tsx resets second person on 6-inch switch or custom toggle off',
      ljPurchase.includes('setSecondPersonEnabled(false)')
    );

    const customForgeApi = fs.readFileSync(path.join(marshansRoot, 'src/lib/api/customForge.ts'), 'utf8');
    check('1.11 customForge.ts validates second_name and second_designation',
      customForgeApi.includes('second_name') &&
      customForgeApi.includes('second_designation')
    );
  }

  // ===========================================================================
  // SUITE 2: BACKEND VALIDATION & SERVICE BEHAVIOR
  // ===========================================================================
  console.log('\n--- SUITE 2: BACKEND VALIDATION & ORDER CREATION ---');

  // Set up fake DB for backend service testing
  const fakePool = createFakePool([
    [/SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES/i, () => [[{ TABLE_NAME: 'custom_forge_products' }]]],
    [/SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS/i, () => [[{ COLUMN_NAME: 'second_customer_name' }]]],
    [/SHOW COLUMNS FROM custom_forge_order_customizations/i, () => [[{ Field: 'second_customer_name' }]]],
    [/SELECT v\.id, v\.product_id, v\.variant_sku, v\.size_label, v\.height_mm, v\.price, v\.custom_mode_allowed/i, (sql, params) => {
      const vId = params[0];
      if (vId === 1) {
        return [[{ id: 1, product_id: 1, variant_sku: 'MRSH-CF-LJ-6IN', size_label: '6 inches', height_mm: 152, price: 199900, custom_mode_allowed: 0, active: 1, product_name: 'Lady Justice' }]];
      } else if (vId === 2) {
        return [[{ id: 2, product_id: 1, variant_sku: 'MRSH-CF-LJ-1FT', size_label: '1 foot', height_mm: 305, price: 369900, custom_mode_allowed: 1, active: 1, product_name: 'Lady Justice' }]];
      } else if (vId === 3) {
        return [[{ id: 3, product_id: 1, variant_sku: 'MRSH-CF-LJ-2FT', size_label: '2 feet', height_mm: 610, price: 599900, custom_mode_allowed: 1, active: 1, product_name: 'Lady Justice' }]];
      }
      return [[]];
    }],
    [/SELECT id FROM users WHERE firebase_uid = \?/i, () => [[{ id: 42 }]]],
    [/SELECT id FROM custom_forge_orders WHERE order_number = \?/i, () => [[]]],
    [/INSERT INTO custom_forge_orders/i, () => [{ insertId: 101 }]],
    [/INSERT INTO custom_forge_order_items/i, () => [{ insertId: 501 }]],
    [/INSERT INTO custom_forge_order_customizations/i, () => [{ insertId: 701 }]],
    [/INSERT INTO custom_forge_order_status_history/i, () => [{ insertId: 901 }]],
    [/SELECT oi\.id.*FROM custom_forge_order_items oi/i, (sql, params) => {
      return [[{
        id: 501,
        order_id: 101,
        product_id: 1,
        variant_id: 2,
        product_name_snapshot: 'Lady Justice',
        variant_sku_snapshot: 'MRSH-CF-LJ-1FT',
        size_label_snapshot: '1 foot',
        height_mm_snapshot: 305,
        unit_price: 372800,
        quantity: 1,
        total_price: 372800,
        custom_mode_enabled: 1,
        engraved_name: 'Adv. Rajesh Sharma',
        engraved_designation: 'Senior Advocate',
        second_customer_name: 'Adv. Priya Sen',
        second_customer_designation: 'Advocate',
        nameplate_material: 'Plastic',
        verification_status: 'pending'
      }]];
    }],
    [/SELECT o\.id.*FROM custom_forge_orders o WHERE o\.id = \?/i, () => [[{
      id: 101,
      store_id: 2,
      order_number: 'CF-MRSH-2026-TEST',
      customer_id: 42,
      customer_email: 'lawyer@example.com',
      customer_name: 'Adv. Rajesh Sharma',
      customer_phone: '9876543210',
      shipping_address: JSON.stringify({ name: 'Adv. Rajesh Sharma', address: 'High Court Chambers', city: 'Delhi', state: 'Delhi', pincode: '110001' }),
      shipping_charge: 5000,
      subtotal: 372800,
      total_price: 377800,
      payment_method: 'razorpay',
      payment_status: 'pending',
      production_status: 'order_placed',
      created_at: new Date().toISOString()
    }]]]
  ]);

  installFakePool(fakePool);

  const customForgeService = require('../server/services/customForgeService');

  // 2.1 Single-person order creation (Person 2 omitted)
  const singlePersonOrder = await customForgeService.createCustomForgeOrder({
    variant_id: 2,
    custom_mode: 1,
    customization: {
      customer_name: 'Adv. Rajesh Sharma',
      customer_designation: 'Senior Advocate',
      nameplate_material: 'Plastic'
    },
    shipping_address: {
      name: 'Adv. Rajesh Sharma',
      phone: '9876543210',
      address: 'Chamber 4',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110001'
    }
  }, { uid: 'usr-1', email: 'lawyer@example.com', name: 'Adv. Rajesh Sharma' }, 2);

  check('2.1 Single-person order succeeds with second_customer_name = null',
    singlePersonOrder && singlePersonOrder.id === 101
  );

  // Check the last INSERT INTO custom_forge_order_customizations params
  const lastCustCall = fakePool.calls.find(c => c.sql.includes('INSERT INTO custom_forge_order_customizations'));
  check('2.2 Single-person order stores second person as null',
    lastCustCall && lastCustCall.params[4] === null && lastCustCall.params[5] === null
  );

  // 2.3 Two-person order creation
  const twoPersonOrder = await customForgeService.createCustomForgeOrder({
    variant_id: 2,
    custom_mode: 1,
    customization: {
      customer_name: 'Adv. Rajesh Sharma',
      customer_designation: 'Senior Advocate',
      second_customer_name: 'Adv. Priya Sen',
      second_customer_designation: 'Advocate',
      nameplate_material: 'Plastic'
    },
    shipping_address: {
      name: 'Adv. Rajesh Sharma',
      phone: '9876543210',
      address: 'Chamber 4',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110001'
    }
  }, { uid: 'usr-1', email: 'lawyer@example.com', name: 'Adv. Rajesh Sharma' }, 2);

  check('2.3 Two-person order succeeds',
    twoPersonOrder && twoPersonOrder.id === 101
  );

  const lastTwoPersonCall = [...fakePool.calls].reverse().find(c => c.sql.includes('INSERT INTO custom_forge_order_customizations'));
  check('2.4 Two-person order stores both names and designations in DB',
    lastTwoPersonCall &&
    lastTwoPersonCall.params[2] === 'Adv. Rajesh Sharma' &&
    lastTwoPersonCall.params[3] === 'Senior Advocate' &&
    lastTwoPersonCall.params[4] === 'Adv. Priya Sen' &&
    lastTwoPersonCall.params[5] === 'Advocate'
  );

  const validShipping = {
    name: 'Adv. Rajesh Sharma',
    phone: '9876543210',
    address: 'Chamber 4 High Court',
    city: 'Delhi',
    state: 'Delhi',
    pincode: '110001'
  };

  // 2.5 Validation: Second name exceeding 35 characters rejected
  let secondNameTooLongErr = null;
  try {
    await customForgeService.createCustomForgeOrder({
      variant_id: 2,
      custom_mode: 1,
      customization: {
        customer_name: 'Adv. Rajesh Sharma',
        customer_designation: 'Senior Advocate',
        second_customer_name: 'This is an excessively long name exceeding thirty five chars limit',
        second_customer_designation: 'Advocate',
        nameplate_material: 'Plastic'
      },
      shipping_address: validShipping
    }, { uid: 'usr-1' }, 2);
  } catch (err) {
    secondNameTooLongErr = err;
  }
  check('2.5 Second name exceeding 35 characters rejected with 400',
    secondNameTooLongErr && secondNameTooLongErr.statusCode === 400 &&
    secondNameTooLongErr.message.includes('cannot exceed 35 characters')
  );

  // 2.6 Validation: Second designation exceeding 50 characters rejected
  let secondDesigTooLongErr = null;
  try {
    await customForgeService.createCustomForgeOrder({
      variant_id: 2,
      custom_mode: 1,
      customization: {
        customer_name: 'Adv. Rajesh Sharma',
        customer_designation: 'Senior Advocate',
        second_customer_name: 'Adv. Priya Sen',
        second_customer_designation: 'This is an excessively long designation that easily exceeds fifty characters limit',
        nameplate_material: 'Plastic'
      },
      shipping_address: validShipping
    }, { uid: 'usr-1' }, 2);
  } catch (err) {
    secondDesigTooLongErr = err;
  }
  check('2.6 Second designation exceeding 50 characters rejected with 400',
    secondDesigTooLongErr && secondDesigTooLongErr.statusCode === 400 &&
    secondDesigTooLongErr.message.includes('cannot exceed 50 characters')
  );

  // 2.7 Validation: Second designation provided without second name rejected
  let missingSecondNameErr = null;
  try {
    await customForgeService.createCustomForgeOrder({
      variant_id: 2,
      custom_mode: 1,
      customization: {
        customer_name: 'Adv. Rajesh Sharma',
        customer_designation: 'Senior Advocate',
        second_customer_name: '   ',
        second_customer_designation: 'Junior Advocate',
        nameplate_material: 'Plastic'
      },
      shipping_address: validShipping
    }, { uid: 'usr-1' }, 2);
  } catch (err) {
    missingSecondNameErr = err;
  }
  check('2.7 Second designation without second name rejected with 400',
    missingSecondNameErr && missingSecondNameErr.statusCode === 400 &&
    missingSecondNameErr.message.includes('Second person name is required')
  );

  // 2.8 Person 1 designation required (omitted/empty rejected)
  let missingFirstDesigErr = null;
  try {
    await customForgeService.createCustomForgeOrder({
      variant_id: 2,
      custom_mode: 1,
      customization: {
        customer_name: 'Adv. Rajesh Sharma',
        customer_designation: '',
        nameplate_material: 'Plastic'
      },
      shipping_address: validShipping
    }, { uid: 'usr-1' }, 2);
  } catch (err) {
    missingFirstDesigErr = err;
  }
  check('2.8 Person 1 designation required (empty rejected with 400)',
    missingFirstDesigErr && missingFirstDesigErr.statusCode === 400 &&
    missingFirstDesigErr.message.includes('Designation on custom nameplate is required')
  );

  // 2.9 Person 2 designation required when Person 2 name provided
  let missingSecondDesigErr = null;
  try {
    await customForgeService.createCustomForgeOrder({
      variant_id: 2,
      custom_mode: 1,
      customization: {
        customer_name: 'Adv. Rajesh Sharma',
        customer_designation: 'Senior Advocate',
        second_customer_name: 'Adv. Priya Sen',
        second_customer_designation: '',
        nameplate_material: 'Plastic'
      },
      shipping_address: validShipping
    }, { uid: 'usr-1' }, 2);
  } catch (err) {
    missingSecondDesigErr = err;
  }
  check('2.9 Person 2 designation required when Person 2 provided (empty rejected with 400)',
    missingSecondDesigErr && missingSecondDesigErr.statusCode === 400 &&
    missingSecondDesigErr.message.includes('Second person designation on nameplate is required')
  );

  // 2.10 Literal NIL accepted for Person 1 and Person 2
  const orderWithNilSecond = await customForgeService.createCustomForgeOrder({
    variant_id: 2,
    custom_mode: 1,
    customization: {
      customer_name: 'Adv. Rajesh Sharma',
      customer_designation: 'NIL',
      second_customer_name: 'Adv. Priya Sen',
      second_customer_designation: 'nil',
      nameplate_material: 'Plastic'
    },
    shipping_address: validShipping
  }, { uid: 'usr-1' }, 2);
  const lastNilCall = [...fakePool.calls].reverse().find(c => c.sql.includes('INSERT INTO custom_forge_order_customizations'));
  check('2.10 Literal NIL accepted and normalized to NIL for both persons',
    lastNilCall && lastNilCall.params[2] === 'Adv. Rajesh Sharma' && lastNilCall.params[3] === 'NIL' &&
    lastNilCall.params[4] === 'Adv. Priya Sen' && lastNilCall.params[5] === 'NIL'
  );

  // 2.11 Existing 6-inch Custom Mode restrictions preserved
  let sixInErr = null;
  try {
    await customForgeService.createCustomForgeOrder({
      variant_id: 1, // 6-inch variant
      custom_mode: 1,
      customization: {
        customer_name: 'Adv. Rajesh Sharma',
        customer_designation: 'Senior Advocate',
        second_customer_name: 'Adv. Priya Sen',
        second_customer_designation: 'Advocate',
        nameplate_material: 'Plastic'
      },
      shipping_address: validShipping
    }, { uid: 'usr-1' }, 2);
  } catch (err) {
    sixInErr = err;
  }
  check('2.11 6-inch Custom Mode strictly rejected with 400',
    sixInErr && sixInErr.statusCode === 400 &&
    sixInErr.message.includes('Customization is not available for the 6-inch variant')
  );

  // 2.12 Multi-Store Isolation (Store 1 rejected)
  let store1Err = null;
  try {
    await customForgeService.createCustomForgeOrder({
      variant_id: 2,
      custom_mode: 1,
      customization: { customer_name: 'Test', customer_designation: 'NIL' },
      shipping_address: validShipping
    }, { uid: 'usr-1' }, 1);
  } catch (err) {
    store1Err = err;
  }
  check('2.12 Store 1 request to create Custom Forge order rejected with 403',
    store1Err && store1Err.statusCode === 403
  );

  // 2.13 Internal order retrieval returns second person details
  const retrievedOrder = await customForgeService.getCustomForgeOrderByIdInternal(101);
  check('2.13 Order retrieval includes second_name and second_designation',
    retrievedOrder &&
    retrievedOrder.items &&
    retrievedOrder.items[0].customization &&
    retrievedOrder.items[0].customization.second_name === 'Adv. Priya Sen' &&
    retrievedOrder.items[0].customization.second_designation === 'Advocate'
  );

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log('\n===============================================================');
  console.log(`TOTAL CHECKS: ${passCount + failCount}`);
  console.log(`PASSED:       ${passCount}`);
  console.log(`FAILED:       ${failCount}`);
  console.log('===============================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});
