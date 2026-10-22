import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import path from 'node:path';

/**
 * ⛔⛔ A class nobody styled renders as the OLD look, beside panes that were
 * restyled for 2.0 — and nothing failed.
 *
 * Reported after beta.20 was installed on the venue board:
 *
 *   "you carried over the old look instead of merging it with what we have now"
 *
 * Exactly that. #298 shipped four classes with **no rules anywhere**:
 * `pco-example__title`, `pco-example__body`, `pco-watch` and `pco-watch__line`.
 * The first was invented — the vocabulary this page already had is
 * `__headline` / `__context` / `__subhead` — and the last two were a new
 * component nobody wrote styles for. The markup was correct, the tests passed,
 * and the pane rendered as unstyled browser defaults.
 *
 * ⚠️ Structural wrappers are allowed to carry no rules, because their children
 * do the drawing. They are listed by name so that allowing one is a decision
 * rather than a hole.
 */

const root = path.join(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'demo.html'), 'utf8');
const scss = fs.readFileSync(path.join(root, 'css', 'style.scss'), 'utf8');
const config = fs.readFileSync(path.join(root, 'js', 'config.js'), 'utf8');

/** Wrappers that deliberately have no rules: their children carry the look. */
const UNSTYLED_WRAPPERS = new Set([
  // The host the worked example draws into; every child is styled (#179).
  'pco-example__body',
  // A layout row built from utilities, with this class only as a JS hook.
  'pco-note-row',
  // A query hook on the assign table's selects. It is always paired with
  // `form-select`, which does the drawing; this class only exists so
  // `querySelector('select.pco-person-select')` can find them.
  'pco-person-select',
]);

/** Our own classes, which the project's stylesheet is responsible for. */
const ours = (name) => name.startsWith('pco-') || name.startsWith('admin-');

function classesIn(markup) {
  const found = new Set();
  const re = /class="([^"]+)"/g;
  let m = re.exec(markup);
  while (m) {
    m[1].split(/\s+/).filter(Boolean).filter(ours).forEach((c) => found.add(c));
    m = re.exec(markup);
  }
  return found;
}

/** Classes assigned from JavaScript, which the markup scan cannot see. */
function classesAssignedInJs(source) {
  const found = new Set();
  const re = /className = '([^']+)'/g;
  let m = re.exec(source);
  while (m) {
    m[1].split(/\s+/).filter(Boolean).filter(ours).forEach((c) => found.add(c));
    m = re.exec(source);
  }
  return found;
}

const hasRule = (cls) => scss.includes(`.${cls}`);

test('⛔⛔ every admin class in the markup is styled, or named as a bare wrapper', () => {
  const unstyled = [...classesIn(html)]
    .filter((c) => !hasRule(c) && !UNSTYLED_WRAPPERS.has(c))
    .sort();

  assert.deepEqual(
    unstyled,
    [],
    'these render as unstyled browser defaults beside restyled panes — '
    + 'add rules, or reuse a class that has them',
  );
});

test('⛔⛔ and every admin class assigned from JavaScript is styled too', () => {
  // ⚠️ The rule-set preview cards are built in `config.js`, not in the markup,
  // so the scan above cannot see them. `pco-example__title` was invented here
  // and reached the venue board.
  const unstyled = [...classesAssignedInJs(config)]
    .filter((c) => !hasRule(c) && !UNSTYLED_WRAPPERS.has(c))
    .sort();

  assert.deepEqual(unstyled, [], 'a class built in JS still has to exist in the stylesheet');
});

test('⚠️ the allowlist does not hide a class that is now styled', () => {
  // ⛔ An allowlist that outlives its reason is how the next one gets waved
  // through. If somebody writes rules for one of these, take it off the list.
  for (const wrapper of UNSTYLED_WRAPPERS) {
    assert.ok(
      !hasRule(wrapper),
      `${wrapper} has rules now — remove it from UNSTYLED_WRAPPERS`,
    );
  }
});

test('⭐ the previews reuse the vocabulary the page already had', () => {
  // ⛔ The specific invention: a `__title`/`__body` pair beside an existing
  // `__headline`/`__context`/`__subhead` set that already did the job.
  assert.ok(!config.includes("'pco-example__title'"), 'pco-example__title is not a real class');
  assert.ok(config.includes("'pco-example__headline'"), 'the card titles use __headline');
});

test('⚠️ the new button rows use the 2.0 row, not Bootstrap utilities', () => {
  // The three rows #298 added. `admin-actions` is what every other pane on
  // this page uses; `d-flex flex-wrap gap-2` is the old look's spacing.
  for (const id of ['pco-matching-preview', 'pco-watch-refresh', 'pco-rulesets-check']) {
    const at = html.indexOf(`id="${id}"`);
    assert.notEqual(at, -1, `${id} is still in the markup`);
    const before = html.slice(Math.max(0, at - 320), at);
    const row = before.lastIndexOf('<div class="');
    assert.ok(row !== -1, `${id} sits in a row`);
    const rowClass = before.slice(row + '<div class="'.length, before.indexOf('"', row + 12));
    assert.ok(
      rowClass.includes('admin-actions'),
      `${id} is in a "${rowClass}" row — the 2.0 page uses admin-actions`,
    );
  }
});

