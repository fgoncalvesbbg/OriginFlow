import { describe, it, expect } from 'vitest';
import { CALLOUT_TITLES_I18N as CANONICAL } from './callout-titles.i18n';
import { CALLOUT_TITLES_I18N as VIEWER_COPY } from '../../modules/im-viewer/callout-titles.i18n';

/**
 * The customer-facing viewer module (`src/modules/im-viewer/`) is deliberately
 * standalone — it imports nothing from the host app so it can be extracted — and
 * therefore keeps its own hand-maintained copy of the localized callout titles.
 * That copy is the drift risk this test guards: any variant/language added to the
 * canonical `src/services/im/callout-titles.i18n.ts` must be mirrored in the viewer
 * copy (and vice versa), or a translated safety-sign header silently falls back to
 * English in one of the two renderers.
 */
describe('callout titles i18n — canonical vs viewer copy', () => {
  it('the two CALLOUT_TITLES_I18N maps are identical', () => {
    expect(VIEWER_COPY).toEqual(CANONICAL);
  });
});
