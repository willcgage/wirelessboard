/**
 * The worked example: what this mapping would do to the next plan (#179).
 *
 * ⭐⭐ **The point of it.** Setting a matching rule is guesswork until you can
 * see the result — the issue puts it plainly: *"That turns setting a rule into
 * checking a result, which is the single biggest difference between this being
 * easy and being guesswork."* So Matching ends in a short reckoning against a
 * real plan: `Vocal 1 → Jane Smith`, `IEM 1 → Jane Smith`,
 * `Speaker → no position set`, **11 of 12 slots would be filled**.
 *
 * ⛔ It is built from `api/pco/preview`, which already existed for Preview
 * Sync: `async`, resolved on the single PCO worker, and it **writes nothing**.
 * That matters more than the convenience — a worked example that fetched a
 * plan on the Tornado loop would freeze every board for the length of the call,
 * which is the fault that has bitten this project three times
 * ([[pco-and-ioloop-blocking]]).
 *
 * ⚠️ And it is a **reckoning, not a sync**. Nothing here has been applied, and
 * every sentence this produces has to keep saying so.
 */

function text(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Why a person reached a slot, in words rather than the matcher's enum.
 *
 * ⚠️ This is the evidence half. "Vocal 1 → Jane Smith" is useful; "Vocal 1 →
 * Jane Smith, because the position matched" is checkable — it tells an
 * administrator which of the rules above actually did the work, which is the
 * only way to know whether changing one of them would help.
 */
export const MATCHED_VIA = {
  position: 'position',
  position_number: 'position number',
  note: 'note',
  brackets: '[ID] in the name',
  id: '[ID] in the name',
};

export function viaLabel(value) {
  const key = text(value);
  if (!key) {
    return '';
  }
  return MATCHED_VIA[key] || key.replace(/_/g, ' ');
}

/**
 * The headline: how much of the board this plan would fill.
 *
 * ⛔ Out of the **configured slots**, not out of the people on the plan. The
 * question an administrator is asking is "will my board be full on Sunday",
 * and a plan with four people on a twelve-slot board answers that very
 * differently from four of four.
 */
export function headline({ slotsMatched, slotCount }) {
  const total = count(slotCount);
  // ⛔ Clamped, because the two numbers come from two reads. The preview
  // resolves against the stored configuration while the total is counted from
  // whatever this page is holding, and a slot removed in between produced
  // **"Every slot would be filled — 11 of 2."** on a running board. A summary
  // that can print an absurdity is worse than one that is a moment stale: a
  // plan cannot fill more slots than exist.
  const filled = Math.min(count(slotsMatched), total);

  if (!total) {
    return 'No slots are configured yet, so there is nothing for a plan to fill.';
  }
  if (!filled) {
    return `Nothing would be filled — none of ${total} ${total === 1 ? 'slot' : 'slots'} matches this plan.`;
  }
  if (filled >= total) {
    return `Every slot would be filled — ${filled} of ${total}.`;
  }
  return `${filled} of ${total} slots would be filled.`;
}

/**
 * One row per position the plan names, in the order the plan gave them.
 *
 * ⭐ Keyed by **position**, not by person: a position can fill several slots
 * (the mic channel and its matching IEM), which is the thing a reader most
 * needs to see working. `pco_mapping.py` states the rule — "Vocal 1 is both the
 * handheld/beltpack receiver channel and the matching PSM1000 IEM channel".
 */
export function filledRows(preview) {
  const details = preview && Array.isArray(preview.assignment_details)
    ? preview.assignment_details
    : [];

  return details.map((entry) => ({
    position: text(entry.position) || text(entry.id) || '—',
    person: text(entry.name),
    team: text(entry.team),
    slots: Array.isArray(entry.slots) ? entry.slots.filter((s) => count(s)) : [],
    via: viaLabel(entry.matched_via),
  })).filter((row) => row.slots.length);
}

/**
 * The people a sync would **not** place, and why as far as it can tell.
 *
 * ⛔ Shown with as much weight as the matches. A worked example that lists only
 * what worked is a demonstration, not evidence — the row that teaches somebody
 * their rule is wrong is always the one that did not match.
 */
export function unmatchedRows(preview) {
  const list = preview && Array.isArray(preview.unmatched) ? preview.unmatched : [];
  return list.map((entry) => {
    const position = text(entry.position);
    return {
      person: text(entry.name) || 'somebody unnamed',
      position,
      // ⚠️ Two different failures that look alike on screen: a person with no
      // position at all, and a position that exists but matches no slot.
      reason: position ? `no slot named ${position}` : 'no position set',
    };
  });
}

/**
 * What a sync would do beyond filling slots — the parts that take something
 * away.
 *
 * ⛔ Conflicts and clears are **warnings, not footnotes**. Removing the wrong
 * name is the one part of a sync that cannot be undone by syncing again
 * ([[pco-slot-assignments]]), and a slot two people both claim is left alone
 * rather than guessed at — which an operator has to know *before* the service,
 * not after.
 */
export function warnings(preview) {
  const out = [];
  const skipped = preview && Array.isArray(preview.skipped) ? preview.skipped : [];
  const clearable = preview && Array.isArray(preview.clearable) ? preview.clearable : [];
  const profileClashes = preview && Array.isArray(preview.profile_conflicts)
    ? preview.profile_conflicts
    : [];

  skipped.forEach((clash) => {
    const names = (clash.claimants || []).filter((n) => text(n));
    out.push({
      kind: 'conflict',
      text: `Slot ${clash.slot} is claimed by ${names.join(' and ') || 'two people'} — it would be left alone, with nobody written.`,
    });
  });

  clearable.forEach((slot) => {
    const name = text(slot.name);
    out.push({
      kind: 'clear',
      text: name
        ? `Slot ${slot.slot} would have ${name} taken off it — this plan does not fill it.`
        : `Slot ${slot.slot} would be cleared — this plan does not fill it.`,
    });
  });

  profileClashes.forEach((clash) => {
    out.push({
      kind: 'rules',
      text: `Service type ${clash.service_type_id} is claimed by ${(clash.profiles || []).join(' and ')} — "${clash.winner}" wins.`,
    });
  });

  return out;
}

/**
 * The whole reckoning, ready to draw.
 *
 * ⚠️ `ok: false` is a first-class answer, not an exception. A plan that has
 * rolled off the schedule, an account that cannot be reached, a board with no
 * plan selected — all of them are ordinary, and the example has to say which
 * one happened rather than rendering an empty table that reads as "nothing
 * would match".
 */
export function workedExample(preview, { slotCount } = {}) {
  if (!preview || typeof preview !== 'object') {
    return { ok: false, error: 'No answer from Planning Center yet.' };
  }
  if (preview.ok === false) {
    return { ok: false, error: text(preview.error) || 'Planning Center could not resolve that plan.' };
  }

  const rows = filledRows(preview);
  const missing = unmatchedRows(preview);

  return {
    ok: true,
    headline: headline({ slotsMatched: preview.slots_matched, slotCount }),
    rows,
    unmatched: missing,
    warnings: warnings(preview),
    // ⚠️ Which rules produced this. Once rule sets exist, "it matched" is not
    // enough -- the reader has to know *whose* rules ran.
    strategy: text(preview.strategy),
    profile: (preview.profile && text(preview.profile.name)) || '',
    planId: text(preview.plan_id),
    people: count(preview.people),
    // ⛔ Said on the face of it, every time.
    note: 'Nothing has been applied — this is what a sync would do.',
  };
}

/**
 * One sentence for the line under the heading, when there is no example yet.
 *
 * ⛔ Never "no matches". A board that has not asked yet and a board whose plan
 * matches nobody are opposite findings, and the empty state has to be the first
 * one.
 */
export const NOT_RUN_YET = 'Check this mapping against the next plan to see which slots it would fill.';
