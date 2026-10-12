import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DWELL_SECONDS,
  shouldPage,
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

test('⛔ a board where everything fits never pages', () => {
  // This is not a screensaver. The timer exists only because the density
  // control can make the wall smaller than the show.
  assert.equal(shouldPage({ enabled: true, overflows: false, pageCount: 3 }), false);
});

test('rotation off never pages, however full the board is', () => {
  assert.equal(shouldPage({ enabled: false, overflows: true, pageCount: 3 }), false);
});

test('one page is not a rotation', () => {
  assert.equal(shouldPage({ enabled: true, overflows: true, pageCount: 1 }), false);
});

test('an overflowing board with rotation on and pages to show, pages', () => {
  assert.equal(shouldPage({ enabled: true, overflows: true, pageCount: 2 }), true);
});

test('missing information means no paging', () => {
  assert.equal(shouldPage(), false);
  assert.equal(shouldPage({}), false);
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
