/**
 * Server-side AI regulatory check (Netlify Function).
 *
 * Audits ONE chunk of ONE English IM template against ONE regulation assigned to that
 * template, and returns structured findings. The client (src/services/regulatory/
 * regulatory-check.service.ts) posts one (regulation × chunk) unit per request and
 * assembles the run report.
 *
 * Why one unit per invocation rather than "the whole template against everything":
 * per-regulation is needed so every finding can be attributed and so a partial run is
 * meaningful ("2 of 3 regulations came back"); per-chunk is needed because a 40-section
 * template plus a 40 kB regulation summary will not reliably finish inside Netlify's
 * ~26 s synchronous ceiling. Same shape as render-print-part being called once per part.
 *
 * THE REGULATION IS READ HERE, NOT SENT BY THE BROWSER. The service-role client looks
 * up the `im_template_regulations` row for (templateId, regulationId) and joins the
 * library row. That keeps a 400 kB summary off the wire on every chunk, gives the
 * summary and the scope note exactly one source of truth, and — the security point —
 * turns "is this regulation actually assigned to this template?" into a server-side
 * authorization check. Unlike translate.ts, this endpoint cannot be handed arbitrary
 * text to send to the model.
 *
 * The system prompt is loaded from `ai_prompts` (key = 'im_regulatory_check') so admins
 * can tune the judgement rules without a deploy; a hardcoded fallback covers a missing
 * row. The RESPONSE SHAPE is enforced by a JSON schema (output_config.format), not by
 * prompt text, so rewording the prompt cannot break parsing.
 *
 * Request body:  { templateId, regulationId, document, chunkIndex, chunkCount }
 * Response body: { regulationId, chunkIndex, findings[], verbatims[], notes, model, truncated }
 *                | { error: string }
 *
 * Auth: requires a valid Supabase session (Authorization: Bearer <access_token>).
 * The model is pinned server-side (ai_prompts config or DEFAULT_MODEL) and is NEVER
 * taken from the request, so the endpoint cannot be used as an open LLM relay.
 *
 * Server-only env (set in Netlify, NOT VITE_-prefixed):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   — service role, so the prompt/regulation lookups bypass RLS
 *   ANTHROPIC_API_KEY
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

interface NetlifyEvent {
  httpMethod: string;
  body: string | null;
  headers?: Record<string, string | undefined>;
}

const PROMPT_KEY = 'im_regulatory_check';
const DEFAULT_MODEL = 'claude-opus-5';
const DEFAULT_MAX_TOKENS = 8000;

/**
 * Fallback prompt, kept byte-identical to the seed in
 * db_migrations/115_create_regulation_library.sql. Same belt-and-braces arrangement as
 * translate.ts: the row is the editable source of truth, this is what runs if it is gone.
 */
const FALLBACK_SYSTEM_TEMPLATE = [
  'You are a regulatory compliance reviewer for consumer-appliance instruction manuals.',
  'You are auditing ONE English-language manual template against ONE regulation.',
  '',
  'REGULATION',
  '  Reference:    {{regulationReference}}',
  '  Title:        {{regulationTitle}}',
  '  Jurisdiction: {{jurisdiction}}',
  '  Library note: {{regulationNotes}}',
  '  Scope for this template: {{assignmentNotes}}',
  '',
  'TEMPLATE',
  '  {{templateName}} ({{templateType}}) -- {{chunkInfo}}',
  '',
  'The first message contains the Markdown summary of the regulation. The second contains ' +
  'the template as JSON: sections with `sectionId`, `path`, `title`, and blocks with `refId` and `text`.',
  '',
  'Rules:',
  '1. Judge ONLY against the regulation summary supplied. Do not invoke other regulations, ' +
  'house style, or general good practice. If the summary does not state a requirement, it is not a finding.',
  '2. {{like_this}} in template text is a placeholder filled per product at publish time. ' +
  'Treat it as "a value will be present" -- never report one as missing or wrong content.',
  '3. Blocks marked conditional render only for products with a given feature; blocks marked ' +
  'optional are opted into per product. Never report these as missing. If a requirement depends ' +
  'on one, say so in `issue`.',
  '4. You are reviewing a TEMPLATE, not a finished manual. Product-specific values, model ' +
  'numbers, and images are absent by design.',
  '5. {{chunkInfo}} tells you whether you are seeing the whole template or one part of it. ' +
  'When you are seeing a part, do NOT report a requirement as missing merely because it is ' +
  'absent here -- report it only if this part is where it clearly belongs, and say so.',
  '6. Anchor every finding to the narrowest identifier available: `refId` when the problem is ' +
  'inside one block, otherwise `sectionId`. Use an empty string only when it belongs nowhere in this part.',
  '7. `quote` must be copied VERBATIM from the template text -- never paraphrased, corrected, ' +
  'or reflowed. Maximum 300 characters.',
  '8. `verbatims` is ONLY for wording the regulation requires to appear WORD-FOR-WORD ' +
  '(prescribed warnings, mandated statements, mandated label text). Copy `phrase` VERBATIM from ' +
  'the template text. Set `exactness` to "exact" when the template already carries the mandated ' +
  'wording; set it to "near" when the wording in the template is close to but not identical with ' +
  'what the regulation prescribes -- in that case `phrase` is still the CURRENT wording of the ' +
  'template. Never invent, translate, or normalize a phrase. Do not list a phrase merely because ' +
  'it is important; only because the words themselves are mandated.',
  '9. Severity: "critical" = non-compliant as it stands; "major" = a required element is missing ' +
  'or materially wrong; "minor" = compliant but imprecise or badly placed; "info" = an observation ' +
  'requiring no change.',
  '10. Report nothing you are not confident about. An empty findings array is a valid and useful ' +
  'answer. Do not pad the list to look thorough.',
].join('\n');

