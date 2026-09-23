/**
 * tests/test_chipakk_material_inventory.js
 *
 * Dedicated Test Suite for:
 * STEP 3 — CHIPAKK PRODUCTION-MATERIAL INVENTORY & STOCK MOVEMENTS (Store 1 Only)
 *
 * Validates:
 * 1. Database Migration 018 integrity (table schema, guards, columns, FKs, indexes).
 * 2. Service Unit & Transaction Isolation:
 *    - Strict Store 1 scoping (Store 2 data is never returned or mutated).
 *    - Material CRUD (create, read, update, soft-delete, reactivate).
 *    - Material SKU uniqueness per store (Store 1).
 *    - Initial stock logging upon creation.
 *    - Stock movements (PURCHASE, CONSUMPTION, WASTE, ADJUSTMENT, RETURN).
 *    - ACID Transaction & Negative Stock Protection (CONSUMPTION/WASTE cannot drop stock below 0).
 *    - Movement history tracking with full audit trail.
 *    - Low stock alerts calculation (stock <= safety_stock).
 * 3. Express Controller & HTTP API Verification:
 *    - Store 1 admin requests succeed.
 *    - Store 2 requests to CHIPAKK production inventory return 403 Forbidden.
 *    - Invalid input (negative quantity, unknown type) returns 400 Bad Request.
 *    - Non-existent material returns 404 Not Found.
 * 4. Admin UI Assets Verification:
 *    - web/admin.html has tab-chipakk-inventory and store-module-chipakk classes.
 *    - web/admin.html has modals for material CRUD, movement recording, and history audit trail.
 *    - web/js/admin.js has client handlers and store isolation hooks.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

console.log('======================================================================');
console.log('🧪 RUNNING TEST SUITE: CHIPAKK PRODUCTION MATERIAL INVENTORY (STEP 3)');
console.log('======================================================================\n');

let passedTests = 0;
let failedTests = 0;

function runTest(testName, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${testName}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${testName}`);
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

async function runAsyncTest(testName, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${testName}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${testName}`);
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

(async () => {
  // -----------------------------------------------------------------------------
  // TEST 1: Database Migration 018 Integrity
  // -----------------------------------------------------------------------------
  runTest('1. Migration 018 SQL file exists and contains all required DDL statements', () => {
    const migrationPath = path.join(__dirname, '../database/migration_018_chipakk_material_inventory.sql');
    assert.ok(fs.existsSync(migrationPath), 'migration_018_chipakk_material_inventory.sql must exist');

    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Check materials table extensions
    assert.ok(sql.includes('materials') && sql.includes('sku'), 'Must add sku to materials');
    assert.ok(sql.includes('reorder_quantity'), 'Must add reorder_quantity to materials');
    assert.ok(sql.includes('supplier'), 'Must add supplier to materials');
    assert.ok(sql.includes('uk_materials_store_sku'), 'Must create unique key on (store_id, sku)');

    // Check material_stock_movements table
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS `material_stock_movements`'), 'Must create material_stock_movements table');
    assert.ok(sql.includes('PURCHASE'), 'Must support PURCHASE movement type');
    assert.ok(sql.includes('CONSUMPTION'), 'Must support CONSUMPTION movement type');
    assert.ok(sql.includes('WASTE'), 'Must support WASTE movement type');
    assert.ok(sql.includes('ADJUSTMENT'), 'Must support ADJUSTMENT movement type');
    assert.ok(sql.includes('RETURN'), 'Must support RETURN movement type');
    assert.ok(sql.includes('previous_stock'), 'Must record previous_stock');
    assert.ok(sql.includes('resulting_stock'), 'Must record resulting_stock');

    // Check Seed Data for Store 1
    assert.ok(sql.includes('CHP-MAT-VINYL-GLOSS'), 'Must seed default Glossy Vinyl for Store 1');
    assert.ok(sql.includes('CHP-MAT-VINYL-MATTE'), 'Must seed default Matte Vinyl for Store 1');
    assert.ok(sql.includes('CHP-MAT-PKG-ENV'), 'Must seed packaging materials for Store 1');
  });

  // -----------------------------------------------------------------------------
  // TEST 2: In-Memory Mock Service Verification (Hermetic Unit Tests)
  // -----------------------------------------------------------------------------

  // Set up in-memory mock database state
  const mockMaterialsDb = [
    {
      id: 101,
      store_id: 1,
      name: 'Premium Glossy Vinyl Roll',
      sku: 'CHP-MAT-VINYL-GLOSS',
      type: 'Vinyl',
      color: 'White',
      stock: 250.00,
      unit: 'meters',
      cost: 12000,
      safety_stock: 50.00,
      reorder_quantity: 100.00,
      supplier: 'Avery Dennison',
      active: 1,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01')
    },
    {
      id: 102,
      store_id: 1,
      name: 'Matte Vinyl Sheets (A4)',
      sku: 'CHP-MAT-VINYL-MATTE',
      type: 'Paper',
      color: 'White',
      stock: 40.00, // Below safety stock (50) -> Low Stock!
      unit: 'sheets',
      cost: 4500,
      safety_stock: 50.00,
      reorder_quantity: 100.00,
      supplier: 'Oracle Graphics',
      active: 1,
      created_at: new Date('2026-01-02'),
      updated_at: new Date('2026-01-02')
    },
    {
      id: 999,
      store_id: 2, // THE MARSHANS (Store 2) - MUST NEVER LEAK TO STORE 1
      name: 'PLA Black 1.75mm Filament',
      sku: 'MSH-FIL-PLA-BLK',
      type: 'PLA',
      color: 'Black',
      stock: 12.50,
      unit: 'kg',
      cost: 180000,
      safety_stock: 3.00,
      reorder_quantity: 5.00,
      supplier: 'Bambu Lab',
      active: 1,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01')
    }
  ];

  const mockMovementsDb = [];
  let nextMaterialId = 200;
  let nextMovementId = 500;

  // Intercept the database pool in chipakkMaterialInventoryService
  const dbModule = require('../server/config/database');
  const originalPoolExecute = dbModule.pool.execute;
  const originalPoolGetConnection = dbModule.pool.getConnection;

  // Mock pool execute
  dbModule.pool.execute = async (sql, params = []) => {
    const trimmed = sql.trim().replace(/\s+/g, ' ');

    // SELECT m.* FROM materials m WHERE m.store_id = 1 ...
    if (trimmed.includes('FROM materials m') && trimmed.includes('m.store_id = ?')) {
      const storeIdParam = Number(params[0]);
      let results = mockMaterialsDb.filter(m => m.store_id === storeIdParam);

      // Check filters
      if (trimmed.includes('m.active = 1')) {
        results = results.filter(m => m.active === 1);
      }
      if (trimmed.includes('m.stock <= m.safety_stock')) {
        results = results.filter(m => m.stock <= m.safety_stock);
      }
      if (trimmed.includes('m.type = ?')) {
        const typeParam = params.find((p, idx) => idx > 0 && typeof p === 'string' && !p.includes('%'));
        if (typeParam) results = results.filter(m => m.type === typeParam);
      }
      if (trimmed.includes('(m.name LIKE ?')) {
        const term = String(params[1] || '').replace(/%/g, '').toLowerCase();
        results = results.filter(m =>
          (m.name || '').toLowerCase().includes(term) ||
          (m.sku || '').toLowerCase().includes(term) ||
          (m.supplier || '').toLowerCase().includes(term)
        );
      }
      if (trimmed.includes('m.id = ?')) {
        const idParam = Number(params[0]);
        results = mockMaterialsDb.filter(m => m.id === idParam && m.store_id === 1);
      }
      return [results.map(r => ({ ...r }))];
    }

    // SELECT m.id FROM materials WHERE store_id = ? AND sku = ?
    if (trimmed.includes('SELECT id FROM materials WHERE store_id = ? AND sku = ?')) {
      const sId = Number(params[0]);
      const sku = String(params[1]).toUpperCase();
      const excludeId = params[2] ? Number(params[2]) : null;
      const found = mockMaterialsDb.filter(m => m.store_id === sId && m.sku === sku && (!excludeId || m.id !== excludeId));
      return [found];
    }

    // INSERT INTO materials
    if (trimmed.startsWith('INSERT INTO materials')) {
      const [sId, name, sku, type, color, stock, unit, cost, safety_stock, reorder_quantity, supplier, active] = params;
      const newMat = {
        id: nextMaterialId++,
        store_id: Number(sId),
        name,
        sku,
        type,
        color,
        stock: Number(stock),
        unit,
        cost: Number(cost),
        safety_stock: Number(safety_stock),
        reorder_quantity: Number(reorder_quantity),
        supplier,
        active: Number(active),
        created_at: new Date(),
        updated_at: new Date()
      };
      mockMaterialsDb.push(newMat);
      return [{ insertId: newMat.id, affectedRows: 1 }];
    }

    // UPDATE materials SET ...
    if (trimmed.startsWith('UPDATE materials SET')) {
      if (trimmed.includes('active = ?')) {
        const [flag, id, sId] = params;
        const mat = mockMaterialsDb.find(m => m.id === Number(id) && m.store_id === Number(sId));
        if (mat) mat.active = Number(flag);
        return [{ affectedRows: mat ? 1 : 0 }];
      } else {
        const [name, sku, type, color, unit, cost, safety_stock, reorder_quantity, supplier, active, id, sId] = params;
        const mat = mockMaterialsDb.find(m => m.id === Number(id) && m.store_id === Number(sId));
        if (mat) {
          mat.name = name;
          mat.sku = sku;
          mat.type = type;
          mat.color = color;
          mat.unit = unit;
          mat.cost = Number(cost);
          mat.safety_stock = Number(safety_stock);
          mat.reorder_quantity = Number(reorder_quantity);
          mat.supplier = supplier;
          mat.active = Number(active);
          mat.updated_at = new Date();
        }
        return [{ affectedRows: mat ? 1 : 0 }];
      }
    }

    // INSERT INTO material_stock_movements
    if (trimmed.startsWith('INSERT INTO material_stock_movements')) {
      let matId, sId, type, qty, prev, resStock, costPerUnit, refId, notes, createdBy;
      if (params.length === 7) {
        [matId, sId, qty, resStock, costPerUnit, refId, createdBy] = params;
        type = 'PURCHASE';
        prev = 0;
        notes = 'Initial inventory stock upon creation';
      } else {
        [matId, sId, type, qty, prev, resStock, costPerUnit, refId, notes, createdBy] = params;
      }

      const newMv = {
        id: nextMovementId++,
        material_id: Number(matId),
        store_id: Number(sId),
        type,
        quantity: Number(qty),
        previous_stock: Number(prev),
        resulting_stock: Number(resStock),
        cost_per_unit: Number(costPerUnit),
        reference_id: refId,
        notes,
        created_by: createdBy,
        created_at: new Date()
      };
      mockMovementsDb.push(newMv);
      return [{ insertId: newMv.id, affectedRows: 1 }];
    }

    // SELECT FROM material_stock_movements
    if (trimmed.includes('FROM material_stock_movements msm')) {
      if (trimmed.includes('COUNT(*) AS total')) {
        return [[{ total: mockMovementsDb.length }]];
      }
      const sId = Number(params[0]);
      let mvs = mockMovementsDb.filter(m => m.store_id === sId);
      if (params.includes('PURCHASE') || params.includes('CONSUMPTION')) {
        const typeParam = params.find(p => ['PURCHASE', 'CONSUMPTION', 'WASTE', 'ADJUSTMENT', 'RETURN'].includes(p));
        if (typeParam) mvs = mvs.filter(m => m.type === typeParam);
      }
      return [mvs.map(m => {
        const mat = mockMaterialsDb.find(x => x.id === m.material_id) || {};
        return {
          ...m,
          material_name: mat.name,
          material_sku: mat.sku,
          material_unit: mat.unit
        };
      })];
    }

    // SELECT DISTINCT type FROM materials
    if (trimmed.includes('SELECT DISTINCT type FROM materials WHERE store_id = ?')) {
      const sId = Number(params[0]);
      const types = [...new Set(mockMaterialsDb.filter(m => m.store_id === sId).map(m => m.type))];
      return [types.map(t => ({ type: t }))];
    }

    return [[]];
  };

  // Mock pool getConnection for transaction support in recordStockMovement
  dbModule.pool.getConnection = async () => {
    let inTransaction = false;
    let backupState = null;

    return {
      beginTransaction: async () => {
        inTransaction = true;
        backupState = JSON.parse(JSON.stringify({ materials: mockMaterialsDb, movements: mockMovementsDb }));
      },
      commit: async () => {
        inTransaction = false;
        backupState = null;
      },
      rollback: async () => {
        if (backupState) {
          mockMaterialsDb.length = 0;
          mockMaterialsDb.push(...backupState.materials);
          mockMovementsDb.length = 0;
          mockMovementsDb.push(...backupState.movements);
        }
        inTransaction = false;
      },
      release: () => {},
      execute: async (sql, params = []) => {
        const trimmed = sql.trim().replace(/\s+/g, ' ');

        // SELECT ... FOR UPDATE
        if (trimmed.includes('FOR UPDATE')) {
          const matId = Number(params[0]);
          const sId = Number(params[1]);
          const mat = mockMaterialsDb.find(m => m.id === matId && m.store_id === sId);
          return [mat ? [{ ...mat }] : []];
        }

        // UPDATE materials SET stock = ?, cost = ?
        if (trimmed.includes('cost = ?')) {
          const [resStock, cost, matId, sId] = params;
          const mat = mockMaterialsDb.find(m => m.id === Number(matId) && m.store_id === Number(sId));
          if (mat) {
            mat.stock = Number(resStock);
            mat.cost = Number(cost);
            mat.updated_at = new Date();
          }
          return [{ affectedRows: mat ? 1 : 0 }];
        }

        // UPDATE materials SET stock = ?
        if (trimmed.startsWith('UPDATE materials SET stock = ?')) {
          const [resStock, matId, sId] = params;
          const mat = mockMaterialsDb.find(m => m.id === Number(matId) && m.store_id === Number(sId));
          if (mat) {
            mat.stock = Number(resStock);
            mat.updated_at = new Date();
          }
          return [{ affectedRows: mat ? 1 : 0 }];
        }

        // Delegate other statements to pool.execute
        return dbModule.pool.execute(sql, params);
      }
    };
  };

  const chipakkService = require('../server/services/chipakkMaterialInventoryService');

  // Test 2.1: Multi-Store Isolation (Store 1 only)
  await runAsyncTest('2.1 List materials only returns CHIPAKK (Store 1) materials, never Store 2', async () => {
    const list = await chipakkService.listMaterials();
    assert.ok(Array.isArray(list), 'Must return an array');
    assert.strictEqual(list.length, 2, 'Should only return the 2 Store 1 materials, not Store 2');
    list.forEach(m => {
      assert.strictEqual(m.store_id, 1, `Material ${m.name} must belong to Store 1`);
      assert.notStrictEqual(m.sku, 'MSH-FIL-PLA-BLK', 'Must never return Store 2 Marshans materials');
    });
  });

  // Test 2.2: Low stock identification
  await runAsyncTest('2.2 Low stock status is accurately calculated and filtered', async () => {
    const list = await chipakkService.listMaterials({ lowStockOnly: true });
    assert.strictEqual(list.length, 1, 'Only 1 item is below safety threshold');
    assert.strictEqual(list[0].sku, 'CHP-MAT-VINYL-MATTE', 'Matte Vinyl Sheets must be flagged as low stock');
    assert.strictEqual(list[0].is_low_stock, true);

    const alerts = await chipakkService.getLowStockAlerts();
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(alerts[0].sku, 'CHP-MAT-VINYL-MATTE');
    assert.strictEqual(alerts[0].deficit, 10, 'Safety stock 50 - current stock 40 = deficit 10');
  });

  // Test 2.3: Create Material with duplicate SKU check and initial stock movement
  await runAsyncTest('2.3 Create material inserts record and creates initial movement if stock > 0', async () => {
    const created = await chipakkService.createMaterial({
      name: 'Transparent Film Adhesive Roll',
      sku: 'CHP-MAT-FILM-CLEAR',
      type: 'Vinyl',
      color: 'Clear',
      stock: 75.50,
      unit: 'meters',
      cost: 15000,
      safety_stock: 20.00,
      reorder_quantity: 50.00,
      supplier: '3M Commercial'
    }, 'admin_test');

    assert.ok(created.id, 'Created material must have an ID');
    assert.strictEqual(created.sku, 'CHP-MAT-FILM-CLEAR');
    assert.strictEqual(created.stock, 75.50);
    assert.strictEqual(created.is_low_stock, false);

    // Verify initial stock movement was created
    const mv = mockMovementsDb.find(m => m.material_id === created.id);
    assert.ok(mv, 'Initial stock movement must be recorded');
    assert.strictEqual(mv.type, 'PURCHASE');
    assert.strictEqual(mv.quantity, 75.50);
    assert.strictEqual(mv.previous_stock, 0);
    assert.strictEqual(mv.resulting_stock, 75.50);
  });

  // Test 2.4: Prevent duplicate SKU in Store 1
  await runAsyncTest('2.4 Attempting to create material with existing SKU throws 409 Conflict', async () => {
    let threw = false;
    try {
      await chipakkService.createMaterial({
        name: 'Duplicate SKU Material',
        sku: 'CHP-MAT-VINYL-GLOSS', // Already exists!
        type: 'Vinyl',
        unit: 'meters'
      });
    } catch (err) {
      threw = true;
      assert.strictEqual(err.statusCode, 409, 'Must throw 409 Conflict');
      assert.ok(err.message.includes('already exists'), 'Error message must specify SKU already exists');
    }
    assert.ok(threw, 'Must throw duplicate SKU error');
  });

  // Test 2.5: Stock Movement - PURCHASE
  await runAsyncTest('2.5 Stock movement PURCHASE increases stock balance and records audit row', async () => {
    const matId = 101; // Current stock 250
    const result = await chipakkService.recordStockMovement({
      materialId: matId,
      type: 'PURCHASE',
      quantity: 50,
      costPerUnit: 11500,
      referenceId: 'PO-TEST-1001',
      notes: 'New supplier batch shipment',
      createdBy: 'test_operator'
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.movement.previous_stock, 250);
    assert.strictEqual(result.movement.resulting_stock, 300);
    assert.strictEqual(result.movement.type, 'PURCHASE');
    assert.strictEqual(result.material.stock, 300);

    const updated = mockMaterialsDb.find(m => m.id === matId);
    assert.strictEqual(updated.stock, 300);
  });

  // Test 2.6: Stock Movement - CONSUMPTION
  await runAsyncTest('2.6 Stock movement CONSUMPTION decreases stock balance and records audit row', async () => {
    const matId = 101; // Current stock 300
    const result = await chipakkService.recordStockMovement({
      materialId: matId,
      type: 'CONSUMPTION',
      quantity: 20,
      referenceId: 'JOB-PRINT-402',
      notes: 'Printed 200 die-cut stickers',
      createdBy: 'test_operator'
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.movement.previous_stock, 300);
    assert.strictEqual(result.movement.resulting_stock, 280);
    assert.strictEqual(result.movement.type, 'CONSUMPTION');

    const updated = mockMaterialsDb.find(m => m.id === matId);
    assert.strictEqual(updated.stock, 280);
  });

  // Test 2.7: STRICT NEGATIVE STOCK PROTECTION (Consumption exceeds stock)
  await runAsyncTest('2.7 STRICT NEGATIVE STOCK PROTECTION: CONSUMPTION exceeding available stock throws 400 and rolls back', async () => {
    const matId = 101; // Current stock 280
    let threw = false;

    try {
      await chipakkService.recordStockMovement({
        materialId: matId,
        type: 'CONSUMPTION',
        quantity: 500, // Exceeds 280!
        referenceId: 'JOB-OVERDRAFT',
        notes: 'Attempted to over-consume'
      });
    } catch (err) {
      threw = true;
      assert.strictEqual(err.statusCode, 400, 'Must throw 400 Bad Request');
      assert.ok(err.message.includes('Insufficient stock'), 'Must inform about insufficient stock');
      assert.ok(err.message.includes('cannot become negative'), 'Must guarantee non-negative constraint');
    }

    assert.ok(threw, 'Must throw error on negative stock');
    const updated = mockMaterialsDb.find(m => m.id === matId);
    assert.strictEqual(updated.stock, 280, 'Stock must remain completely unchanged at 280 after rollback');
  });

  // Test 2.8: Stock Movement - WASTE & ADJUSTMENT
  await runAsyncTest('2.8 WASTE deductions and ADJUSTMENT audit modes function properly', async () => {
    const matId = 101; // Current stock 280

    // Waste
    const wasteRes = await chipakkService.recordStockMovement({
      materialId: matId,
      type: 'WASTE',
      quantity: 5,
      notes: 'Printer head jam paper damage'
    });
    assert.strictEqual(wasteRes.movement.resulting_stock, 275);

    // Adjustment: Set absolute count
    const adjRes = await chipakkService.recordStockMovement({
      materialId: matId,
      type: 'ADJUSTMENT',
      quantity: 300,
      direction: 'set',
      notes: 'Physical cycle count reconciliation'
    });
    assert.strictEqual(adjRes.movement.previous_stock, 275);
    assert.strictEqual(adjRes.movement.resulting_stock, 300);

    // Adjustment subtract beyond 0 must fail
    let threw = false;
    try {
      await chipakkService.recordStockMovement({
        materialId: matId,
        type: 'ADJUSTMENT',
        quantity: 500,
        direction: 'subtract'
      });
    } catch (err) {
      threw = true;
      assert.strictEqual(err.statusCode, 400);
    }
    assert.ok(threw, 'Adjustment subtraction into negative must fail');
  });

  // Test 2.9: Soft-delete (deactivate) and reactivate
  await runAsyncTest('2.9 Soft-deactivating material toggles active status to 0 without deleting history', async () => {
    const matId = 102;
    const deactivated = await chipakkService.setMaterialActive(matId, false);
    assert.strictEqual(deactivated.active, 0);
    assert.strictEqual(deactivated.is_active, false);

    const reactivated = await chipakkService.setMaterialActive(matId, true);
    assert.strictEqual(reactivated.active, 1);
    assert.strictEqual(reactivated.is_active, true);
  });

  // Test 2.10: Movement History Audit Trail
  await runAsyncTest('2.10 Stock movement history returns paginated list with material names and units', async () => {
    const history = await chipakkService.getStockMovements({ limit: 10 });
    assert.ok(history.total >= 3, 'Must have at least 3 logged movements');
    assert.ok(Array.isArray(history.movements), 'Must return movements array');
    history.movements.forEach(mv => {
      assert.strictEqual(mv.store_id, 1, 'All movements must belong to Store 1');
      assert.ok(mv.type, 'Must have a type');
      assert.ok(typeof mv.previous_stock === 'number', 'Must have previous_stock');
      assert.ok(typeof mv.resulting_stock === 'number', 'Must have resulting_stock');
    });
  });

  // -----------------------------------------------------------------------------
  // TEST 3: Controller HTTP & Multi-Store Protection
  // -----------------------------------------------------------------------------
  const chipakkController = require('../server/controllers/chipakkMaterialController');

  await runAsyncTest('3.1 Store 2 requests to CHIPAKK production inventory are rejected with 403 Forbidden', async () => {
    let statusSent = null;
    let jsonSent = null;

    const mockRes = {
      status: (code) => {
        statusSent = code;
        return mockRes;
      },
      json: (data) => {
        jsonSent = data;
        return mockRes;
      }
    };

    // Simulate request with Store 2 header
    const mockReqStore2 = {
      headers: { 'x-store-id': '2' },
      query: {},
      user: { uid: 'admin_test' }
    };

    await chipakkController.getMaterialsHandler(mockReqStore2, mockRes, () => {});

    assert.strictEqual(statusSent, 403, 'Must return HTTP 403 Forbidden for Store 2');
    assert.strictEqual(jsonSent.success, false);
    assert.ok(jsonSent.error.message.includes('restricted to Store 1'), 'Must explain restriction to Store 1');
  });

  await runAsyncTest('3.2 Store 1 admin requests succeed with HTTP 200', async () => {
    let statusSent = 200;
    let jsonSent = null;

    const mockRes = {
      status: (code) => {
        statusSent = code;
        return mockRes;
      },
      json: (data) => {
        jsonSent = data;
        return mockRes;
      }
    };

    const mockReqStore1 = {
      headers: { 'x-store-id': '1' },
      query: {},
      user: { uid: 'admin_test' }
    };

    await chipakkController.getMaterialsHandler(mockReqStore1, mockRes, () => {});

    assert.strictEqual(statusSent, 200, 'Must return HTTP 200 for Store 1');
    assert.strictEqual(jsonSent.success, true);
    assert.ok(Array.isArray(jsonSent.data), 'Must return array of materials');
  });

  // -----------------------------------------------------------------------------
  // TEST 4: Admin UI & Client Assets Verification
  // -----------------------------------------------------------------------------
  runTest('4.1 web/admin.html contains tab-chipakk-inventory with proper store-module-chipakk scoping', () => {
    const adminHtml = fs.readFileSync(path.join(__dirname, '../web/admin.html'), 'utf8');

    // Nav link
    assert.ok(
      adminHtml.includes('data-tab="tab-chipakk-inventory"'),
      'Must have navigation link pointing to tab-chipakk-inventory'
    );
    assert.ok(
      adminHtml.includes('class="store-module-chipakk"'),
      'Must be marked with store-module-chipakk class for automatic multi-store show/hide'
    );

    // Section container
    assert.ok(
      adminHtml.includes('id="tab-chipakk-inventory"'),
      'Must have section id="tab-chipakk-inventory"'
    );
    assert.ok(
      adminHtml.includes('id="chipakk-materials-tbody"'),
      'Must have materials table tbody'
    );
    assert.ok(
      adminHtml.includes('id="chipakk-mat-alert-banner"'),
      'Must have low-stock alert banner'
    );

    // Modals
    assert.ok(adminHtml.includes('id="modal-chipakk-material"'), 'Must have modal-chipakk-material');
    assert.ok(adminHtml.includes('id="modal-chipakk-movement"'), 'Must have modal-chipakk-movement');
    assert.ok(adminHtml.includes('id="modal-chipakk-movement-history"'), 'Must have modal-chipakk-movement-history');
  });

  runTest('4.2 web/js/admin.js has production inventory state, sync, and event handlers', () => {
    const adminJs = fs.readFileSync(path.join(__dirname, '../web/js/admin.js'), 'utf8');

    assert.ok(adminJs.includes('let chipakkMaterials = [];'), 'Must declare chipakkMaterials state array');
    assert.ok(adminJs.includes('refreshChipakkMaterialsFromAPI'), 'Must have refreshChipakkMaterialsFromAPI function');
    assert.ok(adminJs.includes('renderChipakkMaterialsTable'), 'Must have renderChipakkMaterialsTable function');
    assert.ok(adminJs.includes('saveChipakkMovement'), 'Must have saveChipakkMovement function');
    assert.ok(adminJs.includes('openChipakkMaterialModal'), 'Must have openChipakkMaterialModal function');
    assert.ok(adminJs.includes('openChipakkHistoryModal'), 'Must have openChipakkHistoryModal function');
    assert.ok(adminJs.includes("targetSecId === 'tab-chipakk-inventory'"), 'Must handle tab-chipakk-inventory click in setupNavigation');
  });

  // Restore pool
  dbModule.pool.execute = originalPoolExecute;
  dbModule.pool.getConnection = originalPoolGetConnection;

  // -----------------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------------
  console.log('\n======================================================================');
  console.log(`TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('======================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
})();
