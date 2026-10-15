import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DWELL_SECONDS,
  ALL_CHANNELS_TITLE,
  pagingReason,
  pagesForBoard,
  rotates,
  dwellFor,
  buildPages,
  alertPageIndex,
  nextPage,
  rotationLabel,
} from './rotation.mjs';

const GROUPS = [
  { group: 1, title: 'Worship', slots: [1, 2, 3, 4] },
  { group: 2, title: 'Teaching', slots: [5, 6] },
  { group: 3, title: 'Drama', slots: [7, 8, 9] },
];

test('⛔ a board where everything fits does not page on its own', () => {
  // This is not a screensaver. A board with room for every channel only cycles
  // because the operator asked it to.
  assert.equal(pagingReason({ rotationPref: 'off', overflows: false, pageCount: 3 }), null);
  assert.equal(pagingReason({ rotationPref: 'on', overflows: false, pageCount: 3 }), 'requested');
});

test('⛔ a board that cannot show every channel pages whatever the switch says', () => {
  // ⚠️ This inverts the old rule, deliberately. It used to read "rotation off
  // never pages, however full the board is" -- which meant an operator could
  // switch off the only thing bringing the twelfth channel round, and the board
  // would simply not show it. Hiding a channel is the one failure this display
  // cannot afford, so overflow outranks the preference.
  //
  // The stored preference is NOT rewritten; it is just not the deciding input
  // here. What the operator sees instead is the board saying why it is paging.
  assert.equal(pagingReason({ rotationPref: 'off', overflows: true, pageCount: 3 }), 'required');
  assert.equal(pagingReason({ rotationPref: 'on', overflows: true, pageCount: 3 }), 'required');
});

test('one page is not a rotation', () => {
  assert.equal(pagingReason({ rotationPref: 'on', overflows: true, pageCount: 1 }), null);
  assert.equal(pagingReason({ rotationPref: 'on', overflows: false, pageCount: 1 }), null);
});

test('⭐ the reason is the answer, and it also reads as a yes-or-no', () => {
  // A caller that only wants to know *whether* gets the right answer from the
  // same call, so no second helper exists to drift from this one.
  assert.ok(pagingReason({ rotationPref: 'off', overflows: true, pageCount: 2 }));
  assert.ok(!pagingReason({ rotationPref: 'off', overflows: false, pageCount: 2 }));
});

test('missing information means no paging', () => {
  assert.equal(pagingReason(), null);
  assert.equal(pagingReason({}), null);
});

test('⚠️ a group takes part unless it says otherwise', () => {
  // A board that turned rotation on and saw nothing, because no group had
  // opted in, would look broken. The per-group switch is for taking one out.
  assert.equal(rotates({ group: 1 }), true);
  assert.equal(rotates({ group: 1, rotate: true }), true);
  assert.equal(rotates({ group: 1, rotate: false }), false);
});

test('pages are built from groups, in list order', () => {
  const pages = buildPages(GROUPS, { perPage: 6 });

  assert.deepEqual(pages.map((p) => p.title), ['Worship', 'Teaching', 'Drama']);
});

test('a group taken out of the rotation is not a page', () => {
  const pages = buildPages(
    [...GROUPS, {
      group: 4, title: 'Spare', slots: [10], rotate: false,
    }],
    { perPage: 6 },
  );

  assert.equal(pages.some((p) => p.title === 'Spare'), false);
});

test('⚠️ a group with no channels is not a page', () => {
  // An empty wall for twenty seconds reads as a fault.
  const pages = buildPages([{ group: 9, title: 'Empty', slots: [] }], { perPage: 6 });

  assert.deepEqual(pages, []);
});

