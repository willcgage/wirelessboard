/**
 * Whether this screen pages through its groups (#113).
 *
 * ⛔ Its own tiny module so `view-controls.mjs` does not have to import the
 * rotation driver, which reaches the DOM and `app.js`. The view table is loaded
 * by the help overlay and by tests that have neither.
 */
export const ROTATION_STATES = ['off', 'on'];
export const ROTATION_LABELS = { off: 'Off', on: 'On' };
