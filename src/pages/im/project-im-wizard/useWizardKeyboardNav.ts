/**
 * Wizard-local keyboard nav — one `keydown` listener on the wizard's OWN container (never
 * `document`), so it can never fight `AttributeInput`'s native controls elsewhere on the page.
 *
 * Enter advances to the next question, except while focus is in a `<textarea>` (a note or a
 * multi-line field — Enter must insert a newline there, not advance). Esc closes the wizard,
 * but never calls `preventDefault` first: a native `<select>` uses Esc to close its own open
 * dropdown, and that built-in behavior must not be fought — there is no way to observe a
 * native select's open state from JS, so this is deliberately best-effort (see the wizard
 * plan's note on this).
 *
 * Arrow-key enum cycling (the checkbox multi-select variant of `AttributeInput`) is SKIPPED
 * for Phase 1: every enum question this wizard renders uses the native single-select, which
 * already gets arrow-key cycling for free from the browser. TODO: revisit if a later phase
 * renders the checkbox variant here.
 */
import { RefObject, useEffect } from 'react';

export interface UseWizardKeyboardNavProps {
  containerRef: RefObject<HTMLElement>;
  onAdvance: () => void;
  onEscape: () => void;
  /**
   * False while a keystroke shouldn't be intercepted at all — an image upload in flight, or
   * an expandable note open (see PlaceholderIntakeWizard, which also treats an active image
   * question as "upload may be in flight" since AttributeInput doesn't expose its own
   * upload-in-progress state to the parent, and this file must not modify AttributeInput).
   */
  enabled: boolean;
}

export const useWizardKeyboardNav = ({
  containerRef,
  onAdvance,
  onEscape,
  enabled,
}: UseWizardKeyboardNavProps): void => {
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const inTextarea = active instanceof HTMLTextAreaElement;

      if (e.key === 'Enter' && !inTextarea) {
        e.preventDefault();
        onAdvance();
        return;
      }
      if (e.key === 'Escape') {
        // No preventDefault here — lets a native <select>'s own Esc-closes-dropdown
        // behavior win first, if one happens to be open.
        onEscape();
      }
    };

    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [containerRef, onAdvance, onEscape, enabled]);
};
