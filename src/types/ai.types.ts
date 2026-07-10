/**
 * AI prompt types — prompts used for Anthropic/Claude calls, stored in the
 * `ai_prompts` table so they can be viewed/edited from the Admin panel.
 */

export interface AIPrompt {
  id: string;
  key: string;
  name: string;
  description?: string;
  systemPrompt: string;
  model: string;
  maxTokens: number;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
}
