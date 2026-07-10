/**
 * AI prompt management — CRUD over the `ai_prompts` table, which stores the
 * system prompts used by server-side Anthropic/Claude calls (e.g. the IM
 * translation proxy, netlify/functions/translate.ts) so admins can view and
 * edit them without a code deploy. RLS restricts writes to admins; this
 * service is only wired into the Admin panel.
 */

import { supabase } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { AIPrompt } from '../../types';
import { runMutation } from '../core/db';

const mapRow = (row: any): AIPrompt => ({
  id: row.id,
  key: row.key,
  name: row.name,
  description: row.description ?? undefined,
  systemPrompt: row.system_prompt,
  model: row.model,
  maxTokens: row.max_tokens,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  updatedBy: row.updated_by ?? undefined,
});

export const getAIPrompts = async (): Promise<AIPrompt[]> => {
  if (!isLive) return [];
  const { data, error } = await supabase.from('ai_prompts').select('*').order('name');
  if (error) return [];
  return (data || []).map(mapRow);
};

export const updateAIPrompt = async (
  id: string,
  updates: { systemPrompt?: string; model?: string; maxTokens?: number },
  updatedBy?: string
): Promise<void> => {
  await runMutation(
    supabase
      .from('ai_prompts')
      .update({
        ...(updates.systemPrompt !== undefined && { system_prompt: updates.systemPrompt }),
        ...(updates.model !== undefined && { model: updates.model }),
        ...(updates.maxTokens !== undefined && { max_tokens: updates.maxTokens }),
        updated_at: new Date().toISOString(),
        ...(updatedBy !== undefined && { updated_by: updatedBy }),
      })
      .eq('id', id),
    'updateAIPrompt'
  );
};
