import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readPref, writePref, resolvePref, ORIENTATION_KEY, ASPECT_KEY,
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
  const storage = fakeStorage({ [ORIENTATION_KEY]: 'portrait' });
  assert.equal(readPref({
    storage, key: ORIENTATION_KEY, isValid, fallback: 'auto',
  }), 'portrait');
});

test('an unrecognised stored value falls back instead of being trusted', () => {
  // It ends up in a class name and a grid calculation.
  const storage = fakeStorage({ [ASPECT_KEY]: 'sideways' });
  assert.equal(readPref({
    storage, key: ASPECT_KEY, isValid, fallback: 'auto',
  }), 'auto');
});

test('storage that throws means "nothing remembered", not a crash', () => {
  assert.equal(readPref({
    storage: throwingStorage, key: ORIENTATION_KEY, isValid, fallback: 'auto',
  }), 'auto');
  assert.equal(writePref({ storage: throwingStorage, key: ORIENTATION_KEY, value: 'portrait' }), false);
});

test('missing storage is handled the same way', () => {
  assert.equal(readPref({
    storage: null, key: ORIENTATION_KEY, isValid, fallback: 'landscape',
  }), 'landscape');
  assert.equal(writePref({ storage: null, key: ORIENTATION_KEY, value: 'portrait' }), false);
});

test('writing then reading round-trips', () => {
  const storage = fakeStorage();
  assert.equal(writePref({ storage, key: ASPECT_KEY, value: 'landscape' }), true);
  assert.equal(readPref({
    storage, key: ASPECT_KEY, isValid, fallback: 'auto',
  }), 'landscape');
});

test('the hash wins over what is stored', () => {
  // A link someone was handed should show what it promises.
  const storage = fakeStorage({ [ORIENTATION_KEY]: 'portrait' });
  assert.equal(resolvePref({
    hashValue: 'landscape', storage, key: ORIENTATION_KEY, isValid, fallback: 'auto',
  }), 'landscape');
});

test('storage is used when the hash says nothing', () => {
  const storage = fakeStorage({ [ORIENTATION_KEY]: 'portrait' });
  assert.equal(resolvePref({
    hashValue: undefined, storage, key: ORIENTATION_KEY, isValid, fallback: 'auto',
  }), 'portrait');
});

test('a junk hash value is ignored rather than trusted', () => {
  const storage = fakeStorage({ [ORIENTATION_KEY]: 'portrait' });
  assert.equal(resolvePref({
    hashValue: 'sideways', storage, key: ORIENTATION_KEY, isValid, fallback: 'auto',
  }), 'portrait');
});

test('the default is the last resort', () => {
  assert.equal(resolvePref({
    hashValue: undefined, storage: fakeStorage(), key: ASPECT_KEY, isValid, fallback: 'auto',
  }), 'auto');
});
