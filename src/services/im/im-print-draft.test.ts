/**
 * Draft print-render contract tests.
 *
 * A draft render (template editor → throwaway PDF, see requestDraftPrintPdf) is the one
 * place where the BROWSER writes files that the render FUNCTIONS read back. The two sides
 * build that path independently and never import each other, so the only thing keeping them
 * in agreement is this test — a silent divergence would fail every draft render with a
 * "draft manual is missing" naming a path nobody wrote.
 *
 * Also pins the discardability property the whole feature rests on: a draft's inputs AND its
 * output must live under the job prefix that cleanup deletes. If either ever moves outside
 * it, drafts start accumulating in the im-print bucket forever.
 */
import { describe, it, expect } from 'vitest';
import {
  draftManualPath,
  draftPdfPath,
  tempPartPath,
  tempJobPrefix,
} from '../../../netlify/functions/lib/print-render-shared';
import { draftManualStoragePath } from './im-print-export.service';

const TEMPLATE_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const JOB_ID = 'f9e8d7c6-0000-4000-8000-00000000000f';
/** What the client sends as `projectId` for a draft — a namespace, not a project. */
const NAMESPACE = `draft-${TEMPLATE_ID}`;

describe('draft manual path', () => {
  it('is built identically by the browser and by the render functions', () => {
    for (const templateType of ['im', 'warning_leaflet'] as const) {
      for (const lang of ['en', 'de', 'pt']) {
        expect(draftManualStoragePath(TEMPLATE_ID, templateType, JOB_ID, lang)).toBe(
          draftManualPath(NAMESPACE, templateType, JOB_ID, lang),
        );
      }
    }
  });

  it('namespaces drafts so they cannot collide with a real project tree', () => {
    // Real renders live at `{projectId}/…` and their temp files at `tmp/{projectId}/…`.
    // A draft must be identifiable — and unmistakable for a project id — at a glance.
    const path = draftManualStoragePath(TEMPLATE_ID, 'im', JOB_ID, 'en');
    expect(path.startsWith('tmp/draft-')).toBe(true);
    expect(path).toContain(TEMPLATE_ID);
  });
});

describe('draft discardability', () => {
  const prefix = tempJobPrefix(NAMESPACE, 'im', JOB_ID);

  it('puts the uploaded manuals inside the prefix cleanup deletes', () => {
    expect(draftManualPath(NAMESPACE, 'im', JOB_ID, 'en').startsWith(`${prefix}/`)).toBe(true);
  });

  it('puts the rendered PDF inside the prefix cleanup deletes', () => {
    // This is what makes a draft throwaway by construction rather than by remembering:
    // the cleanup call every job already makes in a `finally` removes it.
    expect(draftPdfPath(NAMESPACE, 'im', JOB_ID).startsWith(`${prefix}/`)).toBe(true);
  });

  it('does not collide with the job\'s own intermediate part files', () => {
    const parts = [0, 1, 2].map((i) => tempPartPath(NAMESPACE, 'im', JOB_ID, i));
    const draftFiles = [draftPdfPath(NAMESPACE, 'im', JOB_ID), draftManualPath(NAMESPACE, 'im', JOB_ID, 'en')];
    for (const f of draftFiles) expect(parts).not.toContain(f);
    expect(new Set([...parts, ...draftFiles]).size).toBe(parts.length + draftFiles.length);
  });
});
