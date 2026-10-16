/**
 * The Planning Center split (#179).
 *
 * ⛔ These are the acceptance criteria from the issue, written as tests:
 * each section's payload contains only the keys that section owns, saving one
 * section leaves the others untouched, and nothing below Connection is
 * reachable before a connection exists.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PCO_SECTIONS, PCO_SECTION_IDS, MAPPING_KEYS, ownerOf, isConnected,
  sectionAvailable, payloadFor, pcoStateLine, ownershipIsExclusive,
  NOT_CONNECTED_NOTE,
} from './pco-sections.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const CONNECTED = {
  auth: { has_credentials: true },
  enabled: true,
  services: { service_type_id: '12345', service_type_name: 'Sunday Morning' },
  mapping: { team_name_filter: ['Vocals', 'Band', 'Tech', 'Speaking'], auto_sync: false },
  profiles: [{ id: 'a' }, { id: 'b' }],
  watch_active_plan: true,
  live_strip: false,
};

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

test('⛔ every key is owned by exactly one section', () => {
  const { ok, shared } = ownershipIsExclusive();
  assert.ok(ok, `shared keys: ${JSON.stringify(shared)}`);
});

test('⛔ every key the old single payload wrote still has an owner', () => {
  // The fault being removed: buildPcoPayload() posted all of these together.
  // A key with no owner would silently stop being saveable at all.
  const wrote = [
    'enabled', 'auth', 'services', 'mapping', 'profiles',
    'watch_active_plan', 'watch_interval_seconds', 'watch_grace_minutes',
    'live_strip', 'live_timer_mode',
  ];
  wrote.forEach((key) => {
    assert.ok(ownerOf(key), `nothing owns ${key} any more`);
  });
});

test('⛔⛔ auto_sync stays a mapping key, so it keeps inheriting per rule set', () => {
  // It reads as a Calendar & automation setting and the issue lists it there.
  // It cannot move: pco_auto_sync reads it through pco_profiles.effective_mapping,
  // which is what lets Youth sync automatically while the main service stays
  // manual. A partial mapping cannot be sent either -- the server replaces the
  // whole sub-object -- so whichever section sends `mapping` owns every leaf.
  assert.ok(MAPPING_KEYS.includes('auto_sync'));
  assert.equal(ownerOf('mapping'), 'pco-matching');
  assert.equal(ownerOf('auto_sync'), null, 'auto_sync is a leaf of mapping, never a top-level key');

  // And the Python side still reads it as a mapping key.
  const src = readFileSync(join(HERE, '..', 'py', 'pco_auto_sync.py'), 'utf8');
  assert.match(src, /AUTO_SYNC_KEY = 'auto_sync'/);
  assert.match(src, /mapping\.get\(AUTO_SYNC_KEY\)/);
});

test('a payload carries only the keys its section owns', () => {
  const payload = payloadFor('pco-calendar', {
    watch_active_plan: true,
    watch_interval_seconds: 60,
    watch_grace_minutes: 5,
  });
  assert.deepEqual(Object.keys(payload).sort(), [
    'watch_active_plan', 'watch_grace_minutes', 'watch_interval_seconds',
  ]);
});

test('⛔ handing a section a key it does not own throws, it does not filter quietly', () => {
  // A payload that silently drops a field looks exactly like a save that
  // worked -- which is how the fault this split removes stayed invisible.
  assert.throws(
    () => payloadFor('pco-calendar', { watch_active_plan: true, mapping: {} }),
    /does not own: mapping/,
  );
  assert.throws(() => payloadFor('pco-nope', {}), /unknown PCO section/);
});

test('a key left out is left out, so a section can save a subset of its own', () => {
  const payload = payloadFor('pco-live', { live_strip: true });
  assert.deepEqual(payload, { live_strip: true });
  assert.ok(!('live_timer_mode' in payload));
});

test('⭐ saving one section leaves every other section\'s keys untouched', () => {
  // The server merges at the top level, so this is the whole guarantee: what
  // is not in the payload is not rewritten.
  const stored = { ...CONNECTED };
  const payload = payloadFor('pco-live', { live_strip: true, live_timer_mode: 'countdown' });
  const after = { ...stored, ...payload };

  PCO_SECTIONS.filter((s) => s.id !== 'pco-live').forEach((section) => {
    section.owns.forEach((key) => {
      assert.deepEqual(after[key], stored[key], `${section.id} lost ${key}`);
    });
  });
  assert.equal(after.live_strip, true);
});

// ---------------------------------------------------------------------------
// The connection gate
// ---------------------------------------------------------------------------

test('⛔ connected means stored credentials, never the enabled switch', () => {
  assert.equal(isConnected({ auth: { has_credentials: true } }), true);
  assert.equal(isConnected({ enabled: true }), false, 'enabled is not a connection');
  assert.equal(isConnected({ auth: { has_credentials: false }, enabled: true }), false);
  assert.equal(isConnected({}), false);
  assert.equal(isConnected(null), false);
});

test('⛔⛔ nothing but Connection is reachable before a connection exists', () => {
  const fresh = {};
  assert.equal(sectionAvailable('pco-connection', fresh), true);
  ['pco-matching', 'pco-rulesets', 'pco-calendar', 'pco-live'].forEach((id) => {
    assert.equal(sectionAvailable(id, fresh), false, `${id} was reachable on a fresh board`);
  });
});

test('and all of them are reachable once it does', () => {
  PCO_SECTION_IDS.forEach((id) => {
    assert.equal(sectionAvailable(id, CONNECTED), true, `${id} unavailable while connected`);
  });
});

test('⚠️ switching the integration off does not take the sections away', () => {
  // `enabled` is the administrator's switch, not a connection. Hiding the
  // settings when it is off would mean turning it on to change anything.
  const off = { ...CONNECTED, enabled: false };
  PCO_SECTION_IDS.forEach((id) => {
    assert.equal(sectionAvailable(id, off), true, `${id} vanished when switched off`);
  });
});

test('the explanation is one sentence, not a tooltip per control', () => {
  assert.match(NOT_CONNECTED_NOTE, /Planning Center account/);
  assert.ok(NOT_CONNECTED_NOTE.length < 200);
});

// ---------------------------------------------------------------------------
// What the rail says without opening anything
// ---------------------------------------------------------------------------

test('every section says its state on the rail', () => {
  assert.equal(pcoStateLine('pco-connection', CONNECTED), 'Connected');
  assert.equal(pcoStateLine('pco-matching', CONNECTED), 'Sunday Morning · 4 teams');
  assert.equal(pcoStateLine('pco-rulesets', CONNECTED), '2 rule sets');
  assert.equal(pcoStateLine('pco-calendar', CONNECTED), 'Watching, notifies');
  assert.equal(pcoStateLine('pco-live', CONNECTED), 'Strip off');
});

test('⚠️ connected-and-switched-off is its own state', () => {
  assert.equal(pcoStateLine('pco-connection', { ...CONNECTED, enabled: false }), 'Connected, switched off');
  assert.equal(pcoStateLine('pco-connection', {}), 'Not connected');
});

test('a section that needs a connection says so rather than reading as empty', () => {
  ['pco-matching', 'pco-rulesets', 'pco-calendar', 'pco-live'].forEach((id) => {
    assert.equal(pcoStateLine(id, {}), 'Needs a connection');
  });
});

test('⭐ "Watching, never fired" vs "syncs itself" are told apart', () => {
  assert.equal(pcoStateLine('pco-calendar', { ...CONNECTED, watch_active_plan: false }), 'Not watching');
  assert.equal(
    pcoStateLine('pco-calendar', { ...CONNECTED, mapping: { auto_sync: true } }),
    'Watching, syncs itself',
  );
});

test('the state lines survive a configuration with nothing in it', () => {
  PCO_SECTION_IDS.forEach((id) => {
    const line = pcoStateLine(id, { auth: { has_credentials: true } });
    assert.ok(typeof line === 'string' && line.length, `${id} had no state line`);
  });
  assert.equal(pcoStateLine('pco-rulesets', { auth: { has_credentials: true } }), 'None — the board mapping is used');
  assert.equal(pcoStateLine('pco-matching', { auth: { has_credentials: true } }), 'Nothing matched yet');
});

// ---------------------------------------------------------------------------
// The thing being removed
// ---------------------------------------------------------------------------

test('⛔ buildPcoPayload is gone', () => {
  // The issue's acceptance criterion, and the reason the rest of this file
  // exists: one function that read every field in the panel and posted them
  // together.
  const config = readFileSync(join(HERE, 'config.js'), 'utf8');
  assert.ok(
    !config.includes('function buildPcoPayload'),
    'buildPcoPayload is back -- one payload for the whole panel is the fault #179 removes',
  );
});

test('⛔ and the guard above can fail', () => {
  const planted = 'function buildPcoPayload() { return {}; }';
  assert.ok(planted.includes('function buildPcoPayload'), 'the check would have missed it');
});

// ---------------------------------------------------------------------------
// A control must live in the section whose Save carries it
// ---------------------------------------------------------------------------

/** The markup of one administration section, by id. */
function sectionMarkup(html, sectionId) {
  const open = html.indexOf(`id="admin-section-${sectionId}"`);
  assert.ok(open > 0, `no markup for ${sectionId}`);
  const end = html.indexOf('</section>', open);
  assert.ok(end > open, `${sectionId} has no closing tag`);
  return html.slice(open, end);
}

