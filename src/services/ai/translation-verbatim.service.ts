/**
 * Translation verbatims — CRUD over the `translation_verbatims` table:
 * regulation phrases with OFFICIAL per-language wording. `phrase` is the
 * English text to match; `translations` maps language code -> the approved
 * wording for that language's output. translation.service.ts freezes matches
 * into opaque {{FRZ_n}} tokens before the text reaches the model and thaws
 * them back as the stored translation, so the model never touches them.
 * Managed from the Admin panel's "AI Prompts" area; any signed-in user can
 * add entries as they find phrases worth protecting.
 */

import { supabase } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { TranslationVerbatim } from '../../types';
import { runMutation } from '../core/db';

const mapRow = (row: any): TranslationVerbatim => ({
  id: row.id,
  phrase: row.phrase,
  note: row.note ?? undefined,
  translations: row.translations ?? {},
  createdBy: row.created_by ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const getTranslationVerbatims = async (): Promise<TranslationVerbatim[]> => {
  if (!isLive) return [];
  const { data, error } = await supabase.from('translation_verbatims').select('*').order('phrase');
  if (error) {
    console.error('[translation-verbatim] getTranslationVerbatims failed:', error.message);
    return [];
  }
  return (data || []).map(mapRow);
};

export const createTranslationVerbatim = async (
  entry: { phrase: string; note?: string; translations?: Record<string, string> },
  createdBy?: string,
): Promise<void> => {
  await runMutation(
    supabase.from('translation_verbatims').insert({
      phrase: entry.phrase,
      note: entry.note || null,
      translations: entry.translations ?? {},
      ...(createdBy !== undefined && { created_by: createdBy }),
    }),
    'createTranslationVerbatim',
  );
};

export const updateTranslationVerbatim = async (
  id: string,
  updates: { phrase?: string; note?: string; translations?: Record<string, string> },
): Promise<void> => {
  await runMutation(
    supabase
      .from('translation_verbatims')
      .update({
        ...(updates.phrase !== undefined && { phrase: updates.phrase }),
        ...(updates.note !== undefined && { note: updates.note || null }),
        ...(updates.translations !== undefined && { translations: updates.translations }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id),
    'updateTranslationVerbatim',
  );
};

export const deleteTranslationVerbatim = async (id: string): Promise<void> => {
  await runMutation(
    supabase.from('translation_verbatims').delete().eq('id', id),
    'deleteTranslationVerbatim',
  );
};
