/**
 * Public, unauthenticated page for a shared Instruction Manual link (`/#/share/im/:token`).
 * Resolves the token via the anon-callable `get_im_share_by_token` RPC (im_shares table,
 * db_migrations/84_create_im_shares.sql) to a (projectId, templateType) pair, then renders
 * the exact same read-only <IMViewer> the internal Viewer tab uses, pointed at that
 * project's published manifest. No auth, no app chrome — just the manual.
 */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { resolveIMShareToken, getPublishedManifestUrl } from '../../services';
import { IMViewer, type ViewerSource } from '../../modules/im-viewer';

const IMSharedManual: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [source, setSource] = useState<ViewerSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!token) {
        setError('Invalid link.');
        setLoading(false);
        return;
      }
      const resolved = await resolveIMShareToken(token);
      if (cancelled) return;
      if (!resolved) {
        setError('This link is invalid or has been revoked.');
        setLoading(false);
        return;
      }
      const manifestUrl = getPublishedManifestUrl(resolved.projectId, resolved.templateType);
      if (!manifestUrl) {
        setError('This manual is unavailable.');
        setLoading(false);
        return;
      }
      setSource({ manifestUrl });
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-400">Loading manual…</div>;
  }

  if (error || !source) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 text-gray-500 gap-3 px-4 text-center">
        <AlertTriangle size={32} className="text-amber-400" />
        <p className="text-sm">{error || 'This manual is unavailable.'}</p>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-white">
      <IMViewer source={source} />
    </div>
  );
};

export default IMSharedManual;
