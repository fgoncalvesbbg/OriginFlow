/**
 * Regulation notes as bullet points.
 *
 * `regulations.notes` stays a plain TEXT column — one bullet per line — rather than
 * gaining a jsonb array. Notes are already written and read as prose in three places (the
 * library card, the editor textarea, and the `{{regulationNotes}}` slot in the regulatory
 * check's system prompt), and newline-separated text needs no migration, keeps every note
 * written before this existed readable, and reaches the model as something it can follow.
 *
 * Leading `-`, `*` and `•` markers are stripped so a list pasted from Markdown does not
 * render as "• - text". Numeric prefixes are deliberately LEFT ALONE: stripping them would
 * silently renumber a deliberately ordered list, and "• 1. First" is merely ugly where
 * losing the ordering is wrong. A marker must be followed by whitespace to count, so a
 * note opening with a negative value ("-20°C minimum") keeps its sign.
 */

/** Split notes into display lines, one per bullet. Blank lines are dropped. */
export const parseRegulationNotes = (notes?: string | null): string[] =>
  (notes ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s+/, '').trim())
    .filter((line) => line !== '');