test('a group bigger than the page becomes several pages', () => {
  const pages = buildPages([{ group: 1, title: 'Worship', slots: [1, 2, 3, 4, 5] }], { perPage: 2 });

  assert.deepEqual(pages.map((p) => p.slots), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(pages.map((p) => `${p.part}/${p.parts}`), ['1/3', '2/3', '3/3']);
});

test('⚠️ each part holds for the full dwell rather than sharing it', () => {
  // Dividing it makes the biggest groups — the ones with the most to read —
  // flash past fastest, which is backwards.
  const pages = buildPages(
    [{
      group: 1, title: 'Big', slots: [1, 2, 3, 4], dwell: 30,
    }],
    { perPage: 2 },
  );

  assert.deepEqual(pages.map((p) => p.dwell), [30, 30]);
});

test('dwell falls back, and is bounded', () => {
  assert.equal(dwellFor({}), DEFAULT_DWELL_SECONDS);
  assert.equal(dwellFor({ dwell: 45 }), 45);
  // A page nobody can read is worse than no rotation.
  assert.equal(dwellFor({ dwell: 1 }), 5);
  assert.equal(dwellFor({ dwell: 99999 }), 600);
  assert.equal(dwellFor({ dwell: 'soon' }), DEFAULT_DWELL_SECONDS);
});

test('the rotation advances one page at a time and wraps', () => {
  const pages = buildPages(GROUPS, { perPage: 6 });

  assert.equal(nextPage({ pages, current: 0 }).index, 1);
  assert.equal(nextPage({ pages, current: 2 }).index, 0);
});

test('⛔ a channel in trouble stops the rotation on its page', () => {
  // The failure this whole feature could cause is a channel going critical on
  // a page nobody is looking at.
  const pages = buildPages(GROUPS, { perPage: 6 });
  const step = nextPage({ pages, current: 0, criticalSlots: [8] });

  assert.equal(step.index, 2);
  assert.equal(step.held, true);
  assert.match(step.reason, /needs attention/);
});

test('it holds there while the alert lasts rather than resuming', () => {
  const pages = buildPages(GROUPS, { perPage: 6 });

  assert.equal(nextPage({ pages, current: 2, criticalSlots: [8] }).index, 2);
});

test('⚠️ two failing channels cannot make the board flap between pages', () => {
  // The first alerting page wins and keeps winning.
  const pages = buildPages(GROUPS, { perPage: 6 });

  assert.equal(nextPage({ pages, current: 0, criticalSlots: [8, 2] }).index, 0);
  assert.equal(nextPage({ pages, current: 2, criticalSlots: [8, 2] }).index, 0);
});

test('a critical channel on no page does not hold the rotation', () => {
  const pages = buildPages(GROUPS, { perPage: 6 });

  assert.equal(alertPageIndex(pages, [99]), null);
  assert.equal(nextPage({ pages, current: 0, criticalSlots: [99] }).held, false);
});

test('⚠️ the page does not move under someone using the board', () => {
  // The same discourtesy as a dialog stealing focus.
  const pages = buildPages(GROUPS, { perPage: 6 });
  const step = nextPage({ pages, current: 1, interacting: true });

  assert.equal(step.index, 1);
  assert.equal(step.held, true);
  assert.equal(step.reason, 'in use');
});

test('an alert outranks someone using the board', () => {
  const pages = buildPages(GROUPS, { perPage: 6 });

  assert.equal(nextPage({
    pages, current: 0, criticalSlots: [8], interacting: true,
  }).index, 2);
});

test('no pages is held, not a crash', () => {
  const step = nextPage({ pages: [], current: 3 });

  assert.equal(step.index, 0);
  assert.equal(step.held, true);
});

test('a nonsense current index does not escape the list', () => {
  const pages = buildPages(GROUPS, { perPage: 6 });

  assert.equal(nextPage({ pages, current: -5 }).index, 1);
  assert.equal(nextPage({ pages, current: 99 }).index, 1);
  assert.equal(nextPage({ pages, current: 'two' }).index, 1);
});

test('the label names the group, and the part when there is more than one', () => {
  const pages = buildPages(GROUPS, { perPage: 6 });

  assert.equal(rotationLabel(pages, 0), 'Worship');

  const split = buildPages([{ group: 1, title: 'Worship', slots: [1, 2, 3] }], { perPage: 2 });
  assert.equal(rotationLabel(split, 0), 'Worship (1/2)');
});

test('an untitled group still has a label', () => {
  const pages = buildPages([{ group: 7, slots: [1] }], { perPage: 6 });

  assert.equal(rotationLabel(pages, 0), 'Group 7');
});

test('rubbish in does not throw', () => {
  assert.deepEqual(buildPages(null), []);
  assert.deepEqual(buildPages([{ group: 1, slots: 'all of them' }], { perPage: 2 }), []);
  assert.equal(alertPageIndex(null, [1]), null);
  assert.equal(rotationLabel([], 0), '');
});

// ---------------------------------------------------------------------------
// #201/#202 — the capacity that was always asked for and never supplied
// ---------------------------------------------------------------------------

test('⛔ a capacity splits a group; no capacity never did', () => {
  // ⚠️ This is the whole reason none of this ran. `buildPages` has taken
  // `perPage` since #113, and the one production caller passed
  // `micboard.rotationPerPage` — read there and written nowhere in the project.
  // It was always undefined, so the capacity fell to Infinity.
  const group = [{ group: 1, title: 'Worship', slots: [1, 2, 3, 4, 5, 6, 7, 8] }];

  const unsupplied = buildPages(group, { perPage: undefined });
  assert.equal(unsupplied.length, 1, 'no capacity is how it behaved for years: one page');
  assert.equal(unsupplied[0].slots.length, 8);

  const supplied = buildPages(group, { perPage: 3 });
  assert.equal(supplied.length, 3, 'a capacity of three splits eight into three pages');
  assert.deepEqual(supplied.map((p) => p.slots.length), [3, 3, 2]);
});

test('⛔ every channel survives being paged', () => {
  // The rule that has not moved: shown now, or on a page that exists. A channel
  // that appears on no page has been hidden, which is the one failure this
  // display cannot afford.
  const slots = Array.from({ length: 29 }, (_, i) => i + 1);
  for (const perPage of [1, 2, 5, 12, 28, 29, 30]) {
    const pages = buildPages([{ group: 1, title: 'All', slots }], { perPage });
    const seen = pages.flatMap((p) => p.slots);
    assert.deepEqual(
      seen,
      slots,
      `perPage ${perPage}: the pages do not add back up to the channels`,
    );
  }
});

test('⭐ a board with no groups can still be paged', () => {
  // ⛔ `buildPages` works from the group list, so a board that never configured
  // one produced an empty page list and could not page at all — which would
  // have left the guarantee holding only for boards that happen to use groups.
  // The driver stands an implicit group in; this is the shape it passes.
  const implicit = [{ group: 0, title: '', slots: [4, 5, 6, 7] }];
  const pages = buildPages(implicit, { perPage: 2 });
  assert.equal(pages.length, 2);
  assert.deepEqual(pages.flatMap((p) => p.slots), [4, 5, 6, 7]);
  assert.equal(pages[0].parts, 2, 'and it still reports which part of how many');
});

// --------------------------------------------------------------------------
// What a forced board pages through (#215)
//
// ⛔ The fault: every page was built from `config.groups` whatever the board
// was showing, so a wall set to *All channels* that ran out of room was handed
// Group 1's slots in Group 1's order. The maintainer's rule is "all channels in
// slot order unless the group has been specified".
// --------------------------------------------------------------------------

// Deliberately not in slot order, and not covering every slot. A group that
// matched the board's own order could not tell the two page sources apart --
// which is exactly why the original fault survived.
const SCRAMBLED = [
  { group: 1, title: 'Worship', slots: [1, 3, 2, 4] },
  { group: 2, title: 'Teaching', slots: [5, 6] },
];
const ALL_TWELVE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

test('⛔ showing All channels and forced to page: all channels, in slot order', () => {
  const { pages, why } = pagesForBoard({
    capacity: 4, shown: ALL_TWELVE, group: 0, groups: SCRAMBLED, rotationPref: 'off',
  });

  assert.equal(why, 'required');
  assert.deepEqual(
    pages.map((p) => p.slots),
    [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]],
    'every channel appears exactly once, in slot order',
  );
  // ⭐ The regression itself: Group 1's order is 1,3,2,4 and must not be what
  // a board showing everything receives.
  assert.notDeepEqual(pages[0].slots, [1, 3, 2, 4]);
});

