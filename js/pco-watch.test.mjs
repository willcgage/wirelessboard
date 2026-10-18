import test from 'node:test';
import assert from 'node:assert/strict';

import { watchLines, sinceWords } from './pco-watch.mjs';

/**
 * ⭐⭐ The section has to answer "what happens if I walk away".
 *
 * ⛔ The fault this exists for: a board with watching switched on, an interval
 * set, and a watcher that is **not armed** — because `_LAST_SYNC` is in memory
 * and nothing has synced since the process started. Every setting reads "on"
 * and nothing happens. That was true of the venue board while it was being
 * discussed, and no screen said so.
 */

const armed = {
  ok: true,
  watching: true,
  armed: true,
  auto_sync: true,
  clear_unmatched: false,
  plan_id: '91062751',
  profile: 'Sunday',
  interval_seconds: 120,
  grace_minutes: 60,
  changed: false,
  finished: false,
  checked_at: null,
  error: null,
};

const texts = (report, now) => watchLines(report, now).map((l) => l.text).join(' | ');

test('⛔⛔ watching but never synced says so, and says what starts it', () => {
  const lines = watchLines({ ...armed, armed: false });

  assert.equal(lines.length, 1, 'one fact, because nothing below it is in force');
  assert.equal(lines[0].level, 'warn');
  assert.match(lines[0].text, /not synced since it started/);
  assert.match(lines[0].text, /first sync is what starts it/);
});

test('⛔ not watching at all is a different sentence', () => {
  const lines = watchLines({ ...armed, watching: false });

  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'off');
  assert.match(lines[0].text, /does not watch/);
  // ⚠️ Must not claim it is armed or report an interval: neither applies.
  assert.doesNotMatch(lines[0].text, /seconds/);
});

test('⭐ an armed watcher names the plan, the rules and the interval', () => {
  const out = texts(armed);

  assert.match(out, /Watching plan 91062751/);
  assert.match(out, /“Sunday” rules/);
  assert.match(out, /every 120 seconds/);
});

test('⛔⛔ it says whether a change would be APPLIED or only reported', () => {
  // The difference between a board that fixes itself and one that tells you to.
  assert.match(texts({ ...armed, auto_sync: true }), /applies itself/);
  assert.match(texts({ ...armed, auto_sync: false }), /reported and not applied/);
});

test('⛔⛔ and warns when a sync would take people off the board', () => {
  // `clear_unmatched` is the setting that empties a board when a plan is
  // half-built. On the venue board that would have cleared nine slots.
  const on = watchLines({ ...armed, clear_unmatched: true });
  const row = on.find((l) => /taken off the board/.test(l.text));

  assert.ok(row, 'clearing must be stated, not left to the settings above');
  assert.equal(row.level, 'warn');

  assert.match(texts({ ...armed, clear_unmatched: false }), /Nobody is taken off/);
});

test('⚠️ a finished service says it has stopped, and does not also warn of a change', () => {
  const out = watchLines({ ...armed, finished: true, changed: true });
  const stopped = out.find((l) => /service is over/.test(l.text));

  assert.ok(stopped);
  assert.equal(stopped.level, 'off');
  assert.match(stopped.text, /60 minutes after/);
  assert.ok(
    !out.some((l) => /plan has changed/.test(l.text)),
    'a stopped watcher reporting a pending change would read as something about to happen',
  );
});

test('a pending change is reported while the service is still on', () => {
  assert.match(texts({ ...armed, changed: true }), /plan has changed since the last sync/);
});

test('⚠️ a failed check is surfaced rather than read as healthy', () => {
  assert.match(texts({ ...armed, error: 'Planning Center said 429' }), /Last check failed: .*429/);
});

test('an unconfigured board says that, not "not watching"', () => {
  const lines = watchLines({ ok: false, error: 'No Planning Center credentials' });
  assert.equal(lines.length, 1);
  assert.match(lines[0].text, /No Planning Center credentials/);
});

test('⚠️ "last looked" is in words, and absent when it has never looked', () => {
  const now = 1_000_000;
  assert.equal(sinceWords(now - 30, now), '30 seconds ago');
  assert.equal(sinceWords(now - 600, now), '10 minutes ago');
  assert.equal(sinceWords(now - 7200, now), '2 hours ago');
  // ⛔ No timestamp means it has not run; inventing "0 seconds ago" would read
  // as a healthy check that just happened.
  assert.equal(sinceWords(null, now), '');
  assert.ok(!texts(armed, now).includes('Last looked'));
});
