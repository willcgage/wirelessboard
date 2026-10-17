import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { NEXT_PLAN, syncPlanParam, resolvePlanId } from './plan-choice.mjs';

/**
 * ⛔⛔ The sentinel must never be sent as a plan id.
 *
 * `__next__` is the select's value for "next upcoming". The worked example
 * read the select's RAW value and put it in the query string, so the board
 * asked Planning Center for `/plans/__next__/plan_people` and was told, with
 * some justice, **"You must pass a plan id"**.
 *
 * ⭐ That one slip produced every Planning Center failure across three venue
 * tests, from the live board's own logs:
 *
 *   PCO plan __next__: roster unreadable -- the plan_people sweep (no service
 *   type set, so every one was tried) returned 400, after 83 path(s)
 *
 * An explicit plan id makes `_select_plan` return no service type, so the
 * server fell back to sweeping EVERY service type over three endpoints each.
 * Hence "no service type set" on a board that has one (`service_type_id:
 * "1788894"`), hence 83 requests, hence the eventual 429.
 *
 * ⚠️ Three separate symptoms, one cause. The 400, the contradiction and the
 * rate limiting were never three bugs.
 */

const ROOT = path.join(import.meta.dirname, '..');
const CONFIG = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8');

test('⛔ "next upcoming" sends no plan at all', () => {
  // Not the id resolved when the panel was opened: a board left up for a week
  // would otherwise check last Sunday's plan.
  assert.equal(syncPlanParam(NEXT_PLAN), null);
  assert.equal(syncPlanParam(''), null);
  assert.equal(syncPlanParam('91062751'), '91062751');
});

test('⛔ no request is built from the select\'s raw value', () => {
  // The whole bug in one line: `planSel.value` is the sentinel, and it went
  // straight into the query string.
  assert.ok(
    !/const plan = \(planSel && planSel\.value\) \|\| '';/.test(CONFIG),
    'the raw select value must not become a plan id',
  );
  assert.match(
    CONFIG,
    /const plan = syncPlanParam\(\(planSel && planSel\.value\) \|\| ''\)/,
    'the worked example asks through syncPlanParam, like the sync beside it',
  );
});

test('⛔ every plan query in config.js goes through a resolver', () => {
  // The general shape, so the next surface that wants a plan cannot repeat
  // this. Any `plan=` built from something other than `syncPlanParam` or
  // `selectedPlanId` is the same mistake again.
  const builders = CONFIG.match(/plan=\$\{encodeURIComponent\(([^)]+)\)\}/g) || [];
  assert.ok(builders.length >= 3, 'found the plan query builders');

  const allowed = /encodeURIComponent\((plan|planId|planParam)\)/;
  const offenders = builders.filter((b) => !allowed.test(b));
  assert.deepEqual(
    offenders,
    [],
    `these build a plan query from something unresolved: ${offenders}`,
  );
});

test('resolvePlanId refuses to turn the sentinel into an id', () => {
  // The other half of the pair, and it was always right: with no resolved
  // next plan it yields '' rather than passing the sentinel along.
  assert.equal(resolvePlanId(NEXT_PLAN, null), '');
  assert.equal(resolvePlanId(NEXT_PLAN, { ok: false, plan_id: '1' }), '');
  assert.equal(resolvePlanId(NEXT_PLAN, { ok: true, plan_id: '91062751' }), '91062751');
  assert.equal(resolvePlanId('91062751', null), '91062751');
});

test('⚠️ the sentinel is a value no real plan id could take', () => {
  // Planning Center plan ids are numeric strings. If the sentinel ever became
  // something id-shaped, every guard above would still pass and the server
  // could not tell the difference either.
  assert.match(NEXT_PLAN, /^__[a-z]+__$/);
  assert.ok(!/^\d+$/.test(NEXT_PLAN));
});