test('⛔ the board does not lose a channel to paging', () => {
  const { pages } = pagesForBoard({
    capacity: 5, shown: ALL_TWELVE, group: 0, groups: SCRAMBLED, rotationPref: 'off',
  });
  const seen = pages.flatMap((p) => p.slots);
  assert.deepEqual([...seen].sort((a, b) => a - b), ALL_TWELVE);
  assert.equal(new Set(seen).size, seen.length, 'and shows none of them twice');
});

test('⭐ showing a group and forced to page: that group, in its own order', () => {
  const { pages, why } = pagesForBoard({
    capacity: 2, shown: [1, 3, 2, 4], group: 1, groups: SCRAMBLED, rotationPref: 'off',
  });

  assert.equal(why, 'required');
  assert.deepEqual(pages.map((p) => p.slots), [[1, 3], [2, 4]]);
  assert.equal(pages[0].title, 'Worship', 'and it keeps the group name it was given');
});

test('⚠️ a forced page never reads "Group 0"', () => {
  // `rotationLabel` falls back to `Group ${page.group}`, so the implicit
  // whole-board page used to be named after an internal sentinel.
  const { pages } = pagesForBoard({
    capacity: 4, shown: ALL_TWELVE, group: 0, groups: [], rotationPref: 'off',
  });
  assert.equal(pages[0].title, ALL_CHANNELS_TITLE);
  assert.match(rotationLabel(pages, 0), /^All channels/);
  assert.doesNotMatch(rotationLabel(pages, 0), /Group 0/);
});