test('⛔⛔ the stylesheet contains no control characters', () => {
  // ⛔ It did, and they reached a screenshot. A `\2022` escape written through
  // a script was read as an OCTAL escape, so the file ended up holding the raw
  // bytes 0x82 and 0x00 — and `content:` drew them as mojibake in front of
  // every watch line. Nothing failed: the markup was right, the selector was
  // right, and the bytes were wrong.
  //
  // ⚠️ The lesson is narrower than "be careful": a CSS escape that has to
  // survive a shell, a heredoc and a string literal usually should not be an
  // escape at all. Write the character.
  const offenders = [];
  for (let i = 0; i < scss.length; i += 1) {
    const code = scss.charCodeAt(i);
    // Tab, newline and carriage return are the only control codes allowed.
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      offenders.push(`0x${code.toString(16)} at ${i}: ${JSON.stringify(scss.slice(i - 40, i + 10))}`);
    }
  }
  assert.deepEqual(offenders, [], 'raw control characters in the stylesheet');
});

test('⚠️ no CSS escape is written where a literal character would do', () => {
  // The specific shape that broke: a quoted `content:` holding a backslash.
  //
  // ⛔ Written without a regular expression on purpose. The first version of
  // THIS TEST was a regex literal, and the heredoc carrying it ate the very
  // backslash it was looking for — turning `\\/g` into `\/g` and leaving an
  // unterminated expression. The trap caught the guard written to catch it.
  const BACKSLASH = String.fromCharCode(92);
  const offenders = [];
  let at = scss.indexOf('content:');
  while (at !== -1) {
    const open = scss.indexOf("'", at);
    const semi = scss.indexOf(';', at);
    if (open !== -1 && (semi === -1 || open < semi)) {
      const close = scss.indexOf("'", open + 1);
      const value = close === -1 ? '' : scss.slice(open + 1, close);
      if (value.includes(BACKSLASH)) {
        offenders.push(value);
      }
    }
    at = scss.indexOf('content:', at + 1);
  }
  assert.deepEqual(
    offenders,
    [],
    'write the character itself — an escape here has to survive a shell, a '
    + 'heredoc and a string literal, and it did not',
  );
});

/**
 * ⛔⛔ A control outside its section body escapes the gate entirely.
 *
 * `applyPcoGate` sets `inert`, toggles `is-gated` and disables every
 * `input, select, textarea, button` — but only within `#<section>-body`. The
 * three controls #298 added were inserted into the section's trailing actions
 * row, which is a SIBLING of that body. On a board with no Planning Center
 * connection every other control in the section was inert and disabled, and
 * these stayed live — **including Sync Now**.
 *
 * ⚠️ It also explains the layout: the trailing row is `display: flex`, so the
 * watch status drew *beside* the buttons instead of above them. One mistake,
 * two symptoms, and only the cosmetic one was visible.
 */
const SECTION_CONTROLS = [
  ['pco-matching', ['pco-matching-preview', 'pco-matching-sync']],
  ['pco-rulesets', ['pco-rulesets-check', 'pco-ruleset-previews']],
  ['pco-calendar', ['pco-watch-status', 'pco-watch-refresh']],
];

/** The slice of markup between `#<id>` opening and the matching close. */
function bodyOf(section) {
  const open = html.indexOf(`id="${section}-body"`);
  assert.notEqual(open, -1, `${section}-body exists`);
  let i = html.indexOf('>', open) + 1;
  let depth = 1;
  const start = i;
  while (depth > 0 && i < html.length) {
    const nextOpen = html.indexOf('<div', i);
    const nextClose = html.indexOf('</div>', i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      i = nextOpen + 4;
    } else {
      depth -= 1;
      if (depth === 0) return html.slice(start, nextClose);
      i = nextClose + 6;
    }
  }
  throw new Error(`could not find the end of ${section}-body`);
}

test('⛔⛔ every Planning Center control sits inside its gated section body', () => {
  const escaped = [];
  for (const [section, ids] of SECTION_CONTROLS) {
    const body = bodyOf(section);
    for (const id of ids) {
      if (!body.includes(`id="${id}"`)) escaped.push(`${id} is outside ${section}-body`);
    }
  }
  assert.deepEqual(
    escaped,
    [],
    'applyPcoGate only reaches the section body — a control outside it stays '
    + 'live on a board with no Planning Center connection',
  );
});

test('⚠️ every section still has the save button the gate disables by id', () => {
  // ⛔ The counterpart to the rule above, and it is deliberately NOT about
  // placement. `applyPcoGate` disables the save button by id, so a save works
  // inside the body or in the trailing row — and the sections genuinely
  // differ: `pco-rulesets-save` is inside its body while the other two are
  // not. Asserting a single position here would have been inventing a rule the
  // code does not have. What must hold is that the id exists for the gate to
  // find.
  for (const [section] of SECTION_CONTROLS) {
    assert.ok(
      html.includes(`id="${section}-save"`),
      `${section}-save must exist — applyPcoGate disables it by id`,
    );
  }
});

