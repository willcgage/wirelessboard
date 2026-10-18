import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Each Planning Center section can show what its own settings would do.
 *
 * ⛔ The gap this closes: the weekly panel could preview and sync, Matching
 * could show a worked example, and the two sections whose whole purpose is to
 * change behaviour — Rule sets and Calendar & automation — could show nothing
 * at all. A rule set exists to be *different* from the board settings, and the
 * difference was the one thing that could not be seen.
 *
 * ⚠️ Markup and wiring level. These are DOM surfaces with no pure module of
 * their own; what can regress is a control vanishing or pointing nowhere.
 */

const ROOT = path.join(import.meta.dirname, '..');
const markup = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8').replace(/\r\n/g, '\n');
const view = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8');

const section = (id) => markup
  .split(`id="admin-section-${id}"`)[1]
  .split('</section>')[0];

test('⭐ Matching can act on what it just showed', () => {
  const matching = section('pco-matching');
  assert.match(matching, /id="pco-matching-preview"/);
  assert.match(matching, /id="pco-matching-sync"/);
  // It already had the worked example; the controls are what was missing.
  assert.match(matching, /id="pco-example-run"/);
});

test('⛔ and those controls run in the weekly panel, not a second diff', () => {
  // One surface for the slot-by-slot result. Two places that could disagree
  // about what a sync will do is worse than one extra click.
  assert.match(view, /function runSyncFromSection/);
  assert.match(view, /wirelessboard:open-pco/);
});

test('⭐⭐ Rule sets can be checked against a real plan', () => {
  const rulesets = section('pco-rulesets');
  assert.match(rulesets, /id="pco-ruleset-previews"/);
  assert.match(rulesets, /What a rule set would do/);
});

test('⛔ each rule set is resolved with its OWN rules', () => {
  // `?profile=` is the whole point: resolving them all with the board settings
  // would show the same answer under every heading.
  assert.match(view, /api\/pco\/preview\?\$\{params/);
  assert.match(view, /profile: set\.id/);
});

test('⛔⛔ a rule-set card renders into itself, not into Matching', () => {
  // `renderWorkedExample` hardcoded `#pco-example-body` and ignored any target
  // passed to it — every rule set would have drawn into the Matching pane,
  // each overwriting the last, and the section would have looked empty.
  assert.match(view, /function renderWorkedExample\(example, target = null\)/);
  assert.match(view, /const host = target \|\| document\.getElementById\('pco-example-body'\)/);
});

test('⚠️ and previews run one at a time', () => {
  // The server resolves a plan on a single worker. A handful of parallel
  // previews is how the 429 in the venue tests happened.
  assert.match(view, /\.finally\(\(\) => run\(index \+ 1\)\)/);
});

test('⭐⭐ Calendar says what happens without anybody pressing anything', () => {
  const calendar = section('pco-calendar');
  assert.match(calendar, /id="pco-watch-status"/);
  assert.match(calendar, /id="pco-watch-refresh"/);
  assert.match(calendar, /What happens on its own/);
});

test('⛔ the watcher status is read from its own endpoint', () => {
  // Not derived from the settings on screen: the settings cannot tell you the
  // watcher is unarmed, which is the fault this answers.
  assert.match(view, /api\/pco\/watch/);
  assert.match(view, /watchLines/);
});