/**
 * Response schema. Every property is required and "unknown" is the empty string rather
 * than null or an omitted key: optional properties and nullable unions are the parts of
 * JSON Schema most likely to be constrained under structured outputs, and the client
 * normalizes '' back to undefined at its boundary.
 */
const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings', 'verbatims', 'notes'],
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'kind', 'sectionId', 'refId', 'clause', 'requirement', 'issue', 'suggestedChange', 'quote'],
        properties: {
          severity: { type: 'string', enum: ['critical', 'major', 'minor', 'info'] },
          kind: { type: 'string', enum: ['missing', 'incorrect', 'placement', 'wording', 'excess'] },
          sectionId: { type: 'string', description: 'A sectionId from the template JSON, or "" if not attributable.' },
          refId: { type: 'string', description: 'A block refId from the template JSON, or "" for a section-level finding.' },
          clause: { type: 'string', description: 'The clause/article/annex of the regulation, or "".' },
          requirement: { type: 'string', description: 'What the regulation requires, in one sentence.' },
          issue: { type: 'string', description: 'How the template fails to meet it.' },
          suggestedChange: { type: 'string', description: 'The concrete edit that would satisfy the requirement.' },
          quote: { type: 'string', description: 'Up to 300 characters copied verbatim from the template text, or "".' },
        },
      },
    },
    verbatims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['phrase', 'clause', 'rationale', 'sectionId', 'refId', 'exactness'],
        properties: {
          phrase: { type: 'string', description: 'The current template wording, copied verbatim.' },
          clause: { type: 'string' },
          rationale: { type: 'string', description: 'Why this wording is mandated word-for-word.' },
          sectionId: { type: 'string' },
          refId: { type: 'string' },
          exactness: { type: 'string', enum: ['exact', 'near'] },
        },
      },
    },
    notes: { type: 'string', description: 'Observations about this regulation that are not findings. May be "".' },
  },
} as const;

