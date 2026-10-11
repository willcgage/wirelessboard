/**
 * Which settings change this screen, and which change every board (#116).
 *
 * The split already exists and nothing says so. View preferences are per
 * device — the panel writes them to this browser's storage and no other board
 * notices. Configuration, groups, slot names and PCO are server-side: saving
 * one changes the board on the wall, the laptop at FOH and the phone in
 * somebody's pocket, all at once.
 *
 * ⛔ The sharp edge is the cost of a configuration save. `reconfig` tears down
 * every receiver socket, sleeps ~2 seconds and rebuilds, so a well-meant save
 * from a phone briefly blanks the wall mid-service — and nobody holding the
 * phone has any idea that is what they did. Naming the cost is the whole point
 * of these strings: a vague "are you sure?" teaches nobody anything.
 */

/** Connected boards, from the payload. Absent means we were not told. */
export function viewerCount(data) {
  const raw = data && typeof data === 'object' ? data.viewers : undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return Math.floor(n);
}

/**
 * What to show beside a control that changes everyone's board.
 *
 * ⚠️ Counts boards, not people: two tabs on one laptop are two boards, and
 * saying "2 people" would be a guess. Null when the server has not said, so a
 * caller can leave the line out rather than print "0 boards".
 */
export function presenceLabel(count) {
  if (count === null || count === undefined) {
    return null;
  }
  if (count <= 1) {
    return 'This board only';
  }
  return `${count} boards connected`;
}

/**
 * The confirmation for a change that reaches every board, or null when it does
 * not need one.
 *
 * ⭐ Only asks when somebody else is actually watching. A single-operator
 * board, which is most of them, is never nagged — a prompt that always appears
 * is a prompt everyone learns to dismiss without reading.
 */
export function globalChangeWarning(count, { receivers = false } = {}) {
  if (count === null || count === undefined || count <= 1) {
    return null;
  }
  const others = count - 1;
  const boards = others === 1 ? '1 other board' : `${others} other boards`;

  if (receivers) {
    return `This will reload ${boards} and briefly disconnect the receivers. Continue?`;
  }
  return `This will change what ${boards} ${others === 1 ? 'is' : 'are'} showing. Continue?`;
}

/** The sentence that labels a whole pane. */
export function scopeNote(scope, count) {
  if (scope === 'device') {
    return 'These settings change this device only.';
  }
  const presence = presenceLabel(count);
  const base = 'Changes here affect every connected board.';
  return presence && count > 1 ? `${base} ${presence}.` : base;
}