test('⛔⛔ every control sits in the section that owns its key', () => {
  // Found on the running board, not here: "Re-sync by itself when the plan
  // changes" was drawn under Calendar & automation, where it reads naturally.
  // But `auto_sync` is a mapping key, owned by Matching -- so toggling it and
  // pressing "Save calendar" posted a payload that did not contain it, and
  // said "Saved." A control whose Save does not carry it is worse than a
  // missing one.
  const html = readFileSync(join(HERE, '..', 'demo.html'), 'utf8');

  PCO_SECTIONS.forEach((section) => {
    const markup = sectionMarkup(html, section.id);
    section.controls.forEach((controlId) => {
      assert.ok(
        markup.includes(`id="${controlId}"`),
        `${controlId} is not inside ${section.id}, whose Save is what would carry it`,
      );
    });
  });
});

test('⛔ and no control appears in two sections', () => {
  const html = readFileSync(join(HERE, '..', 'demo.html'), 'utf8');
  const markups = PCO_SECTIONS.map((s) => ({ id: s.id, html: sectionMarkup(html, s.id) }));

  PCO_SECTIONS.forEach((section) => {
    section.controls.forEach((controlId) => {
      const homes = markups.filter((m) => m.html.includes(`id="${controlId}"`)).map((m) => m.id);
      assert.deepEqual(homes, [section.id], `${controlId} appears in ${homes.join(' and ')}`);
    });
  });
});

test('⛔ that guard can fail', () => {
  // Planted: the fault as it actually was -- the control in the wrong section.
  const planted = '<section id="admin-section-pco-calendar"><input id="pco-auto-sync"></section>';
  const matching = '<section id="admin-section-pco-matching"></section>';
  assert.ok(!matching.includes('id="pco-auto-sync"'), 'the check would have missed it');
  assert.ok(planted.includes('id="pco-auto-sync"'), 'and would have found where it really was');
});

test('every declared control is one the panel actually has', () => {
  const html = readFileSync(join(HERE, '..', 'demo.html'), 'utf8');
  PCO_SECTIONS.forEach((section) => {
    assert.ok(section.controls.length, `${section.id} declares no controls`);
    section.controls.forEach((controlId) => {
      assert.ok(html.includes(`id="${controlId}"`), `${controlId} is declared but not in the markup`);
    });
  });
});
