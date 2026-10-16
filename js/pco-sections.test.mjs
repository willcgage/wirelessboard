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

test('⛔⛔ every control is inside the body the gate disables, not merely in the section', () => {
  // Found on the running board, not here. The automatic-sync switch and the
  // worked example's button had been appended AFTER `#<section>-body`, so the
  // connection gate -- which walks the controls inside that body -- never
  // reached them: on a board with no credentials both were live, and the
  // example's button would have fired a Planning Center request.
  //
  // ⭐ Checked by position rather than by matching nested <div>s, which is what
  // made the first attempt at this check wrong: the Save button is always the
  // last thing in a section, so "after the body opens and before the Save" is
  // exactly the gated region.
  const html = readFileSync(join(HERE, '..', 'demo.html'), 'utf8');

  PCO_SECTIONS.forEach((section) => {
    const sectionAt = html.indexOf(`id="admin-section-${section.id}"`);
    const bodyAt = html.indexOf(`id="${section.id}-body"`, sectionAt);
    const saveAt = html.indexOf(`id="${section.id}-save"`, sectionAt);
    assert.ok(bodyAt > sectionAt, `${section.id} has no gated body`);
    assert.ok(saveAt > bodyAt, `${section.id}'s Save is not after its body`);

    section.controls.forEach((controlId) => {
      const at = html.indexOf(`id="${controlId}"`, sectionAt);
      assert.ok(at > bodyAt, `${controlId} sits before ${section.id}-body, outside the gate`);
      assert.ok(at < saveAt, `${controlId} sits after ${section.id}-save, outside the gate`);
    });
  });
});

test('⛔ and that guard can fail', () => {
  // Planted: the fault as it actually was -- the control after the Save.
  const planted = '<div id="pco-matching-body"></div><button id="pco-matching-save"></button><input id="pco-auto-sync">';
  const bodyAt = planted.indexOf('id="pco-matching-body"');
  const saveAt = planted.indexOf('id="pco-matching-save"');
  const at = planted.indexOf('id="pco-auto-sync"');
  assert.ok(at > bodyAt, 'it is after the body, which is why the weaker check passed');
  assert.ok(!(at < saveAt), 'but it is after the Save, which is what this catches');
});

/**
 * How deeply `needle` is nested below the element that opens at `from`.
 *
 * ⛔ Counts <div>/<section> depth rather than indentation. Counting indentation
 * is exactly what put the worked example *inside* the Service-type row.
 */
function depthOf(html, from, needle) {
  const at = html.indexOf(needle, from);
  assert.ok(at > from, `${needle} not found after the opening tag`);
  const tag = /<(\/?)(?:div|section)\b/gi;
  tag.lastIndex = from;
  let depth = 0;
  let m = tag.exec(html);
  while (m && m.index < at) {
    depth += m[1] ? -1 : 1;
    m = tag.exec(html);
  }
  // 1 = a direct child of the element that opened at `from`.
  return depth - 1;
}

test('⛔⛔ the pane is the shape it reads as, not merely one that behaves', () => {
  // The bug this exists to stop: the automatic-sync switch, the worked
  // example's heading and the example itself were nested INSIDE the
  // Service-type row, because a move counted indentation to find a closing
  // </div> and matched the wrong one. Every behavioural check still passed --
  // they were inside the gated body, the gate reached them, nothing overlapped
  // -- because none of those questions is "is the document the shape you
  // meant". On screen it read as Service type, then nothing, then the example.
  const html = readFileSync(join(HERE, '..', 'demo.html'), 'utf8');
  const bodyAt = html.indexOf('id="pco-matching-body"');
  assert.ok(bodyAt > 0, 'the Matching body is gone');
  const bodyOpen = html.lastIndexOf('<div', bodyAt);

  // ⚠️ Only the two that were actually buried. The strategy cards legitimately
  // sit inside a Bootstrap row with the switches they belong to, and asserting
  // a depth for every element would be pinning the markup's shape rather than
  // the one thing that went wrong: a block of its own, nested into another.
  [
    ['id="pco-auto-sync"', 2],   // its own .form-check, a child of the body
    ['class="pco-example"', 1],  // the example block itself
  ].forEach(([needle, maxDepth]) => {
    const depth = depthOf(html, bodyOpen, needle);
    assert.ok(
      depth <= maxDepth,
      `${needle} is ${depth} levels inside the body — it has been nested into another block`,
    );
  });
});

