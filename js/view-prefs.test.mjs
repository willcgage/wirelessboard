import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readPref, writePref, resolvePref, ARRANGEMENT_KEY, CARD_SHAPE_KEY,
} from './view-prefs.mjs';

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
