import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NEXT_PLAN,
  planLabel,
  nextPlanOptionLabel,
  resolvePlanId,
  syncPlanParam,
  planDescription,
  planBlocker,
} from './plan-choice.mjs';

const RESOLVED = {
  ok: true, plan_id: '77', label: 'Sun, Oct 12', service_type_id: 3,
};
const FAILED = { ok: false, error: 'No upcoming plan found' };

test('a plan label joins only the parts Planning Center filled in', () => {
  // Most plans carry no title, and a scoped list omits the service type name.
  assert.equal(planLabel({ short_dates: 'Aug 2' }), 'Aug 2');
  assert.equal(
    planLabel({ service_type_name: 'Sunday AM', short_dates: 'Aug 2', title: 'Baptism' }),
    'Sunday AM — Aug 2 — Baptism',
  );
});

test('short dates win over long ones', () => {
  assert.equal(planLabel({ short_dates: 'Aug 2', dates: 'August 2, 2026' }), 'Aug 2');
});

test('a plan with nothing on it labels as empty, not as dashes', () => {
  assert.equal(planLabel({}), '');
  assert.equal(planLabel(null), '');
});

test('the next-upcoming option names the plan once it is known', () => {
  // ⭐ The point of resolving it server-side: the operator can confirm the one
  // fact they came to check instead of trusting the board about it.
  assert.equal(nextPlanOptionLabel(RESOLVED), 'Next upcoming — Sun, Oct 12');
});

test('it still reads sensibly before it resolves, or when it cannot', () => {
  assert.equal(nextPlanOptionLabel(null), 'Next upcoming');
  assert.equal(nextPlanOptionLabel(FAILED), 'Next upcoming');
  assert.equal(nextPlanOptionLabel({ ok: true, plan_id: '9' }), 'Next upcoming');
});

test('a chosen plan resolves to itself', () => {
  assert.equal(resolvePlanId('42', RESOLVED), '42');
});

test('next resolves to the plan the server named', () => {
  assert.equal(resolvePlanId(NEXT_PLAN, RESOLVED), '77');
});

test('next resolves to nothing when the server could not say', () => {
  assert.equal(resolvePlanId(NEXT_PLAN, FAILED), '');
  assert.equal(resolvePlanId(NEXT_PLAN, undefined), '');
});

test('blank is still nothing chosen', () => {
  assert.equal(resolvePlanId('', RESOLVED), '');
});

test('⛔ a sync on "next" sends no plan at all', () => {
  // Not the id resolved when the panel was opened. A board left up for a week
  // would otherwise sync the plan that was next upcoming last Sunday.
  assert.equal(syncPlanParam(NEXT_PLAN), null);
});

test('a sync on a chosen plan sends that plan', () => {
  assert.equal(syncPlanParam('42'), '42');
});

test('a sync with nothing chosen also lets the server decide, as it always did', () => {
  assert.equal(syncPlanParam(''), null);
});

test('the log says which plan, and how it was arrived at', () => {
  assert.equal(planDescription(NEXT_PLAN, RESOLVED), 'next upcoming, plan 77');
  assert.equal(planDescription(NEXT_PLAN, FAILED), 'next upcoming');
  assert.equal(planDescription('42', RESOLVED), 'plan 42');
  assert.equal(planDescription('', RESOLVED), 'no plan chosen');
});

test('⚠️ an unresolved "next" is a different complaint from choosing nothing', () => {
  // Telling an operator to choose a plan when they already chose one is how a
  // board teaches people to ignore what it says.
  assert.equal(planBlocker('', RESOLVED), 'Select a plan first.');
  assert.match(planBlocker(NEXT_PLAN, FAILED), /which plan is next/);
});

test('the blocker repeats the server’s reason when there is one', () => {
  assert.match(planBlocker(NEXT_PLAN, FAILED), /No upcoming plan found/);
});

test('nothing blocks once a plan resolves', () => {
  assert.equal(planBlocker(NEXT_PLAN, RESOLVED), null);
  assert.equal(planBlocker('42', FAILED), null);
});
