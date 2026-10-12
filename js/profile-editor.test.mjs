import test from 'node:test';
import assert from 'node:assert/strict';

import {
  slugify,
  uniqueId,
  bindingKind,
  overriddenKeys,
  describeBinding,
  folderPath,
  bindingIsDangling,
  validateProfile,
  cleanProfile,
  toPayload,
} from './profile-editor.mjs';

const SERVICE_TYPES = [{ id: '12', name: 'Sunday AM' }, { id: '34', name: 'Youth' }];
const FOLDERS = [
  { id: '100', name: 'Weekend', parent_id: null },
  { id: '200', name: 'Youth', parent_id: '100' },
  { id: '300', name: 'Youth', parent_id: null },
];

const withRules = (extra = {}) => ({
  id: 'p',
  name: 'P',
  mapping: { clear_unmatched: true },
  ...extra,
});

test('a name becomes a safe id', () => {
  assert.equal(slugify('Sunday Morning'), 'sunday-morning');
  assert.equal(slugify('  Youth / Wednesday!  '), 'youth-wednesday');
  assert.equal(slugify('Christmas Eve 2026'), 'christmas-eve-2026');
});

test('a name with nothing usable in it still yields an id', () => {
  assert.equal(uniqueId('???', []), 'profile');
});

test('⚠️ ids stay distinct when two profiles share a name', () => {
  // The id is what a sync names when it refuses an unknown profile, so a
  // collision would make one of them unreachable by hand.
  assert.equal(uniqueId('Youth', [{ id: 'youth' }]), 'youth-2');
  assert.equal(uniqueId('Youth', [{ id: 'youth' }, { id: 'youth-2' }]), 'youth-3');
});

test('the binding kind is read from whichever id is set', () => {
  assert.equal(bindingKind({ service_type_id: '12' }), 'service_type');
  assert.equal(bindingKind({ folder_id: '100' }), 'folder');
  assert.equal(bindingKind({}), 'manual');
  assert.equal(bindingKind(null), 'manual');
});

test('a blank binding id is not a binding', () => {
  assert.equal(bindingKind({ service_type_id: '   ' }), 'manual');
});

test('only keys actually set count as overrides', () => {
  assert.deepEqual(overriddenKeys({ mapping: { clear_unmatched: false } }), ['clear_unmatched']);
  assert.deepEqual(overriddenKeys({ mapping: { note_category: null } }), []);
  assert.deepEqual(overriddenKeys({ mapping: {} }), []);
  assert.deepEqual(overriddenKeys({}), []);
});

test('false is a real override, not an absent one', () => {
  // ⛔ `clear_unmatched: false` is a profile saying "do not clear here" even
  // though the board does. Treating falsy as unset would lose exactly the
  // override that stops a sync taking people off the board.
  assert.deepEqual(overriddenKeys({ mapping: { clear_unmatched: false } }), ['clear_unmatched']);
});

test('a binding is described by what it points at, not that it exists', () => {
  assert.equal(
    describeBinding({ service_type_id: '12' }, { serviceTypes: SERVICE_TYPES }),
    'Service type: Sunday AM',
  );
  assert.equal(describeBinding({}, {}), 'Chosen by hand');
});

test('⛔ a binding pointing at something gone says so', () => {
  // The main way a profile goes quietly dead: the folder is renamed or deleted
  // in Planning Center and the board keeps reporting a configured profile that
  // can never match.
  assert.match(
    describeBinding({ folder_id: '999' }, { folders: FOLDERS }),
    /not found in Planning Center/,
  );
  assert.equal(bindingIsDangling({ folder_id: '999' }, { folders: FOLDERS }), true);
  assert.equal(bindingIsDangling({ folder_id: '100' }, { folders: FOLDERS }), false);
  assert.equal(bindingIsDangling({}, {}), false);
});

test('⚠️ nested folders are shown by path, so two "Youth" differ', () => {
  assert.equal(folderPath(FOLDERS[1], FOLDERS), 'Weekend / Youth');
  assert.equal(folderPath(FOLDERS[2], FOLDERS), 'Youth');
});

test('a cycle in the folder data does not hang the path', () => {
  const loop = [{ id: 'a', name: 'A', parent_id: 'b' }, { id: 'b', name: 'B', parent_id: 'a' }];

  assert.equal(folderPath(loop[0], loop), 'B / A');
});

test('a profile needs a name', () => {
  assert.match(validateProfile({ mapping: { clear_unmatched: true } }), /name/);
});

test('two profiles cannot share a name or an id', () => {
  const existing = [{ id: 'youth', name: 'Youth', mapping: {} }];

  assert.match(validateProfile(withRules({ id: 'youth', name: 'Other' }), existing), /id/);
  assert.match(validateProfile(withRules({ id: 'x', name: 'youth' }), existing), /called that/);
});

test('a profile cannot be bound two ways at once', () => {
  const p = withRules({ service_type_id: '12', folder_id: '100' });

  assert.match(validateProfile(p), /not both/);
});

test('⛔ two profiles on one binding is caught here, because a sync will not', () => {
  // At sync time the first simply wins. Without saying so in the editor an
  // operator can believe "Youth" is in force while "Sunday AM" actually is.
  const existing = [{
    id: 'sunday', name: 'Sunday AM', service_type_id: '12', mapping: {},
  }];
  const message = validateProfile(withRules({ service_type_id: '12' }), existing);

  assert.match(message, /Sunday AM/);
  assert.match(message, /first one would win/);
});

test('two hand-picked profiles never clash', () => {
  const existing = [{ id: 'a', name: 'A', mapping: {} }];

  assert.equal(validateProfile(withRules({ id: 'b', name: 'B' }), existing), null);
});

test('a profile that overrides nothing is called out', () => {
  // It would sync happily and behave exactly like the board settings, which is
  // indistinguishable from the profile not working.
  assert.match(validateProfile({ id: 'p', name: 'P', mapping: {} }), /changes nothing/);
});

test('a valid profile passes', () => {
  assert.equal(validateProfile(withRules({ folder_id: '100' })), null);
});

test('cleaning keeps only the binding that is set', () => {
  const cleaned = cleanProfile(withRules({ folder_id: '100', service_type_id: '' }));

  assert.equal(cleaned.folder_id, '100');
  assert.equal('service_type_id' in cleaned, false);
});

test('⚠️ cleaning stores only the keys actually overridden', () => {
  // Writing every key with the board's current value would freeze the profile
  // against a later change to the board settings — the opposite of inheriting.
  const cleaned = cleanProfile({
    id: 'p', name: 'P', mapping: { clear_unmatched: true, note_category: null },
  });

  assert.deepEqual(cleaned.mapping, { clear_unmatched: true });
});

test('unknown keys do not survive cleaning', () => {
  const cleaned = cleanProfile({ id: 'p', name: 'P', mapping: { nonsense: 1, strategy: 'position' } });

  assert.deepEqual(cleaned.mapping, { strategy: 'position' });
});

test('the payload drops entries with no id or name', () => {
  const payload = toPayload([
    { id: 'a', name: 'A', mapping: { strategy: 'position' } },
    { id: '', name: 'No id', mapping: {} },
    { id: 'c', name: '  ', mapping: {} },
    null,
  ]);

  assert.deepEqual(payload.map((p) => p.id), ['a']);
});

test('a missing profiles list is an empty payload, not a crash', () => {
  assert.deepEqual(toPayload(undefined), []);
  assert.deepEqual(toPayload(null), []);
});
