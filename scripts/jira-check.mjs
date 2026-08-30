#!/usr/bin/env node
/**
 * Diagnose the Jira connector against the real Jira, from the command line.
 *
 * Exists because the connector's failure modes are all invisible from the UI — a bad
 * token, a missing ProjectID field, a project key that scopes the search too narrowly
 * all look identical ("Not on Jira"). This says which one it is.
 *
 * Reads the same JIRA_* vars the Netlify function reads, from the repo-root .env, and
 * runs the same three passes. It never prints the token.
 *
 *   node scripts/jira-check.mjs                 # diagnose + look up every project code in .env-free demo mode
 *   node scripts/jira-check.mjs MDA26003        # look up specific codes
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
console.log(`project key ${PROJECT_KEY || '(none — searching all projects)'}`);
console.log(`field name  ${FIELD_NAME}\n`);

// 1. Are the credentials accepted at all? Everything else is meaningless until this
//    passes — and an anonymous request still gets 200s from some endpoints, which is
//    exactly what makes a bad token look like an empty Jira.
const me = await call('/rest/api/3/myself');
if (me.status !== 200) {
  console.error(`FAIL  /myself -> ${me.status}: ${typeof me.body === 'string' ? me.body : JSON.stringify(me.body)}`);
  console.error(`
The API token is not being accepted. Check that:
  - it was pasted in full (Atlassian tokens are ~192 chars and end with "=" plus a
    short checksum; a shorter value is almost always a truncated paste),
  - it belongs to ${EMAIL},
  - it has not been revoked at
    https://id.atlassian.com/manage-profile/security/api-tokens`);
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

const cf = fieldId && /^customfield_(\d+)$/.test(fieldId) ? `cf[${fieldId.match(/\d+/)[0]}]` : fieldId;
const passes = [...(cf ? [[`field (${FIELD_NAME})`, cf]] : []), ['summary', 'summary'], ['text', 'text']];

console.log('');
for (const code of codes) {
  let done = false;
  for (const [label, jqlField] of passes) {
    if (done) break;
    const jql =
      (PROJECT_KEY ? `project = "${PROJECT_KEY}" AND ` : '') +
      `(${jqlField} ~ "\\"${code}\\"") ORDER BY updated DESC`;
    const res = await call('/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify({
        jql,
        fields: ['summary', 'status', ...(fieldId ? [fieldId] : [])],
        maxResults: 20,
      }),
    });
    if (res.status !== 200) {
      console.log(`${code}  [${label}] ERROR ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`);
      continue;
    }
    const issues = res.body.issues || [];
    if (issues.length === 0) {
      console.log(`${code}  [${label}] no hits`);
      continue;
    }
    for (const i of issues) {
      const value = fieldId ? JSON.stringify(i.fields?.[fieldId]) : '(field not resolved)';
      console.log(`${code}  [${label}] ${i.key}  ${i.fields?.status?.name}  ${FIELD_NAME}=${value}  "${i.fields?.summary}"`);
    }
    done = true;
  }
}
