/**
 * ⛔⛔ The word "pad" is not a live concept, and this test is why.
 *
 * Everything underneath a screen is a **dock** (settled 2026-10-15). The
 * charging-dock / pickup-pad split that #203 shipped is gone: it named the
 * *absence* of a feature as a different kind of object.
 *
 * ⭐ **Why a test rather than a note.** The maintainer asked for the phrase to
 * be removed from the whole system because leaving it "will cause issues" --
 * and they are describing something that has already happened twice on this
 * project in a week. A session greps, finds a confident sentence about pickup
 * pads, believes it is current, and builds from it. Prose cannot defend itself;
 * a failing test can.
 *
 * ⚠️ **What is deliberately allowed**, and the reason the check is a phrase
 * rather than the word: the literal strings `dock` and `pad` are the OLD STORED
 * VALUES, and they live in real `config.json` files. `LEGACY_DOCK_KINDS` reads
 * them and its tests assert the mapping. Deleting those would not tidy the
 * vocabulary; it would silently change what every beta.5 board's dock means.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/**
 * Phrases that only make sense if a pad is a current kind of object.
 *
 * ⚠️ Each is a PHRASE, not the bare word. "pad" alone matches `padding`,
 * `pad()`, `stage-pad` in old fixtures and the legacy value itself, so a
 * word-level ban would either fail on correct code or force the migration to
 * be written obscurely.
 */
const DEAD_PHRASES = [
  'pickup pad',
  'pickup-pad',
  'Pickup pad',
  'dock or pad',
  'dock or a pad',
  'docks and pads',
  'dock or pickup',
];

/**
 * Where the vocabulary has to be current.
 *
 * ⛔ `CHANGELOG.md` is NOT here. A changelog records what each release did, and
 * 2.0.0-beta.5 really did ship a dock/pad split -- rewriting that entry would
 * make the file lie about history. The Unreleased section says the model
 * changed and points at it, which is how a changelog retracts something.
 */
const SOURCE_DIRS = ['js', 'py', 'css'];
const SOURCE_FILES = ['demo.html', 'index.html'];
const SOURCE_EXTENSIONS = ['.js', '.mjs', '.py', '.scss', '.css', '.html'];

/** Not our code, or not source. */
const SKIP_DIRS = new Set(['node_modules', '__pycache__', '.venv', 'static']);

function sourceFiles() {
  const out = [];

  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
        continue;
      }
      if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        out.push(join(dir, entry.name));
      }
    }
  };

  SOURCE_DIRS.forEach((dir) => walk(join(ROOT, dir)));
  SOURCE_FILES.forEach((name) => {
    try {
      readFileSync(join(ROOT, name));
      out.push(join(ROOT, name));
    } catch {
      // Not every entry point exists in every checkout.
    }
  });
  return out;
}

// This file is the one place the phrases are written down on purpose.
const SELF = 'dock-vocabulary.test.mjs';

test('⛔ no source file presents a pickup pad as a current thing', () => {
  const files = sourceFiles().filter((f) => !f.endsWith(SELF));

  // ⭐ The check is worthless if it is scanning nothing, and a bad path or a
  // too-eager skip list would do exactly that silently.
  assert.ok(files.length > 40, `expected to scan the source tree, got ${files.length} files`);
  assert.ok(
    files.some((f) => f.endsWith('docks.mjs')),
    'the dock model itself must be in scope',
  );
  assert.ok(
    files.some((f) => f.endsWith('demo.html')),
    'the user-facing copy must be in scope -- that is where it mattered most',
  );
  assert.ok(
    files.some((f) => f.endsWith('config.py')),
    'the python side must be in scope',
  );

  const offences = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const phrase of DEAD_PHRASES) {
      if (text.includes(phrase)) {
        const line = text.slice(0, text.indexOf(phrase)).split('\n').length;
        offences.push(`${file.slice(ROOT.length + 1)}:${line} — "${phrase}"`);
      }
    }
  }

  assert.deepEqual(
    offences,
    [],
    'Everything underneath a screen is a dock. Use a kind (\'charging\', '
      + '\'networked\', \'noncharging\') rather than a second noun:\n  '
      + `${offences.join('\n  ')}`,
  );
});

test('⚠️ but the old stored values are still readable, in both languages', () => {
  // ⛔ The counterweight. If the ban above is ever widened to the bare word,
  // this fails -- and it must, because these two values are in config files on
  // real boards and the migration is the only thing that keeps their meaning.
  const js = readFileSync(join(ROOT, 'js', 'docks.mjs'), 'utf8');
  assert.match(js, /LEGACY_DOCK_KINDS\s*=\s*\{\s*dock:\s*'charging',\s*pad:\s*'noncharging'\s*\}/);

  const py = readFileSync(join(ROOT, 'py', 'config.py'), 'utf8');
  assert.match(py, /LEGACY_DOCK_KINDS\s*=\s*\{'dock':\s*'charging',\s*'pad':\s*'noncharging'\}/);
});
