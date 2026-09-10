/**
 * TCF questions — the library's own set, used to gate conditional requirements
 * (migration 174).
 *
 * These replaced `category_attributes` as the target of a requirement's condition. The reason
 * is written out in the migration header and worth the one line here: attributes are PIM data
 * with their own lifecycle, all 172 of them were deleted in Aug 2026, and every conditional
 * requirement silently stopped applying. A question the compliance library owns cannot vanish
 * underneath it.
 *
 * Library-global, so there is no category argument anywhere in this file.
 */

import { db, orEmpty, mustRead, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import type { ComplianceQuestion, TcfQuestionDataType } from '../../types';

const fromRow = (q: Row): ComplianceQuestion => ({
    id: q.id,
    label: q.label,
    helpText: q.help_text ?? null,
    dataType: (q.data_type ?? 'boolean') as TcfQuestionDataType,
    options: Array.isArray(q.options) ? q.options : [],
    unit: q.unit ?? null,
    group: q.group_name ?? null,
    sortOrder: q.sort_order ?? 0,
    needsReview: q.needs_review === true,
    createdAt: q.created_at,
    createdBy: q.created_by ?? null,
});

const order = [
    { column: 'sort_order', ascending: true },
    { column: 'created_at', ascending: true },
] as const;

/** Every question, in author order. Degrades to [] — display callers only. */
export const getComplianceQuestions = async (): Promise<ComplianceQuestion[]> => {
    if (!isLive) return [];
    const rows = await orEmpty(
        db.select<Row>('compliance_questions', { order: [...order] }),
        'getComplianceQuestions',
    );
    return rows.map(fromRow);
};

/**
 * The same read, non-degrading. Use it ANYWHERE the result decides which requirements a
 * supplier is asked for.
 *
 * `getComplianceQuestions` degrades a failed read to `[]`, which is right for a picker and
 * dangerous here: with no questions, every conditional requirement resolves as
 * `question-missing`. That direction is safe by design (it over-asks and flags) but it would
 * turn a transient network blip into a request full of spurious obligations, so the wizard
 * fails loudly instead.
 */
export const getComplianceQuestionsOrThrow = async (): Promise<ComplianceQuestion[]> => {
    if (!isLive) return [];
    const rows = await mustRead(
        db.select<Row>('compliance_questions', { order: [...order] }),
        'getComplianceQuestionsOrThrow',
    );
    return rows.map(fromRow);
};

/**
 * Create or update a question.
 *
 * Saving always clears `needs_review`: the only rows that carry it are the ones migration 174
 * rescued from dangling attribute conditions, and the act of opening one and writing what it
 * should ask IS the review. Leaving the flag set after an edit would mean the operator fixes
 * the wording and the requirement stays flagged forever.
 *
 * The database holds a case-insensitive unique index on the label — one question per thing
 * worth asking is the point of the feature — so a duplicate is rejected there. The message is
 * translated here because "compliance_questions_label_key" is not an answer.
 */
export const saveComplianceQuestion = async (question: ComplianceQuestion): Promise<void> => {
    const payload: Row = {
        id: question.id,
        label: question.label.trim(),
        help_text: question.helpText?.trim() || null,
        data_type: question.dataType,
        // Only an enum has choices. Storing them for the other types would let a type change
        // silently resurrect options the author had abandoned.
        options: question.dataType === 'enum'
            ? question.options.map(o => o.trim()).filter(Boolean)
            : [],
        unit: question.dataType === 'number' ? (question.unit?.trim() || null) : null,
        group_name: question.group?.trim() || null,
        sort_order: question.sortOrder ?? 0,
        needs_review: false,
    };
    try {
        await db.upsert('compliance_questions', payload);
    } catch (err: any) {
        if (String(err?.message ?? '').includes('compliance_questions_label_key')) {
            throw new Error(`A question worded "${payload.label}" already exists — use that one instead of adding a second.`);
        }
        throw err;
    }
};

/**
 * Delete a question.
 *
 * Deliberately NOT guarded against being in use. The caller checks usage and warns, because
 * the safe outcome is already guaranteed by the evaluator: a requirement whose question has
 * gone resolves as `question-missing`, which INCLUDES it and flags it. Deleting a question can
 * therefore over-ask, and can never silently stop asking — so refusing the delete would be
 * protecting against the harmless direction while making the library hard to tidy.
 */
export const deleteComplianceQuestion = async (id: string): Promise<void> => {
    await db.delete('compliance_questions', { where: { id } });
};
