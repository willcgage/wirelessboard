/**
 * Telling somebody why a locked board ignored them (#116).
 *
 * ⭐ A board that silently does nothing reads as a broken board, and somebody
 * will go looking for the fault during a service. The menu items are hidden
 * when locked, so this is mostly for a key press — but the key is exactly what
 * a passing volunteer with a laptop would try.
 */

import { refusalNote } from './viewer-lock.mjs';

const TOAST_ID = 'viewer-lock-toast';
const SHOWN_FOR_MS = 4000;
let timer = null;

export function showLockRefusal(action) {
  const text = refusalNote(action);
  if (!text || typeof document === 'undefined' || !document.body) {
    return null;
  }

  let toast = document.getElementById(TOAST_ID);
  if (!toast) {
    toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.className = 'viewer-lock-toast';
    // ⚠️ `status`, not `alert`: nothing has gone wrong, and an alert role
    // interrupts a screen reader mid-sentence to say so.
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
  }
  toast.textContent = text;

  // Pressing the key twice should re-start the four seconds, not stack timers.
  if (timer) {
    clearTimeout(timer);
  }
  timer = setTimeout(() => {
    timer = null;
    if (toast.parentElement) {
      toast.parentElement.removeChild(toast);
    }
  }, SHOWN_FOR_MS);
  return toast;
}