const json = (statusCode: number, payload: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

/** Render the chunk descriptor the prompt's rule 5 refers to. */
const describeChunk = (doc: any, index: number, count: number): string => {
  if (!count || count <= 1) return 'the complete template';
  const sections = Array.isArray(doc?.sections) ? doc.sections : [];
  const first = sections[0]?.path ?? '?';
  const last = sections[sections.length - 1]?.path ?? first;
  return `part ${index + 1} of ${count} of the template (sections ${first}-${last})`;
};

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json(500, { error: 'ANTHROPIC_API_KEY is not configured on the server.' });
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { error: 'Server is not configured for the regulatory check.' });
  }

  // This endpoint spends Anthropic credits, so it must never be callable anonymously.
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const token = (event.headers?.authorization || event.headers?.Authorization || '')
    .replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Authentication required.' });
  const { data: userData, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !userData?.user) return json(401, { error: 'Invalid or expired session.' });

  let templateId: string;
  let regulationId: string;
  let document: any;
  let chunkIndex: number;
  let chunkCount: number;
  try {
    ({ templateId, regulationId, document, chunkIndex, chunkCount } = JSON.parse(event.body || '{}'));
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }
  if (!templateId || !regulationId || !document || !Array.isArray(document.sections)) {
    return json(400, {
      error: 'Request must include "templateId", "regulationId" and a "document" with a sections array.',
    });
  }
  const index = Number.isFinite(chunkIndex) ? Number(chunkIndex) : 0;
  const count = Number.isFinite(chunkCount) ? Number(chunkCount) : 1;

  // Authorization: the regulation must actually be assigned to this template. This is
  // also what supplies the summary and the per-template scope note.
  const { data: assignment, error: assignErr } = await admin
    .from('im_template_regulations')
    .select('notes, regulation_id')
    .eq('template_id', templateId)
    .eq('regulation_id', regulationId)
    .maybeSingle();
  if (assignErr) {
    console.error('[regulatory-check] assignment lookup failed', assignErr);
    return json(500, { error: 'Could not verify the regulation assignment.' });
  }
  if (!assignment) {
    return json(403, { error: 'That regulation is not assigned to this template.' });
  }

  const { data: regulation, error: regErr } = await admin
    .from('regulations')
    .select('title, reference_code, jurisdiction, notes, summary_md')
    .eq('id', regulationId)
    .maybeSingle();
  if (regErr) {
    console.error('[regulatory-check] regulation lookup failed', regErr);
    return json(500, { error: 'Could not load the regulation.' });
  }
  if (!regulation) return json(404, { error: 'Regulation not found.' });

  // No summary means there is nothing to judge against. Failing loudly is mandatory:
  // returning "no findings" would read as "this template is compliant".
  if (!regulation.summary_md || !String(regulation.summary_md).trim()) {
    return json(422, {
      error: `"${regulation.reference_code}" has no Markdown summary uploaded, so there is ` +
        `nothing to check the template against. Upload a summary in the Regulations library first.`,
    });
  }

  let systemTemplate = FALLBACK_SYSTEM_TEMPLATE;
  let promptModel: string | undefined;
  let promptMaxTokens: number | undefined;
  try {
    const { data } = await admin
      .from('ai_prompts')
      .select('system_prompt, model, max_tokens')
      .eq('key', PROMPT_KEY)
      .maybeSingle();
    if (data?.system_prompt) {
      systemTemplate = data.system_prompt;
      promptModel = data.model || undefined;
      promptMaxTokens = data.max_tokens || undefined;
    }
  } catch (e) {
    console.warn('[regulatory-check] Failed to load ai_prompts row, using fallback prompt.', e);
  }

  const system = systemTemplate
    .replaceAll('{{regulationReference}}', regulation.reference_code ?? '')
    .replaceAll('{{regulationTitle}}', regulation.title ?? '')
    .replaceAll('{{jurisdiction}}', regulation.jurisdiction || '(not stated)')
    .replaceAll('{{regulationNotes}}', regulation.notes || '(none)')
    .replaceAll('{{assignmentNotes}}', assignment.notes || 'the whole regulation applies')
    .replaceAll('{{templateName}}', document.templateName ?? '')
    .replaceAll('{{templateType}}', document.templateType ?? 'im')
    .replaceAll('{{chunkInfo}}', describeChunk(document, index, count));

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.beta.messages.create({
      // Model is pinned server-side (ai_prompts config or the default) — never taken
      // from the request body, so a caller cannot bill an arbitrary/expensive model.
      model: promptModel || DEFAULT_MODEL,
      max_tokens: promptMaxTokens || DEFAULT_MAX_TOKENS,
      system,
      // A safety classifier can decline appliance-hazard prose; without a fallback a
      // decline would simply stop the unit. Re-runs the same request on the fallback
      // model inside this call.
      betas: ['server-side-fallback-2026-06-01'],
      fallbacks: [{ model: 'claude-opus-4-8' }],
      output_config: {
        // Thinking is on by default on this model family — do NOT pass `thinking` and
        // do NOT pass budget_tokens (rejected with a 400). Depth is set by `effort`.
        effort: 'medium',
        format: { type: 'json_schema', schema: FINDINGS_SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [
        {
          role: 'user',
          content: [{
            type: 'text',
            text: `REGULATION SUMMARY (Markdown)\n\n${regulation.summary_md}`,
            // Identical across every chunk of this regulation, so chunks 2..N read it
            // from cache instead of paying for it again.
            cache_control: { type: 'ephemeral' },
          }],
        },
        {
          role: 'user',
          content: `TEMPLATE (JSON)\n\n${JSON.stringify(document)}`,
        },
      ],
    });

    // A refusal is an HTTP 200 with no usable content — check before reading blocks, or
    // it surfaces as a confusing parse error.
    if (response.stop_reason === 'refusal') {
      const category = (response as any).stop_details?.category ?? 'unspecified';
      return json(502, {
        error: `The model declined to review this content (${category}). Nothing was returned ` +
          `for this part; the rest of the run continues.`,
      });
    }

    let raw = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    // Belt and braces: the schema should make a fence impossible, but stripping one is
    // free and a parse failure costs a whole unit.
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

    let parsed: { findings?: unknown[]; verbatims?: unknown[]; notes?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error('[regulatory-check] unparseable model output:', raw.slice(0, 200));
      return json(502, { error: 'The model returned a response that could not be read as JSON.' });
    }

    return json(200, {
      regulationId,
      chunkIndex: index,
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
      verbatims: Array.isArray(parsed.verbatims) ? parsed.verbatims : [],
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      model: response.model,
      // Findings may be cut short — the client counts these so the report can say so.
      truncated: response.stop_reason === 'max_tokens',
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Regulatory check request failed.';
    console.error('[regulatory-check] model call failed', e);
    return json(502, { error: message });
  }
};
