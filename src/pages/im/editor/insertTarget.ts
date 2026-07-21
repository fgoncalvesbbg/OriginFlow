/**
 * Insert-target registry for the IM inline editors.
 *
 * Toolbar buttons, the placeholder/condition modals, and the Assets panels all need to
 * insert HTML into "the editor the user is currently working in". Because several inline
 * editors (one per language row) are mounted at once, the target is whichever editor most
 * recently gained focus — it registers itself here on focus and unregisters on unmount.
 *
 * This replaces the previous `window.currentEditorInsertHtml` / `currentEditorCommitPlaceholder`
 * globals: same last-focused-wins semantics, but a typed, importable, test-friendly module
 * singleton instead of polluting the global namespace.
 */

type InsertFn = (html: string) => void;

let insertHtmlFn: InsertFn | undefined;
let commitPlaceholderFn: InsertFn | undefined;

/** Point the caret-insert target at the given editor (called on focus). */
export const setInsertTarget = (fn: InsertFn | undefined) => { insertHtmlFn = fn; };

/** Clear the target only if `fn` is still the active one (unmount-safe). */
export const clearInsertTarget = (fn: InsertFn) => { if (insertHtmlFn === fn) insertHtmlFn = undefined; };

/** Insert HTML at the caret of the active editor, if any. Returns false when none is registered. */
export const insertToActiveEditor = (html: string): boolean => {
  if (!insertHtmlFn) return false;
  insertHtmlFn(html);
  return true;
};

/** Whether an editor is currently registered as the insert target. */
export const hasInsertTarget = () => !!insertHtmlFn;

/** Point the placeholder fan-out (all-languages) commit at the active row. */
export const setCommitPlaceholderTarget = (fn: InsertFn | undefined) => { commitPlaceholderFn = fn; };

/** Clear the commit target only if `fn` is still the active one (unmount-safe). */
export const clearCommitPlaceholderTarget = (fn: InsertFn) => { if (commitPlaceholderFn === fn) commitPlaceholderFn = undefined; };

/**
 * Commit a placeholder chip. Prefers the row-aware fan-out (shares the chip across all
 * languages); falls back to a plain caret insert when no row registered one.
 */
export const commitPlaceholder = (html: string) => {
  if (commitPlaceholderFn) commitPlaceholderFn(html);
  else insertToActiveEditor(html);
};
