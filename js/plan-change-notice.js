/**
 * The bar that says the plan on the board has changed (#140).
 *
 * ⛔ Kept out of `data.js` because that module runs on every payload, several
 * times a second. Everything here is guarded so a re-render only happens when
 * the notice itself changes — otherwise a button somebody is reaching for
 * moves under their hand during a service.
 */

import {
  shouldNotify, noticeText, watchProblem, checkedAgo, noticeKey, noticeTone,
} from './plan-change.mjs';

const BAR_ID = 'plan-change-bar';
let renderedKey = null;

function removeBar() {
  const existing = document.getElementById(BAR_ID);
  if (existing && existing.parentElement) {
    existing.parentElement.removeChild(existing);
  }
  // The gear goes back to the corner it shares with the bar.
  document.body.classList.remove('plan-change-shown');
  document.documentElement.style.removeProperty('--plan-change-height');
  renderedKey = null;
}

/**
 * Show, update or remove the notice.
 *
 * ⚠️ Does nothing at all when there is no document — the payload handler also
 * runs under tests and in the Electron main window before the board exists.
 */
export function renderPlanChangeNotice(planChange) {
  if (typeof document === 'undefined' || !document.body) {
    return;
  }

  if (!shouldNotify(planChange)) {
    removeBar();
    return;
  }

  const key = noticeKey(planChange);
  let bar = document.getElementById(BAR_ID);

  if (bar && renderedKey === key) {
    // Same notice as last time. Only the "checked N minutes ago" line can
    // have moved on, so that is all that is rewritten.
    const age = bar.querySelector('.plan-change-age');
    if (age) age.textContent = ageLine(planChange);
    liftCornerGear(bar);
    return;
  }

  if (!bar) {
    bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.className = 'plan-change-bar';
    bar.setAttribute('role', 'status');
    document.body.appendChild(bar);
  }
  // ⚠️ Lifts the corner gear clear of the bar. It is the only way back to the
  // top bar on a touch display (#110), so covering it would strand somebody.
  document.body.classList.add('plan-change-shown');

  // ⚠️ Three tones, not two. A board that synced itself cleanly is reassuring
  // and must not wear the amber that means "what you are looking at is stale",
  // or the colour stops carrying any meaning at all (#140).
  const tone = noticeTone(planChange);
  bar.className = `plan-change-bar plan-change-${tone}`;

  bar.innerHTML = '';

  const message = document.createElement('span');
  message.className = 'plan-change-message';
  message.textContent = noticeText(planChange);
  bar.appendChild(message);

  const age = document.createElement('span');
  age.className = 'plan-change-age';
  age.textContent = ageLine(planChange);
  bar.appendChild(age);

  // ⛔ Opens the panel; it does not sync. A sync writes config.json and, with
  // "clear slots this plan does not fill" on, takes people off the board. That
  // is not something a notice does on a single press during a service.
  const action = document.createElement('a');
  action.className = 'plan-change-action';
  action.href = '#pco=true';
  // ⭐ The board has already synced itself here, so "re-sync" would be wrong:
  // what is left is a person looking at what it did.
  action.textContent = tone === 'stale' ? 'Review and re-sync' : 'Open Planning Center';
  bar.appendChild(action);

  renderedKey = key;
  liftCornerGear(bar);
}

/**
 * Tell the stylesheet how tall the bar actually is.
 *
 * ⛔ Measured rather than assumed. The message wraps to two or three lines at
 * phone width and at the narrow column counts this board is used at, so a
 * fixed offset puts the corner gear on top of the text exactly when there is
 * most of it. Read after the bar is in the document, so the height is real.
 */
function liftCornerGear(bar) {
  try {
    const height = Math.round(bar.getBoundingClientRect().height);
    if (height > 0) {
      document.documentElement.style.setProperty('--plan-change-height', `${height}px`);
    }
  } catch (e) {
    // A board that cannot measure still shows the bar; the gear keeps the
    // stylesheet's fallback offset.
  }
}

function ageLine(planChange) {
  const problem = watchProblem(planChange);
  if (problem) {
    return problem;
  }
  return checkedAgo(planChange) || '';
}
