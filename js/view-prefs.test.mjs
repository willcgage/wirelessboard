import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readPref, writePref, resolvePref, ARRANGEMENT_KEY, CARD_SHAPE_KEY,
  DISPLAY_MODE_KEY, DISPLAY_MODES, isDisplayMode,
} from './view-prefs.mjs';
import { DRAWER_MODES } from './panel-controls.mjs';

const isValid = (v) => ['auto', 'landscape', 'portrait'].includes(v);

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    dump: () => data,
  };
}

const throwingStorage = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('quota'); },
};

test('a remembered value is read back', () => {
  const storage = fakeStorage({ [ARRANGEMENT_KEY]: 'portrait' });
  assert.equal(readPref({
    storage, key: ARRANGEMENT_KEY, isValid, fallback: 'auto',
  }), 'portrait');
});

test('an unrecognised stored value falls back instead of being trusted', () => {
  // It ends up in a class name and a grid calculation.
  const storage = fakeStorage({ [CARD_SHAPE_KEY]: 'sideways' });
  assert.equal(readPref({
    storage, key: CARD_SHAPE_KEY, isValid, fallback: 'auto',
  }), 'auto');
});

test('storage that throws means "nothing remembered", not a crash', () => {
  assert.equal(readPref({
    storage: throwingStorage, key: ARRANGEMENT_KEY, isValid, fallback: 'auto',
  }), 'auto');
  assert.equal(writePref({ storage: throwingStorage, key: ARRANGEMENT_KEY, value: 'portrait' }), false);
});

test('missing storage is handled the same way', () => {
  assert.equal(readPref({
    storage: null, key: ARRANGEMENT_KEY, isValid, fallback: 'landscape',
  }), 'landscape');
  assert.equal(writePref({ storage: null, key: ARRANGEMENT_KEY, value: 'portrait' }), false);
});

test('writing then reading round-trips', () => {
  const storage = fakeStorage();
  assert.equal(writePref({ storage, key: CARD_SHAPE_KEY, value: 'landscape' }), true);
  assert.equal(readPref({
    storage, key: CARD_SHAPE_KEY, isValid, fallback: 'auto',
  }), 'landscape');
});

test('the hash wins over what is stored', () => {
  // A link someone was handed should show what it promises.
  const storage = fakeStorage({ [ARRANGEMENT_KEY]: 'portrait' });
  assert.equal(resolvePref({
    hashValue: 'landscape', storage, key: ARRANGEMENT_KEY, isValid, fallback: 'auto',
  }), 'landscape');
});

test('storage is used when the hash says nothing', () => {
  const storage = fakeStorage({ [ARRANGEMENT_KEY]: 'portrait' });
  assert.equal(resolvePref({
    hashValue: undefined, storage, key: ARRANGEMENT_KEY, isValid, fallback: 'auto',
  }), 'portrait');
});

test('a junk hash value is ignored rather than trusted', () => {
  const storage = fakeStorage({ [ARRANGEMENT_KEY]: 'portrait' });
  assert.equal(resolvePref({
    hashValue: 'sideways', storage, key: ARRANGEMENT_KEY, isValid, fallback: 'auto',
  }), 'portrait');
});

test('the default is the last resort', () => {
  assert.equal(resolvePref({
    hashValue: undefined, storage: fakeStorage(), key: CARD_SHAPE_KEY, isValid, fallback: 'auto',
  }), 'auto');
});

// -- migration -------------------------------------------------------------
// The value vocabulary changed after 1.11.0 shipped (#75). The stored keys
// deliberately did not, so what is already on a board is still found -- and
// then translated rather than thrown away.

const isNewValue = (v) => ['fit', 'row', 'column', 'grid'].includes(v);
const migrate = (v) => ({ auto: 'fit', landscape: 'grid', portrait: 'column' }[v] || null);

test('a preference stored by 1.11.0 is translated, not reset', () => {
  const storage = fakeStorage({ [ARRANGEMENT_KEY]: 'landscape' });
  assert.equal(resolvePref({
    hashValue: undefined, storage, key: ARRANGEMENT_KEY, isValid: isNewValue, migrate, fallback: 'fit',
  }), 'grid');
});

test('an old value in a shared link is translated too', () => {
  // Someone was handed a link before the rename; it should still show what it
  // promised rather than silently falling back.
  assert.equal(resolvePref({
    hashValue: 'portrait', storage: fakeStorage(), key: ARRANGEMENT_KEY, isValid: isNewValue, migrate, fallback: 'fit',
  }), 'column');
});

test('migration does not rescue nonsense', () => {
  const storage = fakeStorage({ [ARRANGEMENT_KEY]: 'sideways' });
  assert.equal(resolvePref({
    hashValue: 'diagonal', storage, key: ARRANGEMENT_KEY, isValid: isNewValue, migrate, fallback: 'fit',
  }), 'fit');
});

