/**
 * The configuration sweep: drive the board through every arrangement it can be
 * in and check what it drew, rather than what it was asked to draw.
 *
 * ⛔⛔ **Why this exists.** Two faults reported from a real wall -- #273 (the RF
 * figure and the frequency clipped at the card's edges) and #274 (the status
 * colour painted twice under Edge rail) -- were each diagnosed from the
 * stylesheet, "confirmed" against a card built by hand in one configuration,
 * and were each wrong. One fix was a no-op; the other was never found. The
 * maintainer's conclusion is the right one:
 *
 *   "One thing we have not done well is testing after fixes. Testing every
 *    possible configuration arrangement is grueling, but it needs to be done."
 *
 * ⭐ It is grueling for a person and cheap for a machine. Six controls with
 * three or four values each is several hundred boards; a sweep visits them all
 * and reports the numbers.
 *
 * ⛔ **This measures a real board, never a reconstruction.** Every failed
 * diagnosis this file is a response to came from a card assembled in a vacuum:
 * no payload, no status classes, no type scale from a layout pass. A clean
 * render in a probe like that is not evidence that the board is clean, which is
 * exactly the trap worth not falling into twice.
 *
 * ⚠️ The checks below are deliberately about *geometry and paint*, not about
 * appearance. "Is the frequency inside its card" has an answer; "does this look
 * right" does not, and a sweep that asks the second question reports noise.
 */

/**
 * The controls the sweep walks, and the values each can take.
 *
 * ⚠️ `displayMode` is absent on purpose: the whole sweep runs in Board mode,
 * which is the only mode these faults appear in, and switching out of it
 * mid-sweep would throw away the layout being measured.
 */
export const SWEEP_CONTROLS = {
  arrangement: ['fit', 'row', 'column', 'grid'],
  cardShape: ['auto', 'wide', 'tall'],
  wash: ['band', 'full', 'rail'],
  columns: ['auto', '4', '6', '8', '12'],
  statusBar: ['off', 'top', 'bottom'],
  livePlacement: ['off', 'top', 'bottom', 'card'],
  // ⛔⛔ The dimension the first version of this sweep was missing, and the
  // one that mattered. `.elinfo01` and `.elinfo11` both set a background on
  // `.mic_name` at a specificity that beats the status class, so the card is
  // forced neutral whenever the drawer is on -- and left painted when it is
  // off. A sweep that never turned the drawer off could only ever have seen
  // half of the board's behaviour, and reported the half that works.
  infoDrawerMode: ['elinfo00', 'elinfo01', 'elinfo10', 'elinfo11'],
};

/**
 * Every combination, as a flat list.
 *
 * ⚠️ `only` narrows it for a targeted run -- `combinations({ wash: ['rail'] })`
 * is the whole of #274's question and is a few seconds rather than an hour.
 */
export function combinations(only = {}) {
  const names = Object.keys(SWEEP_CONTROLS);
  let out = [{}];
  for (const name of names) {
    const values = only[name] || SWEEP_CONTROLS[name];
    const next = [];
    for (const base of out) {
      for (const value of values) {
        next.push({ ...base, [name]: value });
      }
    }
    out = next;
  }
  return out;
}

/** A box is inside another when no edge escapes it, give or take `slack`. */
function escapes(inner, outer, slack) {
  const out = [];
  if (inner.top < outer.top - slack) out.push(`top by ${Math.round(outer.top - inner.top)}px`);
  if (inner.bottom > outer.bottom + slack) out.push(`bottom by ${Math.round(inner.bottom - outer.bottom)}px`);
  if (inner.left < outer.left - slack) out.push(`left by ${Math.round(outer.left - inner.left)}px`);
  if (inner.right > outer.right + slack) out.push(`right by ${Math.round(inner.right - outer.right)}px`);
  return out;
}

