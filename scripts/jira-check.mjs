#!/usr/bin/env node
/**
 * Diagnose the Jira connector against the real Jira, from the command line.
 *
 * Exists because the connector's failure modes are all invisible from the UI — a bad
 * token, a missing ProjectID field, a project key that scopes the search too narrowly
 * all look identical ("Not on Jira"). This says which one it is.
 *
 * Reads the same JIRA_* vars the Netlify function reads, from the repo-root .env, and
 * applies the same rule: one EPIC whose ProjectID field holds the code. It never prints
 * the token.
 *
 *   npm run jira:check                    # diagnose the connection only
 *   npm run jira:check MDA26003           # diagnose, then look up specific codes
 *
 * For an assertion-based check of the matching logic against live Jira, see
 * netlify/functions/lib/jira-match.live.test.ts (JIRA_LIVE_TEST=1).
 */
import { readFileSync } from 'node:fs';

const envFile = (() => {
  try {
    return readFileSync(new URL('../.env', import.meta.url), 'utf8');
  } catch {
    return '';
  }
})();

const env = key => {
  if (process.env[key]) return process.env[key].trim();
  const line = envFile.split(/\r?\n/).find(l => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : '';
};

const BASE = env('JIRA_BASE_URL').replace(/\/+$/, '');
const EMAIL = env('JIRA_EMAIL');
const TOKEN = env('JIRA_API_TOKEN');
const PROJECT_KEY = env('JIRA_PROJECT_KEY');
const FIELD_NAME = env('JIRA_PROJECT_ID_FIELD') || 'ProjectID';

const missing = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'].filter(k => !env(k));
if (missing.length) {
  console.error(`Missing ${missing.join(', ')} — set them in .env or the environment.`);
  process.exit(1);
}

const AUTH = 'Basic ' + Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');

/**
 * Structural check on the token BEFORE calling Jira.
 *
 * Worth doing because a truncated token and a revoked one produce the identical 401,
 * and truncation is by far the more common of the two: Atlassian shows the token in a
 * scrollable box, so selecting it by dragging (instead of clicking Copy) silently
 * yields only the visible part. Current-format tokens start "ATATT" and end with "="
 * plus a short checksum, so a missing suffix is a reliable tell.
 */
const tokenShapeProblem = () => {
  if (!TOKEN.startsWith('ATATT')) {
    return TOKEN.length === 24
      ? 'this looks like a legacy (pre-2023) API token; those no longer work on Atlassian Cloud.'
      : 'this does not look like an Atlassian API token (they start with "ATATT").';
  }
  if (!TOKEN.includes('=')) {
    return `it is ${TOKEN.length} chars and has no "=" checksum suffix, so it is TRUNCATED — a complete token is roughly 190 chars and ends with "=" plus a short checksum.`;
  }
  return null;
};

// Reported, not enforced: this is a heuristic about Atlassian's token format, and a
// heuristic must never be what stops a working credential from being tried. Jira's own
// answer below is the authority.
const shapeProblem = tokenShapeProblem();
const RECOPY_HINT = `
Re-copy the token at
  https://id.atlassian.com/manage-profile/security/api-tokens
using the dialog's Copy button rather than selecting the text by hand — the box scrolls,
so a hand-selection silently grabs only the visible part. Paste it into .env as a single
line, no quotes, no line breaks.`;

const call = async (path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: AUTH, Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 400);
  }
  return { status: res.status, body };
};

console.log(`site        ${BASE}`);
console.log(`account     ${EMAIL}`);
console.log(`token       ${TOKEN.length} chars, starts "${TOKEN.slice(0, 5)}"`);
if (shapeProblem) console.log(`WARN  token shape: ${shapeProblem}`);
console.log(`project key ${PROJECT_KEY || '(none — searching all projects)'}`);
console.log(`field name  ${FIELD_NAME}\n`);

