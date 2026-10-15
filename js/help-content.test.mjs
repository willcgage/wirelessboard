import test from 'node:test';
import assert from 'node:assert/strict';

import { HELP_SECTIONS, helpLines } from './help-content.mjs';

// ---------------------------------------------------------------------------
// ⛔⛔ Help is the one screen somebody reads when they do not know how the board
// works, so stale Help is worse than none. It has gone stale three times, each
// time the same way: it described a control the board no longer has.
//
// These are the three, as guards. They are blunt on purpose — a substring check
// that fails loudly beats prose nobody re-reads.
// ---------------------------------------------------------------------------

test('⛔⛔ Help does not send anybody to a Menu that no longer exists', () => {
  // Three of the four Quick Start items said "Menu -> Config", "Menu ->
  // Planning Center" and "Menu -> Help". #188 retired the menu bar, so the
  // first thing a lost operator read was three routes that do not exist.
  helpLines().concat(HELP_SECTIONS.map((s) => s.title)).forEach((line) => {
    assert.ok(!/\bMenu\b/.test(line), `Help still mentions a Menu: "${line}"`);
  });
});

test('⛔⛔ and does not tell anybody to keep Config open during a service', () => {
  // The old line: "Keep another tab on the Config view during events so
  // adjustments never interrupt the board." A configuration save tears down
  // every receiver socket, sleeps ~2s and rebuilds, so that is exactly what
  // blanks the wall mid-service.
  const text = helpLines().join(' ').toLowerCase();
  assert.ok(!/another tab/.test(text), 'Help suggests a second tab');
  assert.ok(
    !/(during|mid)[- ](events?|service)[^.]*config/.test(text),
    'Help suggests using Config during a service',
  );
  // ⭐ And says the true thing instead, because silence would leave the old
  // advice as the only thing anybody remembers.
  assert.match(text, /disconnects the receivers/, 'Help must say what a save costs');
});

test('⛔ and does not teach a keyboard the board does not have', () => {
  // #160 retired every binding but Escape. A Help page listing keys is how the
  // shortcut list outlived the shortcuts the first time.
  const text = helpLines().join(' ');
  assert.ok(!/\bpress [A-Z]\b/.test(text), 'Help names a key to press');
  assert.ok(!/shortcut/i.test(text), 'Help mentions shortcuts');
  // Escape is the one exception and may be named.
  assert.match(text, /Escape/, 'Escape is the one key there is, and Help should say so');
});

test('⭐ Help states the per-device / every-board boundary', () => {
  // #116 exists because that split was invisible. Help is one of the places it
  // has to be said, not assumed.
  const text = helpLines().join(' ');
  assert.match(text, /this screen only/i);
  assert.match(text, /every connected board|every board/i);
});

test('⭐ and explains the two things a confused operator actually sees', () => {
  const text = helpLines().join(' ');
  // A card with no receiver behind it, which reads as a bug and is not (#186).
  assert.match(text, /Slot 4 instead of HH-4|no receiver behind it/);
  // Fewer channels than expected, which is paging (#215).
  assert.match(text, /fewer channels than you expect/);
});

test('every section has a title and at least one line', () => {
  assert.ok(HELP_SECTIONS.length >= 3);
  HELP_SECTIONS.forEach((s) => {
    assert.ok(s.title && typeof s.title === 'string');
    assert.ok(Array.isArray(s.items) && s.items.length >= 1, `${s.title} has no lines`);
    s.items.forEach((line) => assert.ok(line.length > 20, `a one-word line in ${s.title}`));
  });
});

test('⚠️ and no line is a wall of text', () => {
  // It is read standing up, in a hurry, by somebody who does not know the
  // board. A 400-character sentence is not read at all.
  helpLines().forEach((line) => {
    assert.ok(line.length <= 300, `a ${line.length}-character line: "${line.slice(0, 60)}..."`);
  });
});
