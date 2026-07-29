/**
 * Prompt library — CRUD over the `prompt_library` table, a shared collection of
 * predefined prompts users maintain in the Admin panel's "AI Prompts" area.
 * Unlike ai_prompts (system prompts consumed by server-side Claude calls), the
 * app never executes these: they exist to be copied (or opened via claude.ai)
 * and used directly in Claude chat outside the app.
 */

import { db, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { PromptLibraryEntry } from '../../types';

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
  const rows = await orEmpty(
    db.select<Row>('prompt_library', { order: { column: 'title' } }),
    '[prompt-library] getPromptLibrary',
  );
  return rows.map(mapRow);
};

export const createPromptLibraryEntry = async (
  entry: { title: string; description?: string; promptText: string },
  createdBy?: string,
): Promise<void> => {
  await db.insertMany('prompt_library', [{
    title: entry.title,
    description: entry.description || null,
    prompt_text: entry.promptText,
    ...(createdBy !== undefined && { created_by: createdBy }),
  }]);
};

export const updatePromptLibraryEntry = async (
  id: string,
  updates: { title?: string; description?: string; promptText?: string },
): Promise<void> => {
  await db.updateWhere(
    'prompt_library',
    {
      ...(updates.title !== undefined && { title: updates.title }),
      ...(updates.description !== undefined && { description: updates.description || null }),
      ...(updates.promptText !== undefined && { prompt_text: updates.promptText }),
      updated_at: new Date().toISOString(),
    },
    { where: { id } },
  );
};

export const deletePromptLibraryEntry = async (id: string): Promise<void> => {
  await db.delete('prompt_library', { where: { id } });
};