// 1. Are the credentials accepted at all? Everything else is meaningless until this
//    passes — and an anonymous request still gets 200s from some endpoints, which is
//    exactly what makes a bad token look like an empty Jira.
const me = await call('/rest/api/3/myself');
if (me.status !== 200) {
  console.error(`FAIL  /myself -> ${me.status}: ${typeof me.body === 'string' ? me.body : JSON.stringify(me.body)}`);
  if (shapeProblem) {
    // Rejected AND malformed — the shape is almost certainly the reason.
    console.error(`
The token is also malformed: ${shapeProblem}${RECOPY_HINT}`);
  } else {
    console.error(`
The token looks well-formed but Jira will not accept it. Check that:
  - it belongs to ${EMAIL} (the token and the email must be the same account),
  - it has not been revoked or expired at
    https://id.atlassian.com/manage-profile/security/api-tokens,
  - the account can log in to ${BASE}.${RECOPY_HINT}`);
  }
  process.exit(1);
}
console.log(`OK    authenticated as ${me.body.displayName} <${me.body.emailAddress || 'email hidden'}>`);

// 2. Can this account see the project the connector is scoped to?
const projects = await call('/rest/api/3/project/search?maxResults=100');
const visible = projects.body?.values || [];
console.log(`OK    ${visible.length} project(s) visible: ${visible.map(p => p.key).join(', ') || '(none)'}`);
if (PROJECT_KEY && !visible.some(p => p.key.toLowerCase() === PROJECT_KEY.toLowerCase())) {
  console.warn(`WARN  JIRA_PROJECT_KEY=${PROJECT_KEY} is not among them — every lookup will come back empty.`);
}

// 3. Does the ProjectID field exist, and what is its id on this site?
const fields = await call('/rest/api/3/field');
const norm = s => s.replace(/\s+/g, '').toLowerCase();
const match = (fields.body || []).find(f => f.name && norm(f.name) === norm(FIELD_NAME));
if (!match) {
  console.warn(`WARN  no field named "${FIELD_NAME}" (scanned ${(fields.body || []).length}).`);
  const candidates = (fields.body || []).filter(f => f.custom).map(f => `${f.id} ${JSON.stringify(f.name)}`);
  console.warn(candidates.length ? `      custom fields available:\n        ${candidates.join('\n        ')}` : '      no custom fields visible to this account.');
} else {
  console.log(`OK    "${match.name}" -> ${match.id}`);
}
const fieldId = match?.id || null;

// 4. Run the real lookup for the requested codes.
const codes = process.argv.slice(2).filter(Boolean);
if (codes.length === 0) {
  console.log('\nPass one or more project codes to look them up, e.g.:\n  node scripts/jira-check.mjs MDA26003');
  process.exit(0);
}

if (!fieldId) {
  console.error(`
Cannot look up codes without the "${FIELD_NAME}" field — that field IS the link
between an OriginFlow project and its Jira Epic. Set JIRA_PROJECT_ID_FIELD to the exact
display name shown above.`);
  process.exit(1);
}

const cf = `cf[${fieldId.match(/\d+/)[0]}]`;
const scope = PROJECT_KEY ? `project = "${PROJECT_KEY}" AND ` : '';

console.log('');
for (const code of codes) {
  const phrase = `${cf} ~ "\\"${code}\\""`;

  // The Epic is the launch; this is exactly what the connector queries.
  const epics = await call('/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({
      jql: `${scope}issuetype = Epic AND (${phrase}) ORDER BY updated DESC`,
      fields: ['summary', 'status', 'issuetype', fieldId],
      maxResults: 20,
    }),
  });
  if (epics.status !== 200) {
    console.log(`${code}  ERROR ${epics.status}: ${JSON.stringify(epics.body).slice(0, 300)}`);
    continue;
  }
  const found = epics.body.issues || [];
  if (found.length === 0) {
    console.log(`${code}  no Epic carries this code`);
  }
  for (const i of found) {
    const flag = found.length > 1 ? '  <-- AMBIGUOUS' : '';
    console.log(
      `${code}  ${i.key}  status="${i.fields?.status?.name}" (${i.fields?.status?.statusCategory?.key})  ` +
        `${FIELD_NAME}=${JSON.stringify(i.fields?.[fieldId])}  "${i.fields?.summary}"${flag}`,
    );
  }

  // Count what the Epic filter keeps out, so "why isn't ticket X shown?" has an answer.
  const others = await call('/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({
      jql: `${scope}issuetype != Epic AND (${phrase})`,
      fields: ['issuetype'],
      maxResults: 100,
    }),
  });
  const otherTypes = [...new Set((others.body?.issues || []).map(i => i.fields?.issuetype?.name))];
  if (otherTypes.length) {
    console.log(`${' '.repeat(code.length)}  (excluded: ${others.body.issues.length} non-Epic ticket(s) — ${otherTypes.join(', ')})`);
  }
}
