import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldNotify, noticeText, watchProblem, checkedAgo, noticeKey, autoSync, autoSyncStillWorthSaying, noticeTone, AUTO_SYNC_NOTICE_SECONDS,
} from './plan-change.mjs';

const CHANGED = { changed: true, plan_id: '77', checked_at: 1000 };
const UNCHANGED = { changed: false, plan_id: '77', checked_at: 1000 };

test('a changed plan is worth saying something about', () => {
  assert.equal(shouldNotify(CHANGED), true);
});

test('an unchanged plan, or nothing being watched, is silent', () => {
  assert.equal(shouldNotify(UNCHANGED), false);
  assert.equal(shouldNotify({}), false);
  assert.equal(shouldNotify(null), false);
  assert.equal(shouldNotify(undefined), false);
});

test('⚠️ the notice says what it means for the board, not what the API reported', () => {
  // "Plan 77 updated_at changed" is true and useless. What the operator needs
  // to know is that the names on screen may now be wrong.
  const text = noticeText(CHANGED);

  assert.match(text, /names on the board may be out of date/);
  assert.doesNotMatch(text, /updated_at/);
});

test('nothing to say when nothing changed', () => {
  assert.equal(noticeText(UNCHANGED), null);
  assert.equal(noticeText(null), null);
});

test('⭐ a failed check is reported alongside a warning, not instead of it', () => {
  // A warning that comes and goes with the network is one people stop
  // believing, so the standing "changed" survives a failed poll.
  const flaky = { ...CHANGED, error: 'Unable to reach Planning Center' };

  assert.equal(shouldNotify(flaky), true);
  assert.match(watchProblem(flaky), /Unable to reach Planning Center/);
});

test('no error means no problem line', () => {
  assert.equal(watchProblem(CHANGED), null);
  assert.equal(watchProblem({}), null);
  assert.equal(watchProblem(null), null);
});

test('⚠️ how long ago the check was is shown, because silence is ambiguous', () => {
  // No warning means "nothing had changed as of the last check", not "nothing
  // has changed". The timestamp is the only way to tell those apart.
  assert.equal(checkedAgo({ checked_at: 1000 }, 1_030_000), 'checked just now');
  assert.equal(checkedAgo({ checked_at: 1000 }, 1_300_000), 'checked 5 minutes ago');
  assert.equal(checkedAgo({ checked_at: 1000 }, 8_200_000), 'checked 2 hours ago');
});

test('one hour reads as singular', () => {
  assert.equal(checkedAgo({ checked_at: 1000 }, 4_600_000), 'checked 1 hour ago');
});

test('an unknown check time says nothing rather than guessing', () => {
  assert.equal(checkedAgo({}, 1000), null);
  assert.equal(checkedAgo({ checked_at: 0 }, 1000), null);
  assert.equal(checkedAgo({ checked_at: 'soon' }, 1000), null);
  assert.equal(checkedAgo(null, 1000), null);
});

test('a clock skew does not produce a negative age', () => {
  assert.equal(checkedAgo({ checked_at: 5000 }, 1000), 'checked just now');
});

test('⛔ the key is stable while the same notice stands', () => {
  // The payload arrives several times a second. Re-rendering each time would
  // retrigger any animation and steal focus from a button somebody is
  // reaching for.
  assert.equal(noticeKey(CHANGED), noticeKey({ ...CHANGED, checked_at: 9999 }));
});

test('the key changes when the plan or the verdict does', () => {
  assert.notEqual(noticeKey(CHANGED), noticeKey({ ...CHANGED, plan_id: '78' }));
  assert.notEqual(noticeKey(CHANGED), noticeKey(UNCHANGED));
});

test('no notice is an empty key, so nothing renders', () => {
  assert.equal(noticeKey(UNCHANGED), '');
  assert.equal(noticeKey(null), '');
});

/**
 * Automatic re-sync (#140), the half that reverses #120's rule.
 *
 * ⛔ The board rewrote itself with nobody present. Everything here is about
 * that fact reaching a person afterwards.
 */
const auto = (entry, extra = {}) => ({
  plan_id: '42', changed: false, auto_sync: entry, ...extra,
});
const NOW = 1_000_000_000_000;
const secondsAgo = (n) => NOW / 1000 - n;

test('⭐ a clean automatic sync reports what it did', () => {
  const change = auto({
    at: secondsAgo(60),
    ok: true,
    needs_attention: false,
    summary: 'Synced automatically — 3 slots updated.',
  });

  assert.ok(shouldNotify(change, NOW));
  assert.equal(noticeText(change, NOW), 'Synced automatically — 3 slots updated.');
  assert.equal(noticeTone(change), 'done', 'a board that fixed itself is not a warning');
});

test('and that report expires, because it is news rather than a problem', () => {
  const entry = {
    at: secondsAgo(AUTO_SYNC_NOTICE_SECONDS + 60), ok: true, needs_attention: false, summary: 'Synced automatically.',
  };

  assert.ok(!autoSyncStillWorthSaying(auto(entry), NOW));
  assert.ok(!shouldNotify(auto(entry), NOW), 'an expired success is not worth a bar');
});

test('⛔ but a failure never expires', () => {
  // A notice that times out is a notice that did not reach anybody.
  const entry = {
    at: secondsAgo(86400), ok: false, needs_attention: true, summary: 'Automatic sync failed: boom',
  };

  assert.ok(autoSyncStillWorthSaying(auto(entry), NOW));
  assert.equal(noticeTone(auto(entry)), 'problem');
  assert.match(noticeText(auto(entry), NOW), /failed/);
});

test('⛔ nor does one that left a contested slot for a person', () => {
  const entry = {
    at: secondsAgo(86400),
    ok: true,
    needs_attention: true,
    summary: 'Synced automatically — 1 slot updated. 1 slot left alone (claimed by two people) — these still need checking.',
  };

  assert.ok(autoSyncStillWorthSaying(auto(entry), NOW));
  assert.equal(noticeTone(auto(entry)), 'problem', 'somebody still has to decide');
});

test('⚠️ a stale board outranks an old success', () => {
  // The plan changed *again* since the automatic sync. What is on screen is
  // wrong now, which matters more than what the board did an hour ago.
  const change = auto(
    {
      at: secondsAgo(60), ok: true, needs_attention: false, summary: 'Synced automatically — 3 slots updated.',
    },
    { changed: true },
  );

  assert.match(noticeText(change, NOW), /may be out of date/);
  assert.equal(noticeTone(change), 'stale');
});

test('a board with no automatic sync is unchanged by any of this', () => {
  assert.ok(!shouldNotify({ plan_id: '42', changed: false }));
  assert.equal(autoSync({ plan_id: '42' }), null);
  assert.equal(noticeTone({ changed: true }), 'stale');
});

test('⛔ the bar re-renders when the automatic sync result changes', () => {
  // Otherwise the first report stays on screen through the second sync.
  const first = auto({
    at: secondsAgo(600), ok: true, needs_attention: false, summary: 'a',
  });
  const second = auto({
    at: secondsAgo(60), ok: true, needs_attention: false, summary: 'b',
  });

  assert.notEqual(noticeKey(first, NOW), noticeKey(second, NOW));
});