test('⛔ a group with rotate:false still pages when the board must', () => {
  // `rotate` takes a group out of the *group cycle*. It may never cost the
  // operator a channel on a board that is being asked to show it.
  const quiet = [{
    group: 1, title: 'Worship', slots: [1, 2, 3, 4], rotate: false,
  }];
  const { pages, why } = pagesForBoard({
    capacity: 2, shown: [1, 2, 3, 4], group: 1, groups: quiet, rotationPref: 'off',
  });
  assert.equal(why, 'required');
  assert.deepEqual(pages.map((p) => p.slots), [[1, 2], [3, 4]]);
});

test('⭐ the dwell of a selected group still applies on the forced path', () => {
  const slow = [{
    group: 1, title: 'Worship', slots: [1, 2, 3, 4], dwell: 45,
  }];
  const { pages } = pagesForBoard({
    capacity: 2, shown: [1, 2, 3, 4], group: 1, groups: slow, rotationPref: 'off',
  });
  assert.deepEqual(pages.map((p) => p.dwell), [45, 45]);
});

test('⭐ the switch being on still cycles the configured groups', () => {
  // Everything fits, so nothing is forced: this is the rotation #113 built, and
  // #215 must not have taken it away.
  const { pages, why } = pagesForBoard({
    capacity: 12, shown: ALL_TWELVE, group: 0, groups: SCRAMBLED, rotationPref: 'on',
  });
  assert.equal(why, 'requested');
  assert.deepEqual(pages.map((p) => p.title), ['Worship', 'Teaching']);
  assert.deepEqual(pages[0].slots, [1, 3, 2, 4], 'in the order the operator configured');
});

test('⛔ required outranks requested, and takes the shown content with it', () => {
  const { pages, why } = pagesForBoard({
    capacity: 4, shown: ALL_TWELVE, group: 0, groups: SCRAMBLED, rotationPref: 'on',
  });
  assert.equal(why, 'required');
  assert.deepEqual(pages[0].slots, [1, 2, 3, 4]);
});

test('a board where everything fits and the switch is off has no pages', () => {
  assert.deepEqual(
    pagesForBoard({
      capacity: 12, shown: ALL_TWELVE, group: 0, groups: SCRAMBLED, rotationPref: 'off',
    }),
    { pages: [], why: null },
  );
});

test('⚠️ a board with no groups configured still pages through everything', () => {
  // The old implicit-group fallback only ran when there were no groups at all,
  // so this case worked and the one above it did not. Both must now.
  const { pages, why } = pagesForBoard({
    capacity: 4, shown: ALL_TWELVE, group: 0, groups: [], rotationPref: 'off',
  });
  assert.equal(why, 'required');
  assert.equal(pages.length, 3);
});

test('an unmeasured board does not page', () => {
  // `boardCapacity` is Infinity until `updateTvLayoutMetrics` has run. Paging
  // on that would page a board nobody has measured.
  assert.equal(pagesForBoard({
    capacity: Infinity, shown: ALL_TWELVE, group: 0, groups: [], rotationPref: 'off',
  }).why, null);
});

test('blanks and junk in the display list are not channels', () => {
  const { pages } = pagesForBoard({
    capacity: 2,
    shown: [1, 0, 2, null, 3, undefined, 4, 'x'],
    group: 0,
    groups: [],
    rotationPref: 'off',
  });
  assert.deepEqual(pages.flatMap((p) => p.slots), [1, 2, 3, 4]);
});