test('a current value is preferred over migrating it', () => {
  const storage = fakeStorage({ [ARRANGEMENT_KEY]: 'row' });
  assert.equal(resolvePref({
    hashValue: undefined, storage, key: ARRANGEMENT_KEY, isValid: isNewValue, migrate, fallback: 'fit',
  }), 'row');
});

test('without a migrate function the old behaviour is unchanged', () => {
  const storage = fakeStorage({ [ARRANGEMENT_KEY]: 'landscape' });
  assert.equal(resolvePref({
    hashValue: undefined, storage, key: ARRANGEMENT_KEY, isValid: isNewValue, fallback: 'fit',
  }), 'fit');
});

// --------------------------------------------------------------------------
// Desk or TV is remembered (#216)
//
// ⛔ It was the only view preference that was not, so TV mode lived in the URL
// hash alone -- and the hash is lost when the slot-name editor opens, while
// Escape is a full page reload. A wall came back from a power cut, from Escape,
// or from editing a slot name showing the desk layout.
//
// ⚠️ These test the resolution rules only. `setDisplayMode` writing the value
// and `applyViewClasses` putting it on the container are DOM-coupled and are
// verified by measurement; see the PR for #216.
// --------------------------------------------------------------------------

// How app.js turns the hash into an opinion: the hash carries the display mode
// as `tvmode=<elinfo>`, so the *presence* of a valid drawer value means TV.
const hashOpinion = (urlTvmode) => (DRAWER_MODES.includes(urlTvmode) ? 'tvmode' : undefined);

const resolveMode = (urlTvmode, storage) => resolvePref({
  hashValue: hashOpinion(urlTvmode),
  storage,
  key: DISPLAY_MODE_KEY,
  isValid: isDisplayMode,
  fallback: 'deskmode',
});

test('⛔ a wall that remembers TV mode comes back as a wall', () => {
  // The whole point. No hash -- a power cut, or Escape's reload after the hash
  // was lost -- and the board still knows what it is.
  const storage = fakeStorage({ [DISPLAY_MODE_KEY]: 'tvmode' });
  assert.equal(resolveMode(undefined, storage), 'tvmode');
});

test('a board that has never been told is a desk', () => {
  assert.equal(resolveMode(undefined, fakeStorage()), 'deskmode');
});

test('⭐ the hash still wins, so a link can show somebody the wall view', () => {
  const storage = fakeStorage({ [DISPLAY_MODE_KEY]: 'deskmode' });
  DRAWER_MODES.forEach((drawer) => {
    assert.equal(resolveMode(drawer, storage), 'tvmode', `${drawer} means TV mode`);
  });
});

test('⚠️ an absent parameter is "no opinion", not "desk mode"', () => {
  // Every preference in this file follows the same rule, and it is the rule
  // that makes a remembered wall survive a hash-less load.
  const storage = fakeStorage({ [DISPLAY_MODE_KEY]: 'tvmode' });
  assert.equal(resolveMode(undefined, storage), 'tvmode');
  assert.equal(resolveMode('', storage), 'tvmode');
});

test('junk in the hash is ignored rather than trusted', () => {
  // `#tvmode=true` is the obvious thing to type and is not a drawer mode. It
  // must not switch anything, and must not throw away what is remembered.
  const storage = fakeStorage({ [DISPLAY_MODE_KEY]: 'tvmode' });
  ['true', 'tvmode', 'elinfo99', 'yes', '1'].forEach((junk) => {
    assert.equal(resolveMode(junk, storage), 'tvmode');
  });
  assert.equal(resolveMode('true', fakeStorage()), 'deskmode');
});

test('a stored value outside the list is ignored', () => {
  const storage = fakeStorage({ [DISPLAY_MODE_KEY]: 'wallmode' });
  assert.equal(resolveMode(undefined, storage), 'deskmode');
});

test('the mode is written under its own key', () => {
  const storage = fakeStorage();
  writePref({ storage, key: DISPLAY_MODE_KEY, value: 'tvmode' });
  assert.deepEqual(storage.dump(), { 'wirelessboard.displayMode': 'tvmode' });
});

test('a board with storage denied still resolves a mode', () => {
  // A wall in a kiosk with site data blocked must still paint something.
  assert.equal(resolveMode(undefined, throwingStorage), 'deskmode');
  assert.equal(resolveMode('elinfo11', throwingStorage), 'tvmode');
});

test('the two modes are exactly the two class names the container uses', () => {
  // `applyViewClasses` removes every one of these and adds `micboard.displayMode`,
  // so a third entry here without a stylesheet rule would paint nothing.
  assert.deepEqual(DISPLAY_MODES, ['deskmode', 'tvmode']);
  DISPLAY_MODES.forEach((m) => assert.ok(isDisplayMode(m)));
  assert.ok(!isDisplayMode('TVMODE'));
});
