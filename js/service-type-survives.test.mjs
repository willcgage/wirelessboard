import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * ⛔⛔ The service type must survive the panel being opened.
 *
 * `openPCOView` sets `sel.value = service_type_id` before the service list has
 * been fetched — and assigning a value a `<select>` has no option for leaves
 * it as `''`. `loadPcoServiceTypes` then read that empty value back as "what
 * to restore", restored nothing, and the control sat on **All service types**
 * while the configuration said otherwise.
 *
 * ⛔ Not a display bug. `Save matching` reads the control, and an empty value
 * means *delete the service type* — so opening the section and saving anything
 * at all silently wiped it.
 *
 * Measured on the venue board before the fix:
 *
 *     storedInConfig : "1788894"
 *     selectValue    : ""
 *     selectShows    : "All service types"
 *
 * ⚠️ And the stored value was the wrong service type anyway — `1788894` is
 * "Sunday Morning Connections", while Sunday Morning Worship is `162905`.
 * That is what put student teams on the chips and picked plan `91252642`
 * instead of the Sunday one.
 */

const ROOT = path.join(import.meta.dirname, '..');
const CONFIG = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8');

/** The body of one top-level function in config.js. */
function fn(name) {
  const marker = `\nfunction ${name}(`;
  const at = CONFIG.indexOf(marker);
  assert.notEqual(at, -1, `config.js defines ${name}`);
  const next = CONFIG.indexOf('\nfunction ', at + marker.length);
  return CONFIG.slice(at, next === -1 ? CONFIG.length : next);
}

test('⛔ the stored service type is what gets restored, not an empty control', () => {
  const body = fn('loadPcoServiceTypes');

  assert.ok(
    !/const saved = sel\.value \|\| '';/.test(body),
    'reading only the control is what lost the setting',
  );
  assert.match(
    body,
    /micboard\.config\.pco\.services/,
    'the stored value is consulted',
  );
  assert.match(
    body,
    /sel\.value \|\| String\(stored\.service_type_id/,
    'the control wins when it has one — an unsaved pick must not be thrown away',
  );
});

test('⚠️ the value is applied AFTER the options exist', () => {
  // The whole mechanism: assigning a value a select has no option for does
  // nothing at all, silently.
  const body = fn('loadPcoServiceTypes');
  const populate = body.indexOf("sel.innerHTML = '<option value=\"\">All service types</option>'");
  const apply = body.indexOf('if (saved) sel.value = saved;');

  assert.ok(populate > -1 && apply > -1, 'found both steps');
  assert.ok(apply > populate, 'the options are built before the value is set');
});

test('⛔ an empty control still means "all service types", deliberately', () => {
  // The save must keep being able to CLEAR it — picking "All service types"
  // is a real choice. Which is exactly why the control had to be made
  // truthful rather than the save made defensive.
  assert.match(
    CONFIG,
    /delete services\.service_type_id/,
    'clearing is still possible on purpose',
  );
});

test('the select is a plain select, so an unknown value cannot stick', () => {
  // A guard on the assumption the fix rests on: if this ever became a control
  // that accepts arbitrary text, the ordering would stop mattering and this
  // reasoning would be stale rather than wrong.
  const markup = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8');
  const at = markup.indexOf('id="pco-service-type-id"');
  assert.notEqual(at, -1, 'the control is in the markup');
  const tagStart = markup.lastIndexOf('<', at);
  assert.match(markup.slice(tagStart, at), /^<select/, 'it is a <select>');
});