/**
 * ⛔⛔ The weekly surface, which #222 deliberately left in the old look.
 *
 * Its rules were scoped to `.admin-section--moved` and the stylesheet said why:
 * "the weekly surface still lives in `#pco-settings` and still uses every one
 * of these classes; restyling them globally would silently redraw a screen
 * this change never looked at." Nobody had looked — until it was photographed
 * on the wall reading as a different application one tap from the board.
 */
function weeklyPanel() {
  // ⭐ A pane now, not a page. The surface moved into the administration page
  // as `#admin-section-pco`, which also means its boundary is a `</section>`
  // rather than a div depth walk.
  const at = html.indexOf('id="admin-section-pco"');
  assert.notEqual(at, -1, '#admin-section-pco exists');
  const start = html.lastIndexOf('<section', at);
  const end = html.indexOf('</section>', start);
  assert.notEqual(end, -1, 'the pane closes');
  return html.slice(start, end + '</section>'.length);
}

/** Bootstrap's vocabulary, which is what "the old look" means here. */
const OLD_LOOK = [
  'btn', 'btn-primary', 'btn-outline-secondary', 'btn-outline-primary',
  'btn-success', 'btn-outline-warning', 'btn-link', 'card', 'config-header',
  'p-3', 'border', 'rounded', 'bg-dark', 'bg-light', 'text-light', 'container',
];

test('⛔⛔ the weekly surface is not wearing the old look', () => {
  const panel = weeklyPanel();
  const worn = new Set();
  const re = /class="([^"]+)"/g;
  let m = re.exec(panel);
  while (m) {
    m[1].split(/\s+/).filter(Boolean).forEach((c) => {
      if (OLD_LOOK.includes(c)) worn.add(c);
    });
    m = re.exec(panel);
  }
  assert.deepEqual(
    [...worn].sort(),
    [],
    'this screen sits one tap from the board and must not read as another app',
  );
});

test('⛔⛔ and the close button is not restyled back by JavaScript', () => {
  // The markup could not fix this on its own: `showPCOView` forced
  // `textContent = 'Close'` and `classList.add('btn-outline-secondary')` on
  // every open, so whatever the page said, opening the view put the old look
  // back. It only renames the legacy `pco-back` id now.
  //
  // ⚠️ Matched on the statement, not the string. The first version of this
  // guard searched for `classList.add('btn-outline-secondary')` and failed on
  // the COMMENT above the fix, which quotes the old line -- a guard that
  // cannot tell code from prose about code.
  assert.ok(
    !config.includes('backBtn.classList.add('),
    'showPCOView must not re-apply Bootstrap classes to the close button',
  );
  assert.ok(
    !config.includes('backBtn.textContent ='),
    'the button’s label belongs to the markup, not to the open handler',
  );
});

test('⚠️ the weekly surface is a pane, not a page with a width of its own', () => {
  // ⛔ It was Bootstrap's `.container` — 960px — which on the venue's 1920px
  // television is half the screen with the rest empty. It takes its width from
  // the administration page now, like every other section; prose still wraps,
  // because `.admin-section__lead` carries its own max-width.
  const panel = weeklyPanel();
  const opening = panel.slice(0, panel.indexOf('>') + 1);
  assert.ok(!/\bcontainer\b/.test(opening), `the pane opened as: ${opening}`);
  assert.ok(opening.includes('admin-section--moved'), 'it is a moved section');
  assert.ok(scss.includes('.admin-section__lead'), 'prose keeps its own width');
});

test('⛔⛔ a pane scrolls instead of squashing the blocks inside it', () => {
  // A `.admin-section--moved` pane is a column flex container, so its children
  // are flex items — and a flex item shrinks below its own content before the
  // container overflows. On a pane taller than the space it has, that silently
  // COMPRESSES blocks rather than scrolling.
  //
  // Measured on the weekly pane: the "Remember each person's position" check
  // was clamped to 24px while its own grid rows needed 60, and the help text
  // inside it ran 19px down over the buttons below.
  //
  // ⚠️ It only shows on a pane long enough to overflow, which is why eleven
  // panes looked right and the twelfth did not — the guard is here so the next
  // long pane does not have to rediscover it.
  const at = scss.indexOf('.admin-section--moved > * {');
  assert.notEqual(at, -1, 'pane children must pin their own height');

  const block = scss.slice(at, scss.indexOf('}', at));
  assert.ok(
    block.includes('flex-shrink: 0'),
    'children of a pane must not shrink below their content',
  );
  // ⛔ `flex: none` would also stop the shrink and would break the nested rows:
  // `.row`, `.form-row` and `.input-group` children are handed `flex` values
  // that have to keep growing and wrapping.
  assert.ok(!block.includes('flex: none'), 'pin the shrink only, not the whole shorthand');
});
