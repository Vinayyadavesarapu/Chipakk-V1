/**
 * Store isolation for admin "get/update/delete by id" endpoints across 4 services found during the 2026-09-23
 * full-repo production audit: materialsService, finishingService, productionJobService, customRequestService.
 *
 * BUG THIS GUARDS: `materials`, `finishing_options`, `production_jobs`, and `custom_3d_requests` are genuinely
 * multi-tenant tables (each has a store_id column, and their LIST endpoints correctly filter by it), but the
 * "get one / update / adjust / delete" functions in each service selected purely by `WHERE id = ?` with no
 * store_id check at all. Any authenticated admin -- whichever store they currently have open in the UI -- could
 * read, edit, or deactivate the OTHER store's row just by guessing a sequential id (e.g. an admin viewing
 * CHIPAKK calling PUT /api/admin/materials/7 where id 7 actually belongs to THE MARSHANS). Fixed by threading
 * req.storeId from each controller into the service and scoping every by-id query with
 * `AND (store_id = ? OR store_id IS NULL)`, matching the pattern already used by the one function in each file
 * that WAS scoped correctly (materialsService.deleteMaterial).
 */
const assert = require('assert');
const { createFakePool, installFakePool } = require('./helpers/fake_db');

const results = [];
async function test(group, name, fn) {
  try { await fn(); results.push({ group, name, pass: true }); console.log(`[PASS] ${group} :: ${name}`); }
  catch (err) { results.push({ group, name, pass: false, err }); console.error(`[FAIL] ${group} :: ${name}\n       ${err && err.stack ? err.stack : err}`); }
}

function freshRequire(modPath) {
  const resolved = require.resolve(modPath);
  delete require.cache[resolved];
  return require(modPath);
}

/** True if the query text includes an explicit store_id condition (i.e. this call passed a storeId). */
const scoped = (sql) => /store_id = \?/.test(sql);

