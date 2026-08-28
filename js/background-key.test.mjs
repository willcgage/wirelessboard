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
  backgroundExtensions,
  findBackgroundFile,
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

test('a capitalised or PascalCase file on disk is found', () => {
  // The bug: the key is lowercased, the directory listing is not, and comparing
  // them directly meant only an all-lowercase filename ever matched.
  assert.equal(findBackgroundFile('Jane Smith', 'IMG', ['Jane Smith.jpg']), 'Jane Smith.jpg');
  assert.equal(
    findBackgroundFile('Jane Smith', 'IMG', ['JaneSmith.JPG', 'Jane Smith.JPG']),
    'Jane Smith.JPG',
  );
  assert.equal(findBackgroundFile('jane smith', 'MP4', ['Jane Smith.Mp4']), 'Jane Smith.Mp4');
});

test('the directory spelling is returned, not the lowercased key', () => {
  // /bg/<name> is served off disk, so asking for the lowercased form 404s on a
  // case-sensitive filesystem even though the file is right there.
  const found = findBackgroundFile('Jane Smith', 'IMG', ['Jane Smith.JPG']);

  assert.notEqual(found, 'jane smith.jpg');
  assert.equal(found, 'Jane Smith.JPG');
});

test('an exact match beats a differently-cased one', () => {
  // Two files that differ only in case must resolve the same way every render
  // rather than by whatever order the directory happened to list them in.
  assert.equal(
    findBackgroundFile('Jane Smith', 'IMG', ['Jane Smith.jpg', 'jane smith.jpg']),
    'jane smith.jpg',
  );
});

test('a missing file is still missing', () => {
  assert.equal(findBackgroundFile('Jane Smith', 'IMG', ['sam reed.jpg']), '');
  assert.equal(findBackgroundFile('Jane Smith', 'IMG', []), '');
  assert.equal(findBackgroundFile('Jane Smith', 'IMG', null), '');
  assert.equal(findBackgroundFile('', 'IMG', ['jane smith.jpg']), '');
  // A mode that shows no media never matches, whatever is on disk.
  assert.equal(findBackgroundFile('Jane Smith', 'NONE', ['jane smith.jpg']), '');
});

test('the image list cannot satisfy a video slot', () => {
  assert.equal(findBackgroundFile('Jane Smith', 'MP4', ['Jane Smith.JPG']), '');
});

test('mov is accepted as video, at any capitalisation', () => {
  // What a phone or a camera records, handed over without remuxing.
  assert.equal(findBackgroundFile('Jane Smith', 'MP4', ['jane smith.mov']), 'jane smith.mov');
  assert.equal(findBackgroundFile('Jane Smith', 'MP4', ['Jane Smith.MOV']), 'Jane Smith.MOV');
});

test('mp4 still wins over mov', () => {
  // Same rule as the photo formats: what plays most reliably is preferred, and
  // a board already showing an .mp4 cannot be displaced by adding a .mov.
  assert.equal(
    findBackgroundFile('Jane Smith', 'MP4', ['Jane Smith.MOV', 'jane smith.mp4']),
    'jane smith.mp4',
  );
  assert.deepEqual(backgroundExtensions('MP4'), ['.mp4', '.mov']);
});

test('a video slot suggests .mp4 for a file that does not exist yet', () => {
  assert.equal(backgroundFilenameForMode('Jane Smith', 'MP4'), 'jane smith.mp4');
});

test('the video list cannot satisfy an image slot', () => {
  assert.equal(findBackgroundFile('Jane Smith', 'IMG', ['Jane Smith.MOV']), '');
});

test('jpeg, png and webp are all accepted', () => {
  assert.equal(findBackgroundFile('Jane Smith', 'IMG', ['jane smith.jpeg']), 'jane smith.jpeg');
  assert.equal(findBackgroundFile('Jane Smith', 'IMG', ['jane smith.png']), 'jane smith.png');
  assert.equal(findBackgroundFile('Jane Smith', 'IMG', ['jane smith.webp']), 'jane smith.webp');
});

test('the extra formats are matched case-insensitively too', () => {
  assert.equal(findBackgroundFile('Jane Smith', 'IMG', ['Jane Smith.PNG']), 'Jane Smith.PNG');
  assert.equal(findBackgroundFile('Jane Smith', 'IMG', ['Jane Smith.WebP']), 'Jane Smith.WebP');
});

test('a format still not accepted stays unmatched', () => {
  // .gif is listed by the server but is not an accepted background, and .bmp is
  // not listed at all. Neither should be picked up by accident.
  assert.equal(findBackgroundFile('Jane Smith', 'IMG', ['jane smith.gif']), '');
  assert.equal(findBackgroundFile('Jane Smith', 'IMG', ['jane smith.bmp']), '');
});

test('format order decides, and it beats capitalisation', () => {
  // The point of fixing the order: adding formats must not change which file an
  // existing board picks. A jpg present anywhere in the folder still wins, even
  // where the png is the one spelled exactly as suggested.
  const folder = ['jane smith.png', 'Jane Smith.JPG'];

  assert.equal(findBackgroundFile('Jane Smith', 'IMG', folder), 'Jane Smith.JPG');
  assert.equal(
    findBackgroundFile('Jane Smith', 'IMG', ['jane smith.webp', 'jane smith.jpeg']),
    'jane smith.jpeg',
  );
});

test('the suggested filename is the first accepted format', () => {
  // What the guide prints for a slot with no file yet. It must stay .jpg: it is
  // the one every camera and phone produces without being asked.
  assert.equal(backgroundFilenameForMode('Jane Smith', 'IMG'), 'jane smith.jpg');
  assert.deepEqual(backgroundExtensions('IMG'), ['.jpg', '.jpeg', '.png', '.webp']);
  assert.equal(backgroundExtensions('IMG')[0], backgroundFilenameForMode('x', 'IMG').slice(1));
});

test('the extension list cannot be mutated by a caller', () => {
  const extensions = backgroundExtensions('IMG');
  extensions.push('.bmp');

  assert.equal(findBackgroundFile('Jane Smith', 'IMG', ['jane smith.bmp']), '');
  assert.deepEqual(backgroundExtensions('NONE'), []);
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
