/**
 * Turning the keybinding table into the rows the help overlay lists.
 *
 * The overlay used to be hand-written markup in demo.html while the bindings
 * lived in kbd.js, and the two had drifted: T -- the display-mode toggle, the
 * main view control on the board -- and D were bound and undocumented. Same
 * shape of fault as two modules deriving a media filename separately and
 * disagreeing (#57); the fix is the same, which is to have one source and
 * derive the other from it.
 *
 * These helpers are pure so they can be tested without a DOM or the app
 * modules the table's handlers pull in.
 */

/**
 * The chips shown for a binding. `label` exists for the cases where the keys
 * that fire a binding are not what you want to read: the ten group keys are
 * one idea, not ten, and `N` is typed as Shift+N.
 */
export function bindingKeys(binding) {
  if (!binding) {
    return [];
  }
  if (Array.isArray(binding.label)) {
    return binding.label;
  }
  return Array.isArray(binding.keys) ? binding.keys.map(keyCap) : [];
}

/**
 * A key as it is printed on the keyboard rather than as the browser reports
 * it. `t` fires on the lowercase event key, but the cap says T, and the
 * overlay has always shown them that way.
 *
 * Only single letters. `?`, `0` and `Escape` are already what you would read,
 * and uppercasing a word would give "ESCAPE".
 */
export function keyCap(key) {
  if (typeof key !== 'string' || key.length !== 1) {
    return key;
  }
  return key.toUpperCase();
}

/**
 * Every binding that carries a description, in table order.
 *
 * A binding with no `hud` is deliberately undocumented rather than
 * accidentally so -- the numeric keys are covered by a single row, so the
 * other nine say nothing rather than repeating it.
 */
export function hudRows(bindings) {
  if (!Array.isArray(bindings)) {
    return [];
  }
  return bindings
    .filter((b) => b && typeof b.hud === 'string' && b.hud.length > 0)
    .map((b) => ({ keys: bindingKeys(b), description: b.hud }));
}

/**
 * The binding a key event should run, or null.
 *
 * Case matters: `n` and `N` are different bindings, and the board relies on
 * that to tell "edit slots" from "edit slots and open the paste box".
 */
export function findBinding(bindings, key) {
  if (!Array.isArray(bindings) || typeof key !== 'string') {
    return null;
  }
  return bindings.find((b) => b && Array.isArray(b.keys) && b.keys.includes(key)) || null;
}

/**
 * Which keys are bound but undocumented. Nothing calls this in the running
 * board; it states the invariant the table is meant to hold so a test can
 * check it, which is what would have caught T and D going missing.
 */
export function undocumentedKeys(bindings) {
  if (!Array.isArray(bindings)) {
    return [];
  }
  const documented = new Set();
  bindings.forEach((b) => {
    if (b && typeof b.hud === 'string' && b.hud.length > 0) {
      (Array.isArray(b.keys) ? b.keys : []).forEach((k) => documented.add(k));
    }
  });
  const all = [];
  bindings.forEach((b) => {
    (b && Array.isArray(b.keys) ? b.keys : []).forEach((k) => {
      if (!documented.has(k) && !all.includes(k)) {
        all.push(k);
      }
    });
  });
  return all;
}
