/**
 * Admin console → Project Templates: the standard phase/document structure createProject()
 * stamps onto every new project.
 *
 * Phases (template_steps) and their required documents (template_documents) used to be
 * hardcoded in createProject() — changing what a new launch starts with meant a code
 * deploy. One template is marked default; createProject() reads it at project-creation
 * time. See db_migrations/152_project_phase_document_templates.sql.
 */

import React, { useEffect, useState } from 'react';
import {
  getProjectTemplates, saveProjectTemplate, deleteProjectTemplate, setDefaultProjectTemplate,
  getTemplateSteps, saveTemplateStep, deleteTemplateStep,
  getTemplateDocuments, saveTemplateDocument, deleteTemplateDocument,
} from '../../services';
import { ProjectTemplate, TemplateStep, TemplateDocument, ResponsibleParty } from '../../types';
import { Plus, Trash2, Edit2, Star, Loader2, FileText, CheckCircle, X } from 'lucide-react';
import { ConfirmationModal } from '../common/ConfirmationModal';
import TemplateStandardDocuments from './TemplateStandardDocuments';

const ProjectTemplateAdminSection: React.FC = () => {
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [steps, setSteps] = useState<TemplateStep[]>([]);
  const [documents, setDocuments] = useState<TemplateDocument[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [editingTemplate, setEditingTemplate] = useState<'new' | string | null>(null);
  const [templateForm, setTemplateForm] = useState({ name: '', description: '' });
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectTemplate | null>(null);

  const [addingPhaseName, setAddingPhaseName] = useState('');
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [editingStepName, setEditingStepName] = useState('');
  const [deleteStepTarget, setDeleteStepTarget] = useState<TemplateStep | null>(null);

  const [editingDoc, setEditingDoc] = useState<{ stepNumber: number; id?: string } | null>(null);
  const [docForm, setDocForm] = useState<{ title: string; description: string; responsibleParty: ResponsibleParty; isVisibleToSupplier: boolean; isRequired: boolean }>({
    title: '', description: '', responsibleParty: ResponsibleParty.INTERNAL, isVisibleToSupplier: true, isRequired: true,
  });
  const [savingDoc, setSavingDoc] = useState(false);
  const [deleteDocTarget, setDeleteDocTarget] = useState<TemplateDocument | null>(null);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const rows = await getProjectTemplates();
      setTemplates(rows);
      if (!selectedId && rows.length) setSelectedId(rows.find(r => r.isDefault)?.id ?? rows[0].id);
    } catch (e) {
      console.error('[ProjectTemplateAdminSection] loading templates failed:', e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void loadTemplates(); }, []);

  const loadDetail = async (templateId: string) => {
    setDetailLoading(true);
    try {
      const [s, d] = await Promise.all([getTemplateSteps(templateId), getTemplateDocuments(templateId)]);
      setSteps(s);
      setDocuments(d);
    } catch (e) {
      console.error('[ProjectTemplateAdminSection] loading template detail failed:', e);
    } finally {
      setDetailLoading(false);
    }
  };
  useEffect(() => { if (selectedId) void loadDetail(selectedId); }, [selectedId]);

  const selected = templates.find(t => t.id === selectedId) ?? null;
  const nextStepNumber = steps.length ? Math.max(...steps.map(s => s.stepNumber)) + 1 : 1;

  // --- Template CRUD ---
  const startEditTemplate = (t?: ProjectTemplate) => {
    setEditingTemplate(t?.id ?? 'new');
    setTemplateForm(t ? { name: t.name, description: t.description ?? '' } : { name: '', description: '' });
  };

  const saveTemplate = async () => {
    if (!templateForm.name.trim() || savingTemplate) return;
    setSavingTemplate(true);
    try {
      const saved = await saveProjectTemplate({
        id: editingTemplate === 'new' ? undefined : editingTemplate ?? undefined,
        name: templateForm.name,
        description: templateForm.description,
      });
      setEditingTemplate(null);
      await loadTemplates();
      setSelectedId(saved.id);
    } catch (e: any) {
      alert(`Failed to save template: ${e?.message ?? e}`);
    } finally {
      setSavingTemplate(false);
    }
  };

  const confirmDeleteTemplate = async () => {
    if (!deleteTarget) return;
    try {
      await deleteProjectTemplate(deleteTarget.id);
      setDeleteTarget(null);
      if (selectedId === deleteTarget.id) setSelectedId(null);
      await loadTemplates();
    } catch (e: any) {
      alert(`Failed to delete template: ${e?.message ?? e}`);
    }
  };

  const makeDefault = async (t: ProjectTemplate) => {
    try {
      await setDefaultProjectTemplate(t.id);
      await loadTemplates();
    } catch (e: any) {
      alert(`Failed to set default: ${e?.message ?? e}`);
    }
  };

  // --- Phase (template_steps) CRUD ---
  const addPhase = async () => {
    if (!selectedId || !addingPhaseName.trim()) return;
    try {
      await saveTemplateStep({ templateId: selectedId, stepNumber: nextStepNumber, name: addingPhaseName });
      setAddingPhaseName('');
      await loadDetail(selectedId);
    } catch (e: any) {
      alert(`Failed to add phase: ${e?.message ?? e}`);
    }
  };

  const startEditStep = (s: TemplateStep) => { setEditingStepId(s.id); setEditingStepName(s.name); };

  const saveStepName = async (s: TemplateStep) => {
    if (!editingStepName.trim() || !selectedId) return;
    try {
      await saveTemplateStep({ id: s.id, templateId: selectedId, stepNumber: s.stepNumber, name: editingStepName });
      setEditingStepId(null);
      await loadDetail(selectedId);
    } catch (e: any) {
      alert(`Failed to rename phase: ${e?.message ?? e}`);
    }
  };

  const confirmDeleteStep = async () => {
    if (!deleteStepTarget || !selectedId) return;
    try {
      await deleteTemplateStep(deleteStepTarget.id);
      setDeleteStepTarget(null);
      await loadDetail(selectedId);
    } catch (e: any) {
      alert(`Failed to delete phase: ${e?.message ?? e}`);
    }
  };

  // --- Document (template_documents) CRUD ---
  const startAddDoc = (stepNumber: number) => {
    setEditingDoc({ stepNumber });
    setDocForm({ title: '', description: '', responsibleParty: ResponsibleParty.INTERNAL, isVisibleToSupplier: true, isRequired: true });
  };

  const startEditDoc = (d: TemplateDocument) => {
    setEditingDoc({ stepNumber: d.stepNumber, id: d.id });
    setDocForm({
      title: d.title,
      description: d.description ?? '',
      responsibleParty: d.responsibleParty,
      isVisibleToSupplier: d.isVisibleToSupplier,
      isRequired: d.isRequired,
    });
  };

  const saveDoc = async () => {
    if (!editingDoc || !selectedId || !docForm.title.trim() || savingDoc) return;
    setSavingDoc(true);
    try {
      await saveTemplateDocument({
        id: editingDoc.id,
        templateId: selectedId,
        stepNumber: editingDoc.stepNumber,
        title: docForm.title,
        description: docForm.description,
        responsibleParty: docForm.responsibleParty,
        isVisibleToSupplier: docForm.isVisibleToSupplier,
        isRequired: docForm.isRequired,
      });
      setEditingDoc(null);
      await loadDetail(selectedId);
    } catch (e: any) {
      alert(`Failed to save document: ${e?.message ?? e}`);
    } finally {
      setSavingDoc(false);
    }
  };

  const confirmDeleteDoc = async () => {
    if (!deleteDocTarget || !selectedId) return;
    try {
      await deleteTemplateDocument(deleteDocTarget.id);
      setDeleteDocTarget(null);
      await loadDetail(selectedId);
    } catch (e: any) {
      alert(`Failed to delete document: ${e?.message ?? e}`);
    }
  };

  return (
    <div>
      <div className="px-6 py-4 bg-light border-b border-gray-200 flex justify-between items-center">
        <div>
          <h3 className="font-bold text-gray-800">Project Templates</h3>
          <p className="text-xs text-muted mt-0.5 max-w-2xl">
            The phases and required documents every new project starts with, plus the registry
            documents it hands down. The template marked
            <strong> Default</strong> is what "New Project" uses; existing projects are unaffected.
          </p>
        </div>
        <button onClick={() => startEditTemplate()} className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
          <Plus size={15} /> New template
        </button>
      </div>

      {editingTemplate !== null && (
        <div className="px-6 py-4 border-b border-gray-100 bg-indigo-50/40">
          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Name</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="Standard Launch Process"
                value={templateForm.name}
                onChange={e => setTemplateForm(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="flex-[2] min-w-[280px]">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Description</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                value={templateForm.description}
                onChange={e => setTemplateForm(prev => ({ ...prev, description: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={saveTemplate}
              disabled={savingTemplate || !templateForm.name.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {savingTemplate ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} {editingTemplate === 'new' ? 'Create template' : 'Save changes'}
            </button>
            <button onClick={() => setEditingTemplate(null)} disabled={savingTemplate} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="px-6 py-10 text-center text-gray-400 text-sm">Loading templates…</div>
      ) : templates.length === 0 ? (
        <div className="px-6 py-10 text-center text-gray-400 text-sm">
          No templates yet. Create one and mark it Default — new projects will use its phases and documents.
        </div>
      ) : (
        <>
          <div className="px-6 py-3 flex flex-wrap gap-2 border-b border-gray-100">
            {templates.map(t => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border flex items-center gap-1.5 ${selectedId === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:border-indigo-300'}`}
              >
                {t.isDefault && <Star size={12} className={selectedId === t.id ? 'fill-white' : 'fill-amber-400 text-amber-400'} />}
                {t.name}
              </button>
            ))}
          </div>

          {selected && (
            <div className="px-6 py-4">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h4 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
                    {selected.name}
                    {selected.isDefault && (
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">Default</span>
                    )}
                  </h4>
                  {selected.description && <p className="text-xs text-muted mt-0.5 max-w-xl">{selected.description}</p>}
                </div>
                <div className="flex items-center gap-1 whitespace-nowrap">
                  {!selected.isDefault && (
                    <button onClick={() => makeDefault(selected)} title="Make default" className="p-1.5 text-gray-400 hover:text-amber-600"><Star size={15} /></button>
                  )}
                  <button onClick={() => startEditTemplate(selected)} title="Edit" className="p-1.5 text-gray-400 hover:text-indigo-600"><Edit2 size={15} /></button>
                  <button onClick={() => setDeleteTarget(selected)} title="Delete" className="p-1.5 text-gray-400 hover:text-rose-600"><Trash2 size={15} /></button>
                </div>
              </div>

              <TemplateStandardDocuments templateId={selected.id} isDefault={selected.isDefault} />

              {detailLoading ? (
                <div className="py-8 text-center text-gray-400 text-sm">Loading phases…</div>
              ) : (
                <div className="space-y-4">
                  {steps.map(step => (
                    <div key={step.id} className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="px-4 py-2.5 bg-light border-b border-gray-100 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1">
                          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">Phase {step.stepNumber}</span>
                          {editingStepId === step.id ? (
                            <input
                              autoFocus
                              className="border border-gray-300 rounded px-2 py-1 text-sm flex-1 max-w-xs"
                              value={editingStepName}
                              onChange={e => setEditingStepName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') void saveStepName(step); if (e.key === 'Escape') setEditingStepId(null); }}
                            />
                          ) : (
                            <span className="font-semibold text-gray-800 text-sm">{step.name}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {editingStepId === step.id ? (
                            <>
                              <button onClick={() => saveStepName(step)} className="p-1 text-gray-400 hover:text-emerald-600"><CheckCircle size={14} /></button>
                              <button onClick={() => setEditingStepId(null)} className="p-1 text-gray-400 hover:text-gray-600"><X size={14} /></button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startEditStep(step)} title="Rename phase" className="p-1 text-gray-400 hover:text-indigo-600"><Edit2 size={13} /></button>
                              <button onClick={() => setDeleteStepTarget(step)} title="Delete phase" className="p-1 text-gray-400 hover:text-rose-600"><Trash2 size={13} /></button>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="divide-y divide-gray-50">
                        {documents.filter(d => d.stepNumber === step.stepNumber).map(doc => (
                          <div key={doc.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText size={14} className="text-gray-300 shrink-0" />
                              <div className="min-w-0">
                                <div className="text-sm text-gray-800 truncate">{doc.title}</div>
                                {doc.description && <div className="text-[11px] text-muted truncate">{doc.description}</div>}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${doc.responsibleParty === ResponsibleParty.SUPPLIER ? 'bg-sky-50 text-sky-700 border border-sky-100' : 'bg-violet-50 text-violet-700 border border-violet-100'}`}>
                                {doc.responsibleParty}
                              </span>
                              {doc.isRequired && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 border border-rose-100">Required</span>}
                              <button onClick={() => startEditDoc(doc)} title="Edit" className="p-1 text-gray-400 hover:text-indigo-600"><Edit2 size={13} /></button>
                              <button onClick={() => setDeleteDocTarget(doc)} title="Delete" className="p-1 text-gray-400 hover:text-rose-600"><Trash2 size={13} /></button>
                            </div>
                          </div>
                        ))}

                        {editingDoc?.stepNumber === step.stepNumber ? (
                          <div className="px-4 py-3 bg-indigo-50/40 space-y-2">
                            <div className="flex flex-wrap gap-2">
                              <input
                                className="flex-1 min-w-[180px] border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm"
                                placeholder="Document title"
                                value={docForm.title}
                                onChange={e => setDocForm(prev => ({ ...prev, title: e.target.value }))}
                              />
                              <input
                                className="flex-[2] min-w-[220px] border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm"
                                placeholder="Description (optional)"
                                value={docForm.description}
                                onChange={e => setDocForm(prev => ({ ...prev, description: e.target.value }))}
                              />
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
                              <label className="flex items-center gap-1.5">
                                <span>Responsible:</span>
                                <select
                                  className="border border-gray-300 rounded px-2 py-1"
                                  value={docForm.responsibleParty}
                                  onChange={e => setDocForm(prev => ({ ...prev, responsibleParty: e.target.value as ResponsibleParty }))}
                                >
                                  <option value={ResponsibleParty.INTERNAL}>Internal</option>
                                  <option value={ResponsibleParty.SUPPLIER}>Supplier</option>
                                </select>
                              </label>
                              <label className="flex items-center gap-1.5">
                                <input type="checkbox" checked={docForm.isRequired} onChange={e => setDocForm(prev => ({ ...prev, isRequired: e.target.checked }))} />
                                Required
                              </label>
                              <label className="flex items-center gap-1.5">
                                <input type="checkbox" checked={docForm.isVisibleToSupplier} onChange={e => setDocForm(prev => ({ ...prev, isVisibleToSupplier: e.target.checked }))} />
                                Visible to supplier
                              </label>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={saveDoc}
                                disabled={savingDoc || !docForm.title.trim()}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
                              >
                                {savingDoc ? <Loader2 size={12} className="animate-spin" /> : null} {editingDoc.id ? 'Save' : 'Add document'}
                              </button>
                              <button onClick={() => setEditingDoc(null)} disabled={savingDoc} className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs hover:bg-gray-50">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => startAddDoc(step.stepNumber)}
                            className="w-full px-4 py-2 text-xs font-medium text-indigo-600 hover:bg-indigo-50/60 flex items-center gap-1.5"
                          >
                            <Plus size={13} /> Add document
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  <div className="flex items-center gap-2">
                    <input
                      className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm flex-1 max-w-xs"
                      placeholder="New phase name"
                      value={addingPhaseName}
                      onChange={e => setAddingPhaseName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') void addPhase(); }}
                    />
                    <button
                      onClick={addPhase}
                      disabled={!addingPhaseName.trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <Plus size={14} /> Add phase
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <ConfirmationModal
        variant="danger"
        isOpen={!!deleteTarget}
        title={`Delete template "${deleteTarget?.name}"?`}
        message="This deletes every phase and document defined in it. Existing projects already seeded from it are unaffected."
        onConfirm={confirmDeleteTemplate}
        onCancel={() => setDeleteTarget(null)}
      />
      <ConfirmationModal
        variant="danger"
        isOpen={!!deleteStepTarget}
        title={`Delete phase "${deleteStepTarget?.name}"?`}
        message="This also deletes every document defined under this phase."
        onConfirm={confirmDeleteStep}
        onCancel={() => setDeleteStepTarget(null)}
      />
      <ConfirmationModal
        variant="danger"
        isOpen={!!deleteDocTarget}
        title={`Delete document "${deleteDocTarget?.title}"?`}
        message="New projects created from this template will no longer include it."
        onConfirm={confirmDeleteDoc}
        onCancel={() => setDeleteDocTarget(null)}
      />
    </div>
  );
};

export default ProjectTemplateAdminSection;