/**
 * ⭐ The invariant #273 is about: nothing the card carries may be drawn outside
 * it. The drawer is the part that loses when something does not fit -- it is
 * the only child that cannot absorb slack -- so the frequency is what goes over
 * the edge, which is precisely what was photographed.
 *
 * ⚠️ One pixel of slack. Sub-pixel layout rounds, and a sweep that reports
 * every half pixel reports nothing anyone will read.
 */
export function checkContainment(card, slack = 1) {
  const problems = [];
  for (const [name, box] of Object.entries(card.parts || {})) {
    if (!box || !box.height) continue;
    const gone = escapes(box, card.box, slack);
    if (gone.length) {
      problems.push({ check: 'containment', part: name, detail: `outside the card: ${gone.join(', ')}` });
    }
  }
  return problems;
}

/**
 * ⭐ The invariant #273 is really about, and the one `checkContainment` cannot
 * see: text clipped *inside* the card.
 *
 * ⛔⛔ Containment compares a part against the card, so a figure that overflows
 * its own box and is cut off by an `overflow: hidden` ancestor is still inside
 * the card and still reported clean. That is exactly the shape of the reported
 * fault -- the RF figure and the frequency "cut off" -- and 144 configurations
 * passed containment against a real board without answering it.
 *
 * ⚠️ Horizontal only. `.device-name` reports a 2px vertical overflow in every
 * single configuration (a 22px line in a 20px box), so a vertical check is pure
 * noise, and the reported fault is at the card's sides in any case.
 */
export function checkClipping(card) {
  return (card.clipped || []).map((c) => ({
    check: 'clipping',
    part: c.part,
    detail: `"${c.text}" is cut off: ${c.scrollWidth}px of text in ${c.clientWidth}px`,
  }));
}

/**
 * ⭐ The invariant #274 is about: the status colour appears exactly once.
 *
 * ⛔ Each wash has one place for it and the others must be clear. `rail` was
 * reported showing it on the rail **and** where the band carries it, which is
 * two -- and the count is the whole test, whatever element turns out to be
 * doing it. That matters because the obvious culprit, read from the
 * stylesheet, was the wrong one.
 */
export const WASH_PAINTS = { band: 'band', full: 'card', rail: 'rail' };

export function checkWash(card, wash) {
  // ⛔⛔ Some states have no colour to find. `TX_COM_ERROR` and `UNASSIGNED`
  // resolve `--status` to the neutral card ground itself (#262626), and
  // `PREV_REPLACE` is a striped gradient with no flat colour at all. A card in
  // one of those cannot be told apart from an unpainted one by colour, so it
  // is skipped rather than guessed at.
  //
  // ⚠️ This is not a nicety. The first run of this sweep reported the status
  // colour in three places at once, which looked like a dramatic confirmation
  // of #274 and was entirely the detector matching neutral against neutral.
  // A harness that reports noise is worse than one that reports nothing.
  if (card.statusPainted === null) {
    return [];
  }
  const painted = (card.statusPainted || []).slice().sort();
  const expected = WASH_PAINTS[wash];
  if (!expected) {
    return [{ check: 'wash', detail: `no rule for wash "${wash}"` }];
  }
  if (painted.length === 1 && painted[0] === expected) {
    return [];
  }
  return [{
    check: 'wash',
    detail: painted.length
      ? `status colour on [${painted.join(', ')}], expected only [${expected}]`
      : `status colour nowhere, expected [${expected}]`,
  }];
}

/**
 * ⭐ The invariant #276 is about: two arrangements given the same board must
 * not disagree about the card.
 *
 * ⚠️ They are *allowed* to choose different column counts -- that is what an
 * arrangement is for. What they may not do is produce different card geometry
 * for the same column count, which is the difference between a choice and an
 * inconsistency.
 */
