/**
 * IMViewer — the public entry point of the detached viewer module.
 *
 * Renders a published Instruction Manual from any of: a manifest URL, a single manual URL, or an
 * in-memory manifest/manual object. Handles fetching, language switching, theming, and the
 * lightbox. Depends only on React, dompurify and lucide-react — nothing from the host app.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import './im-viewer.css';
import {
  ViewerSource,
  Manifest,
  ResolvedManual,
  ViewerTextSelection,
  SUPPORTED_SCHEMA_VERSION,
} from './types';
import { loadManifest, loadManual, type UrlResolver } from './data';
import { getThemeVars } from './theme';
import { collectImages } from './imageCollection';
import { LightboxProvider } from './Lightbox';
import { ViewerShell } from './ViewerShell';

export interface IMViewerProps {
  source: ViewerSource;
  /**
   * Called when the reader settles on a text selection inside the manual (and with null when
   * they clear it). Opt-in: omit it and no listener is attached, so the plain read-only share
   * page behaves exactly as it did before commenting existed.
   *
   * The commenting UI itself deliberately lives in the host page, not in here — this module
   * stays dependency-free and knows nothing about review links or Supabase.
   */
  onSelectText?: (selection: ViewerTextSelection | null) => void;
  /**
   * Rewrites a URL right before every fetch this component makes (the manifest, and each
   * per-language manual it lists) — e.g. into a freshly minted, short-TTL signed URL. Optional:
   * omit it and URLs are fetched exactly as given, unchanged from before this existed. On a
   * 401/403 (an expired signed URL on a manual left open past its TTL) the fetch is retried
   * ONCE with a fresh call to `resolveUrl` — never a silently blank viewer.
   */
  resolveUrl?: UrlResolver;
}

const pickInitialLang = (manifest: Manifest): string | null =>
  manifest.languages?.[0]?.lang ?? null;

export const IMViewer: React.FC<IMViewerProps> = ({ source, onSelectText, resolveUrl }) => {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manual, setManual] = useState<ResolvedManual | null>(null);
  const [lang, setLang] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Read via a ref rather than a hook dependency: `resolveUrl` is typically a fresh closure
  // every render (it captures a token/projectId in the host page), and depending on it would
  // re-run the load effect (and the language-switch callback's identity) on every keystroke
  // elsewhere in the host, not just when the manual itself should reload.
  const resolveUrlRef = useRef(resolveUrl);
  resolveUrlRef.current = resolveUrl;

  const loadLanguageFromManifest = useCallback(async (mf: Manifest, language: string) => {
    const entry = mf.languages.find((l) => l.lang === language) ?? mf.languages[0];
    if (!entry) throw new Error('Manifest lists no languages.');
    const m = await loadManual(entry.url, resolveUrlRef.current);
    setManual(m);
    setLang(entry.lang);
  }, []);

  // Resolve the source whenever it changes.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        if ('manual' in source) {
          if (cancelled) return;
          setManifest(null);
          setManual(source.manual);
          setLang(source.manual.language);
        } else if ('manualUrl' in source) {
          const m = await loadManual(source.manualUrl, resolveUrlRef.current);
          if (cancelled) return;
          setManifest(null);
          setManual(m);
          setLang(m.language);
        } else {
          const mf = 'manifest' in source ? source.manifest : await loadManifest(source.manifestUrl, resolveUrlRef.current);
          if (cancelled) return;
          setManifest(mf);
          const initial = pickInitialLang(mf);
          if (!initial) throw new Error('Manifest lists no languages.');
          await loadLanguageFromManifest(mf, initial);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load manual.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(source)]);

  const onChangeLang = useCallback(
    async (next: string) => {
      if (!manifest || next === lang) return;
      setLoading(true);
      setError(null);
      try {
        await loadLanguageFromManifest(manifest, next);
      } catch (e: any) {
        setError(e?.message ?? 'Failed to switch language.');
      } finally {
        setLoading(false);
      }
    },
    [manifest, lang, loadLanguageFromManifest],
  );

  const themeVars = getThemeVars(manual?.metadata);

  let body: React.ReactNode;
  if (loading && !manual) {
    body = (
      <div className="imv-status">
        <Loader2 size={22} className="imv-spin" />
        <span>Loading manual…</span>
      </div>
    );
  } else if (error) {
    body = (
      <div className="imv-status imv-status-error">
        <AlertCircle size={22} />
        <span>{error}</span>
      </div>
    );
  } else if (!manual) {
    body = <div className="imv-status">No manual to display.</div>;
  } else {
    if (manual.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
      // Best-effort render; log so a mismatch is visible during integration.
      console.warn(
        `[im-viewer] manual schemaVersion ${manual.schemaVersion} ≠ supported ${SUPPORTED_SCHEMA_VERSION}; rendering best-effort.`,
      );
    }
    body = (
      <LightboxProvider images={collectImages(manual)}>
        <ViewerShell
          manual={manual}
          languages={manifest?.languages}
          currentLang={lang}
          onChangeLang={onChangeLang}
          onSelectText={onSelectText}
        />
      </LightboxProvider>
    );
  }

  return (
    <div className="imv-root" style={themeVars}>
      {body}
    </div>
  );
};
