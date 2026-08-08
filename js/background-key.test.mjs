/**
 * The guide and the renderer must name the same file.
 *
 * They did not. The guide table derived the filename from the transmitter's own
 * channel label and told operators to call the file `mic1 bob device.jpg`; the
 * renderer went looking for the displayed name, which is the person. Media only
 * appeared where a device happened to be named after whoever was holding it.
 *
 * The rule is the person: a photo belongs to whoever has the microphone, not to
 * the microphone, which keeps its label when it is handed on.
 */

import test from 'node:test';
import assert from 'node:assert';

import {
  backgroundNameForSlot,
  backgroundKey,
  backgroundFilenames,
  backgroundFilenameForMode,
} from './background-key.mjs';

test('the person wins over the device label', () => {
  // The bug, stated directly: name_raw is present and must not be chosen.
  const tx = { name: 'Jane Smith', name_raw: 'MIC1 Bob Device' };

  assert.equal(backgroundNameForSlot(tx, {}), 'Jane Smith');
});

test('name_raw is never used, even as a last resort', () => {
  const tx = { name_raw: 'MIC1 Bob Device' };

  assert.equal(backgroundNameForSlot(tx, {}), '');
});

test('a slot config holding the assignment is used before a transmitter reports', () => {
  // There is no resolved name until the receiver answers; falling back to the
  // device here would put the wrong photo up for the first few seconds.
  assert.equal(
    backgroundNameForSlot(null, { extended_name: 'Sam Reed', chan_name_raw: 'MIC2 Old Label' }),
    'Sam Reed',
  );
});

test('a live transmitter beats the stored assignment', () => {
  const tx = { name: 'Jane Smith' };

  assert.equal(backgroundNameForSlot(tx, { extended_name: 'Stale Person' }), 'Jane Smith');
});

test('an unassigned slot has no name to key on', () => {
  assert.equal(backgroundNameForSlot(null, null), '');
  assert.equal(backgroundNameForSlot({}, {}), '');
});

test('keys are lowercased and trimmed', () => {
  assert.equal(backgroundKey('  Jane Smith  '), 'jane smith');
  assert.equal(backgroundKey('JANE SMITH'), 'jane smith');
  assert.equal(backgroundKey(''), '');
  assert.equal(backgroundKey(null), '');
});

test('both filenames come from one key', () => {
  assert.deepEqual(backgroundFilenames('Jane Smith'), {
    image: 'jane smith.jpg',
    video: 'jane smith.mp4',
  });
});

test('no name means no filename, not a stray extension', () => {
  assert.deepEqual(backgroundFilenames(''), { image: '', video: '' });
  assert.equal(backgroundFilenameForMode('', 'IMG'), '');
});

test('a mode showing no media yields no filename', () => {
  assert.equal(backgroundFilenameForMode('Jane Smith', 'NONE'), '');
  assert.equal(backgroundFilenameForMode('Jane Smith', undefined), '');
});

test('each mode picks its own extension', () => {
  assert.equal(backgroundFilenameForMode('Jane Smith', 'IMG'), 'jane smith.jpg');
  assert.equal(backgroundFilenameForMode('Jane Smith', 'MP4'), 'jane smith.mp4');
});

test('the guide and the renderer agree, which is the whole point', () => {
  // What the guide prints in the image column must be exactly what the
  // renderer asks the server for. These were computed independently before.
  const tx = { name: 'Jane Smith', name_raw: 'MIC1 Bob Device' };
  const name = backgroundNameForSlot(tx, {});

  const guideSays = backgroundFilenames(name).image;
  const rendererAsksFor = backgroundFilenameForMode(name, 'IMG');

  assert.equal(guideSays, rendererAsksFor);
  assert.equal(guideSays, 'jane smith.jpg');
});
