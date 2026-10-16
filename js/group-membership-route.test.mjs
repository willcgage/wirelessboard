import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { IN_PAGE_ITEMS, allItems } from './admin-page.mjs';

/**
 * #243: group membership was read-only across the whole product.
 *
 * `js/dnd.js` was the only writer of a group's `slots`, and #223 retired the
 * menu-bar button that was its only caller. A group could be created, named,
 * reordered and given a dwell time, and would always be empty.
 *
 * ⛔ Three guards that look like they cover this all passed:
 *
 *  - the dead-id test wants an id referenced in JS and present in no HTML --
 *    the id and its binding were removed together, so nothing dangled;
 *  - the rail-route test wants a rail item with no route -- Groups has a rail
 *    item and that item has a route, just not to this function;
 *  - the lock test checks functions that *call* a guarded entry -- none did
 *    any more, so it had nothing to check and passed.
 *
 * ⭐ The shape they all share: **a guard that asks "does every door lead
 * somewhere" cannot see a room with no door.** These tests ask the opposite
 * question -- for a capability the product must have, is there a way in?
 */

const CONFIG = readFileSync(new URL('./config.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('./app.js', import.meta.url), 'utf8');

test('⛔ something reachable can write a group\'s membership', () => {
  // The capability, asked for directly. `slots` is the only field that is
  // membership; the other four group writes (title, order, rotate, dwell)
  // were all present and working while this was impossible.
  assert.ok(
    CONFIG.includes('membershipPayload('),
    'config.js must build a membership payload somewhere',
  );
  assert.ok(
    CONFIG.includes("postJSON('api/group', membershipPayload("),
    'and must post it — a payload nothing sends is the same bug again',
  );
});

test('⛔ the picker is built by the Groups section, not left defined and unused', () => {
  // `groupEditToggle` was defined, exported, imported into app.js and called
  // by nothing. The lint warning that found it is `continue-on-error`.
  // ⛔ The call, not the name. The first version of this asserted
  // `includes('buildMembershipPicker(row, groups, slots)')` -- which the
  // DEFINITION line `function buildMembershipPicker(row, groups, slots) {`
  // also contains. Deleting the only call site left the guard passing, and
  // that is precisely the state #243 was: a function defined and never
  // reached. Counting occurrences is what tells a declaration from a use.
  const mentions = CONFIG.split('buildMembershipPicker').length - 1;
  assert.ok(
    CONFIG.includes('function buildMembershipPicker'),
    'the picker must exist',
  );
  assert.ok(
    mentions >= 2,
    `the picker is defined and never called (${mentions} mention) — #243 exactly`,
  );
  assert.ok(
    CONFIG.includes('card.appendChild(buildMembershipPicker('),
    'and the group row must be what calls it',
  );
});

test('⛔ the Groups rail item leads to the code that draws the picker', () => {
  // The full chain, each link checked rather than assumed:
  //   rail item -> in-page section -> fillSection -> initConfigEditor
  //   -> renderGroupSummary -> buildMembershipPicker
  const groups = allItems().find((i) => i.id === 'groups');
  assert.ok(groups, 'a Groups rail item exists');
  assert.ok(
    IN_PAGE_ITEMS.includes('groups'),
    'Groups renders in the administration page rather than opening something else',
  );

  assert.ok(
    APP.includes("id === 'groups'") && APP.includes('initConfigEditor(true)'),
    'opening Groups must fill the section',
  );
  assert.ok(
    CONFIG.includes('renderGroupSummary();'),
    'and the fill must reach the group list',
  );
});

test('⛔ membership is never written together with a name', () => {
  // `update_group` edits the fields a payload carries. The rename sends
  // `title` alone precisely so it cannot clobber a membership it never
  // displayed; the picker must keep the other half of that bargain.
  const picker = CONFIG.slice(
    CONFIG.indexOf('function buildMembershipPicker'),
    CONFIG.indexOf('The recovery banner'),
  );
  assert.ok(picker.length > 500, 'found the picker body');
  assert.ok(
    !picker.includes('title:'),
    'the picker must not send a title — that is what emptied groups before',
  );
});

test('⛔⛔ the picker never redraws the list from a tick', () => {
  // Redrawing takes the focus off the box the operator just used and, on a
  // touch display, scrolls the row they were working in out from under them.
  // #180 arrived at exactly this twice, and the Slots table was rebuilt to
  // stop doing it.
  const picker = CONFIG.slice(
    CONFIG.indexOf('function buildMembershipPicker'),
    CONFIG.indexOf('The recovery banner'),
  );
  assert.ok(
    !picker.includes('renderGroupSummary('),
    'a tick must update in place, never re-render the list',
  );
  assert.ok(
    !picker.includes('initConfigEditor('),
    'and must not refill the whole section either',
  );
});