(async () => {
  // ---- materialsService: table `materials`, id=1 belongs to store 1, id=2 belongs to store 2 ----
  await test('MATERIALS', 'getMaterialById / updateMaterial / adjustStock refuse cross-store access; same-store access works', async () => {
    const rows = { 1: { id: 1, store_id: 1, name: 'CHIPAKK Vinyl', stock: 100, active: 1 }, 2: { id: 2, store_id: 2, name: 'Marshans PLA', stock: 50, active: 1 } };
    const pool = createFakePool([
      [/^SELECT \* FROM materials WHERE id = \?/, (sql, params) => {
        const row = rows[params[0]];
        if (!row) return [[]];
        if (scoped(sql) && String(row.store_id) !== String(params[1])) return [[]];
        return [[row]];
      }],
      [/^UPDATE materials SET `name` = \? WHERE id = \?/, (sql, params) => {
        const [name, id, storeId] = params;
        const row = rows[id];
        if (!row || (scoped(sql) && String(row.store_id) !== String(storeId))) return [{ affectedRows: 0 }];
        row.name = name;
        return [{ affectedRows: 1 }];
      }],
      [/^UPDATE materials SET stock = GREATEST\(0, stock \+ \?\) WHERE id = \?/, (sql, params) => {
        const [delta, id, storeId] = params;
        const row = rows[id];
        if (!row || (scoped(sql) && String(row.store_id) !== String(storeId))) return [{ affectedRows: 0 }];
        row.stock = Math.max(0, row.stock + delta);
        return [{ affectedRows: 1 }];
      }]
    ]);
    installFakePool(pool);
    const svc = freshRequire('../server/services/materialsService');

    // Cross-store read: an admin on store 2 must not be able to read store 1's material.
    assert.strictEqual(await svc.getMaterialById(1, 2), null, 'store 2 admin must not read store 1 material #1');
    // Same-store read works.
    const own = await svc.getMaterialById(1, 1);
    assert.ok(own && own.id === 1, 'store 1 admin can read its own material #1');

    // Cross-store write: an admin on store 2 must not be able to rename store 1's material.
    await assert.rejects(() => svc.updateMaterial(1, { name: 'Hijacked' }, 2), /not found/, 'store 2 admin must not update store 1 material #1');
    assert.strictEqual(rows[1].name, 'CHIPAKK Vinyl', 'store 1 material must be unchanged after the blocked cross-store update attempt');

    // Cross-store adjustStock: must not zero out the other store's stock.
    const adjusted = await svc.adjustStock(1, -1000, 2);
    assert.strictEqual(adjusted, null, 'cross-store adjustStock must report not-found, not silently succeed');
    assert.strictEqual(rows[1].stock, 100, 'store 1 stock must be unchanged after a store-2 admin\'s adjustStock attempt');

    // Same-store write still works.
    const updated = await svc.updateMaterial(1, { name: 'Renamed By Owner' }, 1);
    assert.strictEqual(updated.name, 'Renamed By Owner');
  });

  // ---- finishingService: table `finishing_options` ----
  await test('FINISHING', 'getFinishingOptionById / updateFinishingOption / deleteFinishingOption refuse cross-store access', async () => {
    const rows = { 1: { id: 1, store_id: 1, name: 'Glossy Laminate', active: 1 }, 2: { id: 2, store_id: 2, name: 'Matte Print', active: 1 } };
    const pool = createFakePool([
      [/^SELECT \* FROM finishing_options WHERE id = \?/, (sql, params) => {
        const row = rows[params[0]];
        if (!row) return [[]];
        if (scoped(sql) && String(row.store_id) !== String(params[1])) return [[]];
        return [[row]];
      }],
      [/^UPDATE finishing_options SET `name` = \? WHERE id = \?/, (sql, params) => {
        const [name, id, storeId] = params;
        const row = rows[id];
        if (!row || (scoped(sql) && String(row.store_id) !== String(storeId))) return [{ affectedRows: 0 }];
        row.name = name;
        return [{ affectedRows: 1 }];
      }],
      [/^UPDATE finishing_options SET active = 0 WHERE id = \?/, (sql, params) => {
        const [id, storeId] = params;
        const row = rows[id];
        if (!row || (scoped(sql) && String(row.store_id) !== String(storeId))) return [{ affectedRows: 0 }];
        row.active = 0;
        return [{ affectedRows: 1 }];
      }]
    ]);
    installFakePool(pool);
    const svc = freshRequire('../server/services/finishingService');

    assert.strictEqual(await svc.getFinishingOptionById(2, 1), null, 'store 1 admin must not read store 2 finishing option #2');
    await assert.rejects(() => svc.updateFinishingOption(2, { name: 'Hijacked' }, 1), /not found/);
    assert.strictEqual(rows[2].name, 'Matte Print', 'store 2 row unchanged after blocked cross-store update');

    const deleted = await svc.deleteFinishingOption(2, 1);
    assert.strictEqual(deleted, false, 'cross-store delete must report not-found');
    assert.strictEqual(rows[2].active, 1, 'store 2 row must still be active after a store-1 admin\'s delete attempt');

    const ownDelete = await svc.deleteFinishingOption(2, 2);
    assert.strictEqual(ownDelete, true);
    assert.strictEqual(rows[2].active, 0);
  });

  // ---- productionJobService: table `production_jobs` ----
  await test('PRODUCTION JOBS', 'getProductionJobById / updateProductionJobStage / advanceProductionJobStage refuse cross-store access', async () => {
    const rows = { 1: { id: 1, store_id: 1, stage: 'Order Received' }, 2: { id: 2, store_id: 2, stage: 'Printing' } };
    const pool = createFakePool([
      [/^SELECT \* FROM production_jobs WHERE id = \?/, (sql, params) => {
        const row = rows[params[0]];
        if (!row) return [[]];
        if (scoped(sql) && String(row.store_id) !== String(params[1])) return [[]];
        return [[row]];
      }],
      [/^UPDATE production_jobs SET stage = \?/, (sql, params) => {
        // params: [stage, (stage_notes?), id, (storeId?)] -- id is always second-to-last if scoped, else last
        const storeId = scoped(sql) ? params[params.length - 1] : null;
        const id = scoped(sql) ? params[params.length - 2] : params[params.length - 1];
        const row = rows[id];
        if (!row || (storeId !== null && String(row.store_id) !== String(storeId))) return [{ affectedRows: 0 }];
        row.stage = params[0];
        return [{ affectedRows: 1 }];
      }]
    ]);
    installFakePool(pool);
    const svc = freshRequire('../server/services/productionJobService');

    assert.strictEqual(await svc.getProductionJobById(2, 1), null, 'store 1 admin must not read store 2 job #2');
    const notAdvanced = await svc.updateProductionJobStage(2, 'Completed', null, 1);
    assert.strictEqual(notAdvanced, null, 'cross-store stage update must not silently apply');
    assert.strictEqual(rows[2].stage, 'Printing', 'store 2 job stage unchanged after a store-1 admin\'s attempt');

    await assert.rejects(() => svc.advanceProductionJobStage(2, 1), /not found/, 'cross-store advance must be refused, not silently no-op the wrong job');

    const advanced = await svc.advanceProductionJobStage(1, 1);
    assert.strictEqual(advanced.stage, 'Preparing', 'same-store advance still works');
  });

  // ---- customRequestService: table `custom_3d_requests` ----
  await test('CUSTOM REQUESTS', 'getCustomRequestById / updateCustomRequestStatus / setCustomRequestQuote refuse cross-store access', async () => {
    const rows = { 1: { id: 1, store_id: 1, status: 'Upload', quote_amount: null }, 2: { id: 2, store_id: 2, status: 'Upload', quote_amount: null } };
    const pool = createFakePool([
      [/^SELECT \* FROM custom_3d_requests WHERE id = \?/, (sql, params) => {
        const row = rows[params[0]];
        if (!row) return [[]];
        if (scoped(sql) && String(row.store_id) !== String(params[1])) return [[]];
        return [[row]];
      }],
      [/^UPDATE custom_3d_requests SET status = \?/, (sql, params) => {
        const storeId = scoped(sql) ? params[params.length - 1] : null;
        const id = scoped(sql) ? params[params.length - 2] : params[params.length - 1];
        const row = rows[id];
        if (!row || (storeId !== null && String(row.store_id) !== String(storeId))) return [{ affectedRows: 0 }];
        row.status = params[0];
        return [{ affectedRows: 1 }];
      }],
      [/^UPDATE custom_3d_requests\s+SET\s+quote_amount = \?/, (sql, params) => {
        // params: [quote_amount, quote_lead_days, admin_notes, id, (storeId?)]
        const storeId = scoped(sql) ? params[params.length - 1] : null;
        const id = scoped(sql) ? params[params.length - 2] : params[params.length - 1];
        const row = rows[id];
        if (!row || (storeId !== null && String(row.store_id) !== String(storeId))) return [{ affectedRows: 0 }];
        row.quote_amount = params[0];
        row.status = 'Quotation';
        return [{ affectedRows: 1 }];
      }]
    ]);
    installFakePool(pool);
    const svc = freshRequire('../server/services/customRequestService');

    assert.strictEqual(await svc.getCustomRequestById(2, 1), null, 'store 1 admin must not read store 2 request #2');

    const notUpdated = await svc.updateCustomRequestStatus(2, 'Rejected', null, 1);
    assert.strictEqual(notUpdated, null, 'cross-store status update must not silently apply');
    assert.strictEqual(rows[2].status, 'Upload', 'store 2 request status unchanged after a store-1 admin\'s attempt');

    const notQuoted = await svc.setCustomRequestQuote(2, { quote_amount: 999900 }, 1);
    assert.strictEqual(notQuoted, null, 'cross-store quote must not silently apply');
    assert.strictEqual(rows[2].quote_amount, null, 'store 2 request must have no quote after a store-1 admin\'s attempt');

    const ownQuote = await svc.setCustomRequestQuote(2, { quote_amount: 150000 }, 2);
    assert.strictEqual(ownQuote.quote_amount, 150000, 'same-store quote still works');
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`\nSTORE ISOLATION BY-ID: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.error('FAILED:\n' + failed.map((f) => ` - ${f.group} :: ${f.name}`).join('\n')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('Fatal test harness error:', e); process.exit(1); });
