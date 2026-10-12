/**
 * Reading the sync diff (#120).
 *
 * The server answers "what would happen to each slot"; this decides how a
 * person reads it. ⛔ The old preview table listed the *Planning Center* side
 * -- position, person, team, which slots matched -- which says what the plan
 * contains. What an operator is agreeing to is a change to their board, and
 * the one thing it never showed was who is on each slot right now.
 */

/**
 * ⚠️ Verbs, in the first person of the board. "Replace" rather than "change"
 * because the row already shows both names and the question is what happens to
 * the one that is there.
 */
export const ACTION_LABELS = {
  skipped: 'Left alone',
  change: 'Replace',
  assign: 'Assign',
  clear: 'Clear',
  unchanged: 'Already correct',
};

export const CHANGING = ['skipped', 'change', 'assign', 'clear'];

export const MATCH_LABELS = {
  position: 'team position',
  note: 'note category',
  bracket: '[ID] in name',
};

function rows(changes) {
  return Array.isArray(changes) ? changes.filter((row) => row && typeof row === 'object') : [];
}

export function changedRows(changes) {
  return rows(changes).filter((row) => CHANGING.includes(row.action));
}

export function unchangedRows(changes) {
  return rows(changes).filter((row) => row.action === 'unchanged');
}

export function isNoop(changes) {
  return changedRows(changes).length === 0;
}

/**
 * The one-line answer, before any table.
 *
 * ⭐ "0 updates" beside a table of twelve rows reads like a failure, when it
 * almost always means the board is already right. Say that instead.
 */
export function diffHeadline(changes, { dryRun = true } = {}) {
  const all = rows(changes);
  if (!all.length) {
    return 'Nothing matched — no slot would be touched.';
  }
  const changing = changedRows(all);
  if (!changing.length) {
    const n = all.length;
    return `Nothing to change — ${n} slot${n === 1 ? '' : 's'} already match the plan.`;
  }

  const tally = counts(all);
  const parts = [];
  if (tally.change) parts.push(`${tally.change} replaced`);
  if (tally.assign) parts.push(`${tally.assign} newly assigned`);
  if (tally.clear) parts.push(`${tally.clear} cleared`);
  const verb = dryRun ? 'would change' : 'changed';
  const head = `${changing.length - tally.skipped} slot${
    changing.length - tally.skipped === 1 ? '' : 's'} ${verb}`;

  let text = parts.length ? `${head} — ${parts.join(', ')}` : head;
  if (tally.skipped) {
    // ⛔ Last and separate: it is not one of the changes, it is the sync
    // declining to guess, and it is the only line that needs somebody to act.
    text += `. ${tally.skipped} slot${tally.skipped === 1 ? '' : 's'} left alone (claimed by two people)`;
  }
  if (tally.unchanged) {
    text += `. ${tally.unchanged} already correct`;
  }
  return `${text}.`;
}

export function counts(changes) {
  const tally = {
    skipped: 0, change: 0, assign: 0, clear: 0, unchanged: 0,
  };
  rows(changes).forEach((row) => {
    if (Object.prototype.hasOwnProperty.call(tally, row.action)) {
      tally[row.action] += 1;
    }
  });
  return tally;
}

/** What goes in the "now" and "after" columns. Blank is a word, not an empty cell. */
export function nameCell(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  return name || '—';
}

/**
 * Why this row is happening.
 *
 * ⚠️ A contested slot says who is fighting over it instead, because "matched
 * by team position" is true and useless when the answer is that two people
 * matched the same way.
 */
export function describeRow(row) {
  if (!row || typeof row !== 'object') {
    return '';
  }
  if (row.action === 'skipped') {
    const names = Array.isArray(row.claimants) ? row.claimants.filter(Boolean) : [];
    return names.length ? `${names.join(' and ')} both claim it` : 'claimed by two people';
  }
  if (row.action === 'clear') {
    return 'nobody on this plan matches it';
  }
  const via = MATCH_LABELS[row.matched_via] || row.matched_via || '';
  const position = typeof row.position === 'string' ? row.position.trim() : '';
  if (position && via) return `${position} — matched by ${via}`;
  if (position) return position;
  return via ? `matched by ${via}` : '';
}

/** The class that colours a row, or '' for the quiet ones. */
export function rowClass(action) {
  switch (action) {
    case 'skipped': return 'sync-row-skipped';
    case 'clear': return 'sync-row-clear';
    case 'change': return 'sync-row-change';
    case 'assign': return 'sync-row-assign';
    default: return 'sync-row-unchanged';
  }
}

/**
 * ⭐ Whether to show the rows that are not changing.
 *
 * On a twelve-channel board that synced last week, most rows are "already
 * correct" and they bury the two that matter. They are still worth having --
 * an operator checking the board is right wants to see them -- so they are
 * collapsed rather than dropped, and only when there is something else to look
 * at.
 */
export function shouldFoldUnchanged(changes) {
  const unchanged = unchangedRows(changes);
  return unchanged.length > 0 && changedRows(changes).length > 0;
}

export function foldedLabel(changes) {
  const n = unchangedRows(changes).length;
  // "1 slot that already match" is the sort of thing nobody notices in review
  // and everybody notices on screen.
  return `Show ${n} slot${n === 1 ? ' that already matches' : 's that already match'}`;
}
