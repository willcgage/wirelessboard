/**
 * A slot with no receiver behind it is drawn as one (#186).
 *
 * ⚠️ Comments are stripped from the stylesheet and the view before any
 * assertion, so the explanations of these rules cannot satisfy them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { hasNoReceiver, NO_RECEIVER_CHIP } from './no-receiver.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const strip = (text) => text
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const css = strip(fs.readFileSync(path.join(ROOT, 'css', 'style.scss'), 'utf8'));
const view = strip(fs.readFileSync(path.join(ROOT, 'js', 'channelview.js'), 'utf8'));
const offline = fs.readFileSync(path.join(ROOT, 'py', 'offline.py'), 'utf8');

test('the offline slot is the one the server sends with no receiver', () => {
  // The shape `py/offline.py` emits; if that changes, this rule must follow it.
  assert.match(offline, /'type': 'offline'/);
  assert.equal(hasNoReceiver({ type: 'offline', status: 'UNASSIGNED', slot: 7 }), true);
});

test('a real receiver that is quiet is not mistaken for no receiver', () => {
  assert.equal(hasNoReceiver({ type: 'qlxd', status: 'UNASSIGNED', slot: 3 }), false);
  assert.equal(hasNoReceiver({ type: 'qlxd', status: 'TX_COM_ERROR', slot: 3 }), false);
  assert.equal(hasNoReceiver(null), false);
  assert.equal(hasNoReceiver(undefined), false);
});

test('the chip says it in words, not only with a glyph', () => {
  assert.equal(NO_RECEIVER_CHIP.word, 'No receiver');
  assert.ok(NO_RECEIVER_CHIP.glyph.length > 0);
});

test('the view marks the card and gives it the chip', () => {
  assert.match(view, /classList\.toggle\('no-receiver', hasNoReceiver\(data\)\)/);
  assert.match(view, /hasNoReceiver\(data\) \? NO_RECEIVER_CHIP/);
});

test('nothing that could be read as a measurement is drawn on it', () => {
  for (const part of ['.card-runtime', '.chartzone', '.drawer-figures']) {
    const rule = css.split(`.col-sm.no-receiver ${part}`)[1];
    assert.ok(rule, `no rule hides ${part} on a card with no receiver`);
    assert.match(rule.split('}')[0], /visibility:\s*hidden/);
  }
});

test('it is marked with an edge, not an alarm colour', () => {
  const rule = css.split('.col-sm.no-receiver .mic_name {')[1].split('}')[0];
  assert.match(rule, /dashed var\(--color-gray\)/);
  assert.doesNotMatch(rule, /red|yellow|amber|background/);
});