test('⛔ and that shape check can fail', () => {
  // Planted: the fault as it was, the example buried two rows down.
  const planted = '<div id="pco-matching-body"><div class="row"><div class="col">'
    + '<div class="pco-example"></div></div></div></div>';
  const depth = depthOf(planted, planted.indexOf('<div id="pco-matching-body"'), 'class="pco-example"');
  assert.ok(depth > 1, `a buried example should read as deep, got ${depth}`);
});

test('the blocks read in the order somebody works through them', () => {
  const html = readFileSync(join(HERE, '..', 'demo.html'), 'utf8');
  const at = (needle) => {
    const i = html.indexOf(needle);
    assert.ok(i > 0, `${needle} is missing`);
    return i;
  };
  // Service type, then who to read, then how a position becomes a slot, then
  // what that would do to a real plan. The example is the evidence, so it ends
  // the pane rather than interrupting it.
  const order = ['id="pco-service-type-id"', 'id="pco-team-filter"', 'id="pco-note-category"',
    'id="pco-strategy-cards"', 'id="pco-auto-sync"', 'class="pco-example"', 'id="pco-matching-save"'];
  const positions = order.map(at);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'the Matching pane is out of order');
});

// ---------------------------------------------------------------------------
// The 2.0 look, and the surface it must not touch (#222)
// ---------------------------------------------------------------------------

test('⛔⛔ the restyle is scoped to the administration page, never to the class', () => {
  // The weekly surface -- choose a plan, preview, sync -- still lives in
  // `#pco-settings` and still uses every one of these classes. Restyling
  // `.pco-step-heading` itself would silently redraw a screen this work never
  // looked at, which is the cheapest possible way to break something nobody is
  // testing.
  const css = readFileSync(join(HERE, '..', 'css', 'style.scss'), 'utf8');

  // The pane heading is the clearest micboard-era signal: uppercase, yellow,
  // with a rule under it. The override exists...
  assert.match(css, /\.admin-section--moved \.pco-step-heading \{/);

  // ...and the original is still there, untouched, for the weekly surface.
  const bare = css.slice(css.indexOf('\n.pco-step-heading {'));
  const block = bare.slice(0, bare.indexOf('}'));
  assert.match(block, /text-transform: uppercase/, 'the weekly surface lost its own heading style');
  assert.match(block, /color: var\(--color-yellow\)/);
});

/**
 * Selector lines that restyle `cls` globally — at the top level, with no
 * ancestor in front of them.
 *
 * ⛔ Brace-depth aware, because this is SCSS: `#pco-settings { .form-check-label
 * { … } }` is scoped, and a line-based reading calls it bare. A guard written
 * against a file format has to understand that format, or it reports the
 * correct code as the fault — which this one did, twice, before it counted
 * braces.
 */
function bareRules(css, cls) {
  const out = [];
  let depth = 0;
  css.split('\n').forEach((raw) => {
    const line = raw.trim();
    if (depth === 0 && (line.startsWith(`.${cls} {`) || line.startsWith(`.${cls},`))) {
      out.push(line);
    }
    // Counted after the test, so the selector line itself is read at the depth
    // it sits at rather than the one it opens.
    depth += (raw.match(/\{/g) || []).length - (raw.match(/\}/g) || []).length;
  });
  return out;
}

test('⛔ no Bootstrap class is restyled globally', () => {
  // These are shared with the weekly surface -- choose a plan, preview, sync --
  // which still lives in `#pco-settings`. A BARE rule reaches every one of
  // them; a scoped one reaches only what it names, and which scope it names is
  // that rule's own business (`#discovery-settings-panel` legitimately styles
  // its own checkboxes).
  const css = readFileSync(join(HERE, '..', 'css', 'style.scss'), 'utf8');
  ['form-row', 'form-check-input', 'form-check-label', 'btn-primary'].forEach((cls) => {
    assert.deepEqual(
      bareRules(css, cls), [],
      `.${cls} is restyled globally, which reaches the weekly Planning Center surface too`,
    );
  });
});

test('⛔ and that scoping check can fail, without flagging scoped rules', () => {
  // A global override: flagged.
  const planted = '.admin-section--moved .form-row {\n  gap: 8px;\n}\n.form-row {\n  gap: 0;\n}';
  assert.equal(bareRules(planted, 'form-row').length, 1, 'the check would have missed a global override');

  // Scoped by a descendant selector: not flagged.
  assert.equal(bareRules('.admin-section--moved .form-row {\n  gap: 8px;\n}', 'form-row').length, 0);

  // ⛔ And scoped by SCSS nesting: not flagged either. This is the case that
  // made the check report correct code as the fault.
  const nested = '#pco-settings {\n  .form-row {\n    gap: 0;\n  }\n}';
  assert.equal(bareRules(nested, 'form-row').length, 0, 'a nested rule is scoped, not global');
});
