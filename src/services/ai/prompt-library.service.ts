/**
 * Prompt library — CRUD over the `prompt_library` table, a shared collection of
 * predefined prompts users maintain in the Admin panel's "AI Prompts" area.
 * Unlike ai_prompts (system prompts consumed by server-side Claude calls), the
 * app never executes these: they exist to be copied (or opened via claude.ai)
 * and used directly in Claude chat outside the app.
 */

import { supabase } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { PromptLibraryEntry } from '../../types';
import { runMutation } from '../core/db';

const mapRow = (row: any): PromptLibraryEntry => ({
  id: row.id,
  title: row.title,
  description: row.description ?? undefined,
  promptText: row.prompt_text,
  createdBy: row.created_by ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const getPromptLibrary = async (): Promise<PromptLibraryEntry[]> => {
  if (!isLive) return [];
  const { data, error } = await supabase.from('prompt_library').select('*').order('title');
  if (error) {
    console.error('[prompt-library] getPromptLibrary failed:', error.message);
    return [];
  }
  return (data || []).map(mapRow);
};

export const createPromptLibraryEntry = async (
  entry: { title: string; description?: string; promptText: string },
  createdBy?: string,
): Promise<void> => {
  await runMutation(
    supabase.from('prompt_library').insert({
      title: entry.title,
      description: entry.description || null,
      prompt_text: entry.promptText,
      ...(createdBy !== undefined && { created_by: createdBy }),
    }),
    'createPromptLibraryEntry',
  );
};

export const updatePromptLibraryEntry = async (
  id: string,
  updates: { title?: string; description?: string; promptText?: string },
): Promise<void> => {
  await runMutation(
    supabase
      .from('prompt_library')
      .update({
        ...(updates.title !== undefined && { title: updates.title }),
        ...(updates.description !== undefined && { description: updates.description || null }),
        ...(updates.promptText !== undefined && { prompt_text: updates.promptText }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id),
    'updatePromptLibraryEntry',
  );
};

export const deletePromptLibraryEntry = async (id: string): Promise<void> => {
  await runMutation(
    supabase.from('prompt_library').delete().eq('id', id),
    'deletePromptLibraryEntry',
  );
};
