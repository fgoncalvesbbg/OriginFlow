/**
 * New Re-Edit form.
 *
 * A Re-Edit is a new Information Manual for a SKU that is already live — a warning-text
 * correction, a regulation change, a component swap — and it can happen several times over
 * one SKU's life. It is a project (an IM cannot exist without one: `project_ims.project_id`
 * is NOT NULL and unique per template type) but a skeletal one: no phases, no documents, no
 * supplier and no supplier portal. See migration 182.
 *
 * What this form deliberately does NOT ask for:
 *
 *   Supplier   there is nobody to send a draft to; the manual is written in-house.
 *   PM         `createReEditProject` sets it to whoever is creating the re-edit, because
 *              `can_see_project()` is `ADMIN OR pm_id = auth.uid()` — pm_id IS the access
 *              rule, and leaving it empty would hide the re-edit from its own author.
 *   Code       assigned by the database on save (`next_reedit_code`), never typed. Claimed
 *              on submit rather than on mount so an abandoned form burns no number.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout';
import { getCategories, getProjects } from '../../services';
import { createReEditProject } from '../../services/project/project.service';
import { getKnownSkus, type KnownSku } from '../../services/project/project-sku.service';
import { MAX_SKUS_PER_PROJECT } from '../../services/project/project-sku.service';
import { CategoryL3, Project } from '../../types';
import { ArrowLeft, AlertTriangle, Loader2, Search, X, Check } from 'lucide-react';

const CreateReEdit: React.FC = () => {
  const navigate = useNavigate();

  const [categories, setCategories] = useState<CategoryL3[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [knownSkus, setKnownSkus] = useState<KnownSku[]>([]);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [requirement, setRequirement] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [sourceProjectId, setSourceProjectId] = useState('');
  const [selectedSkus, setSelectedSkus] = useState<KnownSku[]>([]);
  const [skuQuery, setSkuQuery] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const errs: string[] = [];
    Promise.all([
      getCategories().catch(e => { errs.push(`Categories: ${e.message}`); return [] as CategoryL3[]; }),
      // Launches only — a re-edit revises a launch's manual, and offering another re-edit as
      // the origin would invite a chain nobody can follow back to the original product.
      getProjects().catch(e => { errs.push(`Projects: ${e.message}`); return [] as Project[]; }),
      getKnownSkus().catch(e => { errs.push(`SKUs: ${e.message}`); return [] as KnownSku[]; }),
    ]).then(([cats, projs, skus]) => {
      if (!mounted) return;
      setCategories(cats);
      setProjects(projs);
      setKnownSkus(skus);
      if (errs.length) setLoadErrors(errs);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, []);

  const selectedNumbers = useMemo(
    () => new Set(selectedSkus.map(s => s.skuNumber)),
    [selectedSkus],
  );

  /** Matches on number or title; capped so a 5000-SKU estate cannot stall the keystroke. */
  const skuMatches = useMemo(() => {
    const q = skuQuery.trim().toLowerCase();
    if (!q) return [];
    return knownSkus
      .filter(s => !selectedNumbers.has(s.skuNumber))
      .filter(s => s.skuNumber.toLowerCase().includes(q) || s.skuTitle.toLowerCase().includes(q))
      .slice(0, 12);
  }, [skuQuery, knownSkus, selectedNumbers]);

  const addSku = (sku: KnownSku) => {
    if (selectedSkus.length >= MAX_SKUS_PER_PROJECT) return;
    setSelectedSkus(prev => [...prev, sku]);
    setSkuQuery('');
  };
  const removeSku = (skuNumber: string) =>
    setSelectedSkus(prev => prev.filter(s => s.skuNumber !== skuNumber));

  const canSubmit =
    name.trim().length > 0 && requirement.trim().length > 0 && selectedSkus.length > 0 && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const project = await createReEditProject({
        name: name.trim(),
        requirement: requirement.trim(),
        skus: selectedSkus.map(s => ({ skuNumber: s.skuNumber, skuTitle: s.skuTitle })),
        categoryId: categoryId || null,
        sourceProjectId: sourceProjectId || null,
      });
      // Straight into the generator: writing the manual is the entire point of a re-edit,
      // and its project page has no phases or documents to stop at on the way.
      navigate(`/project/${project.id}/im-generator`);
    } catch (err: any) {
      console.error('[CreateReEdit]', err);
      setError(err?.message || JSON.stringify(err));
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto">
        <button onClick={() => navigate('/im')} className="flex items-center text-muted hover:text-gray-800 mb-6 text-sm">
          <ArrowLeft size={16} className="mr-1" /> Back to Manuals
        </button>

        <div className="bg-white rounded-xl shadow border border-gray-200 p-8">
          <h1 className="text-3xl font-bold text-primary mb-1">New Re-Edit</h1>
          <p className="text-sm text-muted mb-6">
            A new manual for a SKU that is already live. No supplier, no phases — just the
            requirement and the manual.
          </p>

          {loadErrors.length > 0 && (
            <div className="mb-6 bg-yellow-50 border-l-4 border-yellow-500 p-4 rounded flex items-start gap-3">
              <AlertTriangle className="text-yellow-600 shrink-0 mt-0.5" size={18} />
              <div>
                <h3 className="text-sm font-bold text-yellow-800">Some data failed to load</h3>
                {loadErrors.map((e, i) => <p key={i} className="text-sm text-yellow-700 mt-1">{e}</p>)}
              </div>
            </div>
          )}

          {error && (
            <div className="mb-6 bg-rose-50 border-l-4 border-red-500 p-4 rounded flex items-start gap-3">
              <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} />
              <div>
                <h3 className="text-sm font-bold text-rose-800">Creation Failed</h3>
                <p className="text-sm text-rose-700 mt-1">{error}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Re-Edit Code</label>
              <div className="w-full border border-gray-200 rounded-lg p-2 text-sm bg-gray-50 text-gray-500 font-mono">
                RE{new Date().getUTCFullYear().toString().slice(-2)}### — assigned on save
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                className="w-full border border-gray-200 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="e.g. Beersafe — Annex II warning wording"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>

            {/* SKUs ------------------------------------------------------ */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                SKU(s) being re-edited
              </label>
              {selectedSkus.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {selectedSkus.map(s => (
                    <span
                      key={s.skuNumber}
                      className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full pl-3 pr-1.5 py-1 text-xs"
                    >
                      <span className="font-mono font-medium">{s.skuNumber}</span>
                      <span className="text-indigo-400 max-w-40 truncate">{s.skuTitle}</span>
                      <button
                        type="button"
                        onClick={() => removeSku(s.skuNumber)}
                        className="text-indigo-400 hover:text-indigo-700 rounded-full p-0.5"
                        aria-label={`Remove ${s.skuNumber}`}
                      ><X size={12} /></button>
                    </span>
                  ))}
                </div>
              )}
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder={loading ? 'Loading SKUs…' : 'Search a live SKU by number or name…'}
                  value={skuQuery}
                  onChange={e => setSkuQuery(e.target.value)}
                  disabled={loading || selectedSkus.length >= MAX_SKUS_PER_PROJECT}
                />
                {skuMatches.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {skuMatches.map(s => (
                      <button
                        type="button"
                        key={s.skuNumber}
                        onClick={() => addSku(s)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 flex items-center justify-between gap-3"
                      >
                        <span className="truncate">
                          <span className="font-mono font-medium text-gray-700">{s.skuNumber}</span>
                          <span className="text-gray-400 ml-2">{s.skuTitle}</span>
                        </span>
                        <Check size={14} className="text-indigo-400 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {skuQuery.trim() && skuMatches.length === 0 && !loading && (
                <p className="text-xs text-muted mt-1">No SKU matches “{skuQuery.trim()}”.</p>
              )}
              {selectedSkus.length >= MAX_SKUS_PER_PROJECT && (
                <p className="text-xs text-amber-600 mt-1">
                  Maximum of {MAX_SKUS_PER_PROJECT} SKUs reached.
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category (optional)</label>
              <select
                className="w-full border border-gray-200 rounded-lg p-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                value={categoryId}
                onChange={e => setCategoryId(e.target.value)}
              >
                <option value="">— None —</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Original project (optional)
              </label>
              <select
                className="w-full border border-gray-200 rounded-lg p-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                value={sourceProjectId}
                onChange={e => setSourceProjectId(e.target.value)}
              >
                <option value="">— Not known —</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.projectId} — {p.name}</option>
                ))}
              </select>
              <p className="text-xs text-muted mt-1">
                The launch whose manual this revises, so the previously published version can be found.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Requirement</label>
              <textarea
                className="w-full border border-gray-200 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                rows={4}
                placeholder="What must change, and why. e.g. “Annex II warning wording changed — update section 4.2 in all locales.”"
                value={requirement}
                onChange={e => setRequirement(e.target.value)}
                required
              />
              <p className="text-xs text-muted mt-1">
                This is the brief the writer works from — it stands in for the supplier draft a
                launch starts from, which is why it is required.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => navigate('/im')}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
              >Cancel</button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {submitting ? 'Creating…' : 'Create Re-Edit'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
};

export default CreateReEdit;
