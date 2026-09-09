/**
 * Roadmap Creator — per-browser view preferences.
 *
 * Everything this module owns lives in SQL. The one thing that does not is presentation mode,
 * because it is a property of the SCREEN, not of the plan: it should not follow you to a
 * colleague's browser, and it carries no data anyone could lose.
 *
 * It is PERSISTED rather than held in React state for one specific reason. Presentation mode
 * exists to keep our economics off a projector during a supplier meeting; if a stray reload
 * mid-meeting reset it to "showing", the numbers would be back on screen before anyone could
 * react. Persisting makes the safe state the sticky one.
 */

const KEY = 'rdmp_hide_metrics';

/**
 * True when this browser last left presentation mode on. Storage being unavailable (private
 * mode, blocked cookies) reads as "off" — the same default a first-time visitor gets.
 */
export function readHideMetrics(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Best-effort persist. A failure here costs a preference, never a render. */
export function writeHideMetrics(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked — the toggle still works for this session */
  }
}