export function compareArrangements(results) {
  const byShape = new Map();
  for (const r of results) {
    if (!r.cards || !r.cards.length) continue;
    const key = [r.config.cardShape, r.config.wash, r.columns, r.rows].join('|');
    const geometry = `${Math.round(r.cards[0].box.width)}x${Math.round(r.cards[0].box.height)}`;
    if (!byShape.has(key)) byShape.set(key, new Map());
    const seen = byShape.get(key);
    if (!seen.has(geometry)) seen.set(geometry, []);
    seen.get(geometry).push(r.config.arrangement);
  }
  const problems = [];
  for (const [key, seen] of byShape) {
    if (seen.size <= 1) continue;
    const parts = [...seen.entries()].map(([g, arr]) => `${arr.join('/')}: ${g}`);
    const [shape, wash, columns, rows] = key.split('|');
    problems.push({
      check: 'arrangement',
      detail: `same ${columns}x${rows} board (shape ${shape}, wash ${wash}) drew different cards — ${parts.join('; ')}`,
    });
  }
  return problems;
}

/** Every check for one measured board. */
export function checkBoard(snapshot) {
  const problems = [];
  for (const card of snapshot.cards || []) {
    for (const p of checkContainment(card)) {
      problems.push({ ...p, slot: card.slot });
    }
    for (const p of checkWash(card, snapshot.config.wash)) {
      problems.push({ ...p, slot: card.slot });
    }
    for (const p of checkClipping(card)) {
      problems.push({ ...p, slot: card.slot });
    }
  }
  // ⛔ A board that drew no cards at all is a failure, not a pass. An empty
  // sweep step reports nothing wrong by construction, which is the quietest
  // possible way for a harness to lie.
  if (!snapshot.cards || !snapshot.cards.length) {
    problems.push({ check: 'cards', detail: 'the board drew no cards' });
  }
  // ⛔⛔ And neither is a board whose layout never ran. `--tvmode-columns` is
  // empty until the layout pass has set it, and every card is then the stale
  // default size — so the containment check measures a card the board is not
  // showing and reports it clean.
  //
  // Caught doing exactly that: a run against a real board reported "all 12
  // configurations passed" while every card was 420x1080, the untouched
  // default, because the browser pane had gone to the background and
  // `requestAnimationFrame` stalled with it. The answer is to say so, not to
  // pass.
  if (!snapshot.columns || snapshot.columns === '?') {
    problems.push({
      check: 'layout',
      detail: 'the layout pass did not run — every measurement here is of a stale card. '
        + 'Keep the board on screen while the sweep runs.',
    });
  }
  return problems;
}

/** One line per configuration that failed, and nothing for the ones that passed. */
export function formatReport(results) {
  const lines = [];
  let failed = 0;
  for (const r of results) {
    const problems = checkBoard(r);
    if (!problems.length) continue;
    failed += 1;
    const where = Object.entries(r.config).map(([k, v]) => `${k}=${v}`).join(' ');
    lines.push(`✖ ${where}  (${r.columns}x${r.rows})`);
    // ⚠️ One line per distinct problem, not per card. Twelve cards clipped the
    // same way is one fault, and printing it twelve times buries the next one.
    const seen = new Set();
    for (const p of problems) {
      const key = `${p.check}|${p.part || ''}|${p.detail}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const slots = problems.filter((q) => `${q.check}|${q.part || ''}|${q.detail}` === key)
        .map((q) => q.slot).filter((s) => s != null);
      let count = '';
      if (slots.length > 1) {
        count = ` [${slots.length} cards]`;
      } else if (slots.length) {
        count = ` [slot ${slots[0]}]`;
      }
      lines.push(`    ${p.check}: ${p.part ? `${p.part} — ` : ''}${p.detail}${count}`);
    }
  }
  for (const p of compareArrangements(results)) {
    failed += 1;
    lines.push(`✖ ${p.check}: ${p.detail}`);
  }
  const head = failed
    ? `${failed} of ${results.length} configurations failed`
    : `all ${results.length} configurations passed`;
  return [head, ...lines].join('\n');
}
