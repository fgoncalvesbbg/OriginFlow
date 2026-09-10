
/**
 * Compliance library: manage categories, requirements, attributes (with AI-assisted authoring).
 *
 * The selected category lives in `?category=` rather than component state, so a category's
 * Requirements view is linkable, refresh-safe and back-button-able without a new route —
 * `/compliance/library` (the App.tsx route) matches exactly regardless of the query string.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Layout from '../../components/Layout';
import {
  getCategories, getComplianceRequirements,
  saveRequirement, deleteRequirement, addStandardRequirements,
  getCategoryAttributes,
  getComplianceSections, addComplianceSection, deleteComplianceSection,
  getRegulations, collectBlocks,
  lockCategoryRequirements, canReleaseComplianceCategory,
  unlinkRequirementFromCategory, promoteRequirementToGlobal, setRequirementApplicability,
  getComplianceQuestions, describeQuestionCondition,
  reorderComplianceSections, reorderRequirements,
  groupRequirementsBySection, orderSectionNames, moveInList, reorderPlan, nextSortOrder,
} from '../../services';
import type { ApplySharingResult } from '../../services';
import { CategoryL3, ComplianceRequirement, CategoryAttribute, ComplianceQuestion, ComplianceSection, Regulation } from '../../types';
import {
  getAttributesForCategory, getRequirementsForCategory, getRequirementsFrozenByCategory,
  requirementShareCount, getExcludedRequirementsForCategory, requirementExclusionCount,
  finalCategoriesForRequirement,
} from '../../utils';
import { distinctL1, distinctL2, filterCategories } from '../../utils/category-tree.utils';
import RequirementHistoryModal from './RequirementHistoryModal';
import ReleaseCategoryModal from './ReleaseCategoryModal';
import ApplyRequirementsModal from './ApplyRequirementsModal';
import AddExistingRequirementsModal from './AddExistingRequirementsModal';
import RequirementExclusionsModal from './RequirementExclusionsModal';
import InlineRegulationCreator from './InlineRegulationCreator';
import { useAuth } from '../../context/AuthContext';
import { useListDnd } from '../../hooks/useListDnd';
import RequirementConditionEditor from './RequirementConditionEditor';
import TcfQuestionsManager from './TcfQuestionsManager';
// Added comment above fix: Adding missing X icon to lucide-react imports
import { Plus, Edit2, Trash2, ArrowLeft, RefreshCw, Folder, FolderOpen, Clock, Building, FileCheck, X, GitBranch, Lock, Unlock, History, Globe, Search, Scale, Ban, Link2, Unlink, Layers, ListChecks, GripVertical, ChevronUp, ChevronDown, ChevronRight, FolderInput, AlertTriangle } from 'lucide-react';

// Sentinel "category" id for the global requirements view — requirements stored with
// categoryId = null apply to every category.
const GLOBAL_VIEW = '__global__';

// The old attribute-based `describeRequirementCondition` is gone: conditions gate on TCF
// questions now (migration 174) and `describeQuestionCondition` describes them. Its one
// behavioural difference matters — it says "condition broken" when the question is missing,
// where the old version rendered a confident "attribute: has value" over a dangling id and
// so hid the very breakage it should have surfaced.

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const ConfirmationModal: React.FC<{
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  isAlert?: boolean;
}> = ({ isOpen, title, message, onConfirm, onCancel, isAlert }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-bold text-primary mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          {!isAlert && (
            <button onClick={onCancel} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded text-sm">Cancel</button>
          )}
          <button onClick={onConfirm} className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded text-sm font-medium">
            {isAlert ? 'OK' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
};

const ComplianceLibrary: React.FC = () => {
  const { user } = useAuth();
  const [categories, setCategories] = useState<CategoryL3[]>([]);
  const [requirements, setRequirements] = useState<ComplianceRequirement[]>([]);
  const [attributes, setAttributes] = useState<CategoryAttribute[]>([]);
  const [regulations, setRegulations] = useState<Regulation[]>([]);
  /** The TCF questions conditions gate on (migration 174). Library-global, not per category. */
  const [questions, setQuestions] = useState<ComplianceQuestion[]>([]);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  /**
   * Every section group in the operator's order, built-ins included (migration 175). They
   * used to be a constant merged with a table of custom names, which is exactly why the six
   * standard ones could not be moved.
   */
  const [sections, setSections] = useState<ComplianceSection[]>([]);
  /** True while a reorder is in flight, so a second drag cannot race the first. */
  const [reordering, setReordering] = useState(false);
  /**
   * The requirement list the in-progress drag belongs to. `useListDnd` reports indices into
   * "the list the props were wired to", and there is one such list per section on screen, so
   * the handler needs to know which one — held in a ref rather than state because it changes
   * during a drag and must not trigger a re-render mid-gesture.
   */
  const dragListRef = useRef<ComplianceRequirement[]>([]);
  const [newSectionInput, setNewSectionInput] = useState('');
  const [loading, setLoading] = useState(true);

  /**
   * The selected category, kept in the URL (`?category=`) rather than component state
   * (migration: compliance library category deep-link). A category view with no URL meant
   * it could not be linked to, survive a refresh, or be reached with the back button — which
   * is exactly why RegulationDetail could only send an operator to the library's index and
   * make them re-find the category by hand. `GLOBAL_VIEW`'s sentinel value round-trips
   * through the query string the same as any category id.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedCategoryForReqs = searchParams.get('category');
  const setSelectedCategoryForReqs = useCallback((id: string | null) => {
    setSearchParams(id ? { category: id } : {});
  }, [setSearchParams]);

  // Category-table filters for the requirements picker.
  const [reqSearch, setReqSearch] = useState('');
  const [reqL1, setReqL1] = useState('');
  const [reqL2, setReqL2] = useState('');
  /**
   * Which section groups are open. Starts empty and is seeded from the loaded sections once
   * they arrive — the built-in names used to come from a constant, and hard-coding them here
   * would mean a custom section always started collapsed while the six standard ones did not.
   */
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  /**
   * Collapsed groups in the category table. Starts empty — both groups open — so the table
   * reads the same as before the grouping until somebody chooses to fold one away.
   */
  const [collapsedCategoryGroups, setCollapsedCategoryGroups] = useState<Set<string>>(new Set());
  
  const [editingItem, setEditingItem] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  /**
   * FINAL lock (migration 172). `canRelease` is a UI hint that fails closed — the database
   * refuses a non-admin release regardless, so a stale `true` here costs an error message
   * rather than an unauthorised unlock, and a stale `false` only hides a button.
   */
  const [canRelease, setCanRelease] = useState(false);
  const [historyFor, setHistoryFor] = useState<{ id: string | null; name: string } | null>(null);
  const [releaseFor, setReleaseFor] = useState<CategoryL3 | null>(null);
  const [lockBusy, setLockBusy] = useState(false);

  /**
   * The open "apply to other categories" dialog (migration 173). Carries the requirement ids
   * rather than the rows, so the dialog re-plans against fresh `requirements` state after any
   * reload instead of holding a snapshot that could have gone stale.
   */
  const [shareTarget, setShareTarget] = useState<{ ids: string[]; label: string } | null>(null);
  /**
   * The section an "add from existing" dialog is pooling into, or null. Holds the section
   * NAME rather than the group object so a reload behind the open dialog cannot leave it
   * pointing at a stale list.
   */
  const [poolIntoSection, setPoolIntoSection] = useState<string | null>(null);
  /** The global requirement whose exclusion list is being edited (migration 176), or null. */
  const [exclusionsFor, setExclusionsFor] = useState<ComplianceRequirement | null>(null);
  /** True while the inline "add a regulation" form is open inside the requirement editor. */
  const [creatingRegulation, setCreatingRegulation] = useState(false);

  const [newSectionName, setNewSectionName] = useState('');

  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isAlert?: boolean;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  useEffect(() => {
    loadData();
  }, []);

  // Asked once per mount rather than per render: the answer is a role, and a role does not
  // change while somebody is editing a requirement list.
  useEffect(() => {
    let cancelled = false;
    canReleaseComplianceCategory().then(v => { if (!cancelled) setCanRelease(v); });
    return () => { cancelled = true; };
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [c, r, a, s, regs, qs] = await Promise.all([
        getCategories(), getComplianceRequirements(), getCategoryAttributes(), getComplianceSections(),
        getRegulations(), getComplianceQuestions()
      ]);
      setCategories(c);
      setRequirements(r);
      setAttributes(a);
      setSections(s);
      // Seed the open/closed state on the FIRST load only, so a reload never re-opens a
      // group the operator had collapsed.
      setExpandedSections(prev => (prev.size === 0 ? new Set(s.map(x => x.name)) : prev));
      setRegulations(regs);
      setQuestions(qs);
    } catch (error) {
      console.error("Failed to load library data", error);
    } finally {
      setLoading(false);
    }
  };

  const showAlert = (title: string, message: string) => {
    setModalState({
      isOpen: true,
      title,
      message,
      isAlert: true,
      onConfirm: () => setModalState(prev => ({ ...prev, isOpen: false }))
    });
  };

  const showConfirm = (title: string, message: string, onConfirmAction: () => Promise<void> | void) => {
    setModalState({
      isOpen: true,
      title,
      message,
      isAlert: false,
      onConfirm: async () => {
        await onConfirmAction();
        setModalState(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  // Regulations by id, so a row can name the law behind it without an N+1 lookup.
  const regulationById = useMemo(
    () => new Map(regulations.map(r => [r.id, r])),
    [regulations],
  );

  /** Regulations whose expiry is currently stopping work (migration 140). */
  const blockedRegulationIds = useMemo(
    () => new Set(collectBlocks(regulations, regulations).map(b => b.regulationId)),
    [regulations],
  );

  /**
   * Linking a requirement to a regulation carries its TCF description across, but ONLY
   * into an empty description. Overwriting text somebody wrote would be the kind of silent
   * edit that makes people stop trusting the picker — and the description is what the
   * supplier actually reads.
   */
  const applyRegulationLink = (item: any, regulationId: string | null) => {
    const reg = regulationId ? regulationById.get(regulationId) : null;
    setEditingItem({
      ...item,
      regulationId,
      // A clause belongs to one document, so changing the regulation must drop it —
      // otherwise the requirement quietly cites a clause of a different standard.
      clauseId: null,
      referenceCode: reg ? reg.referenceCode : item.referenceCode,
      description: !item.description?.trim() && reg?.tcfDescription ? reg.tcfDescription : item.description,
      title: !item.title?.trim() && reg ? reg.referenceCode : item.title,
    });
  };

  /**
   * Narrowing a requirement to one clause (migration 141). Its TCF description, when the
   * clause has one, is more specific than the regulation's and fills an empty description
   * the same way the regulation's does — never overwriting text somebody wrote.
   */
  const applyClauseLink = (item: any, clauseId: string | null) => {
    const reg = item.regulationId ? regulationById.get(item.regulationId) : null;
    const clause = clauseId ? reg?.clauses?.find(c => c.id === clauseId) : null;
    setEditingItem({
      ...item,
      clauseId,
      description: !item.description?.trim() && clause?.tcfDescription
        ? clause.tcfDescription
        : item.description,
    });
  };

  const handleSaveRequirement = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
        const item = editingItem as ComplianceRequirement;

        /**
         * The Regulation library is the central register and the TCF derives from it, so a
         * requirement must cite a source. Enforced here rather than only by a red border,
         * because a form that looks invalid and saves anyway teaches people to ignore it.
         *
         * Applied to EDITS as well as creations on purpose: that is the only version that
         * converges. Requiring it only on new rows would leave the existing unlinked ones
         * unlinked forever, and they are exactly the backlog the banner is counting.
         */
        if (!item.regulationId) {
            showAlert(
                'A regulation is required',
                'Every TCF requirement derives from something in the Regulation library — pick '
                + 'the regulation this evidence proves compliance with. If it is not in the '
                + 'library yet, use "Not listed" to add it without leaving this form.',
            );
            return;
        }
        // Global view (or an item explicitly marked global) saves with categoryId = null.
        const isGlobal = selectedCategoryForReqs === GLOBAL_VIEW || item.categoryId === null;
        const catId = isGlobal ? null : (item.categoryId || selectedCategoryForReqs);

        if (!isGlobal && !catId) throw new Error("Category ID is missing.");

        // Drop an "enabled but unset" condition (no attribute chosen) back to null.
        let condition = item.condition ?? null;
        if (condition && !condition.requires_feature && !condition.requires_feature_absent) condition = null;

        await saveRequirement({
            ...item,
            categoryId: catId,
            condition,
            id: item.id || generateUUID(),
            // A NEW requirement appends to the end of its section (migration 175). Left at
            // the column default of 0 it would tie with whatever already sits at 0 and land
            // wherever the title tiebreak put it — in the middle of an arranged list. An
            // EDIT keeps the position it already has, including when the section changes:
            // moving it is one drag, and silently sending it to the bottom would be worse.
            sortOrder: item.id
                ? item.sortOrder ?? 0
                : nextSortOrder(requirements, catId, item.section),
        });
        await persistSectionIfNew(item.section);
        setIsModalOpen(false);
        loadData();
    } catch (err: any) {
        console.error(err);
        showAlert('Error', `Error saving: ${err.message}`);
    }
  };

  /**
   * Deleting a SHARED requirement removes it from every category sharing it — there is one
   * row. The confirmation has to say so: "delete this requirement" is a very different act
   * when eleven other categories are relying on it, and the only clue on screen is a badge.
   */
  const handleDeleteRequirement = (req: ComplianceRequirement) => {
    const shared = requirementShareCount(req);
    showConfirm(
      'Delete Requirement',
      shared > 1
        ? `"${req.title}" is one requirement shared with ${shared} categories. Deleting it removes it from all ${shared}. To remove it from just one, use "stop sharing" there instead.`
        : 'Are you sure you want to delete this requirement?',
      async () => {
      try {
        await deleteRequirement(req.id);
        loadData();
      } catch (e: any) {
        console.error(e);
        showAlert('Error', `Failed to delete: ${e.message}`);
      }
    },
    );
  };

  /** Any path that opens or closes the requirement editor must reset the inline creator. */
  useEffect(() => { if (!isModalOpen) setCreatingRegulation(false); }, [isModalOpen]);

  const openAddModal = (sectionName?: string) => {
    const isGlobal = selectedCategoryForReqs === GLOBAL_VIEW;
    const catId = isGlobal ? null : (selectedCategoryForReqs || categories[0]?.id);
    if (!isGlobal && !catId) { showAlert("Notice", "No category selected"); return; }
    setEditingItem({
      categoryId: catId,
      section: sectionName || '',
      title: '', 
      description: '', 
      regulationId: null,
      isMandatory: true,
      appliesByDefault: true,
      condition: null,
      timingType: 'ETD',
      timingWeeks: 0,
      testReportOrigin: 'third_party_mandatory',
      selfDeclarationAccepted: false
    });
    setNewSectionName(sectionName || '');
    setIsModalOpen(true);
  };

  const handleEditRequirement = (req: ComplianceRequirement) => {
    setEditingItem({ 
        ...req,
        timingType: req.timingType || 'ETD',
        timingWeeks: req.timingWeeks || 0,
        testReportOrigin: req.testReportOrigin || 'third_party_mandatory',
        selfDeclarationAccepted: req.selfDeclarationAccepted || false
    });
    setNewSectionName(req.section || '');
    setIsModalOpen(true);
  };

  const handlePreloadDefaults = () => {
      if (!selectedCategoryForReqs) return;
      
      showConfirm(
        'Preload Standards',
        'This adds the two standard electrical-safety requirements — LVD and EMC — linked to '
        + 'their directives in the Regulation library. Continue?',
        async () => {
          setLoading(true);
          try {
              await addStandardRequirements(selectedCategoryForReqs);
              await loadData();
          } catch (e: any) {
              console.error(e);
              // The service explains exactly what the Regulation library is missing; a
              // generic "Failed to preload" would throw that away and leave the operator
              // with nothing to act on.
              showAlert('Could not preload', e?.message ?? 'Failed to preload.');
          } finally {
              setLoading(false);
          }
      });
  }

  /**
   * Mark the selected category's requirement set FINAL.
   *
   * Open to any signed-in user, matching the IM sign-off (migration 110): declaring a set
   * finished is normal work. It is the UNDOING that needs an administrator and a reason, and
   * the confirmation says so up front — somebody who locks a category by accident should
   * learn the cost before clicking, not after.
   */
  const handleLockCategory = (category: CategoryL3, requirementCount: number) => {
    showConfirm(
      'Mark requirements FINAL',
      `This freezes the LIST of ${requirementCount} requirement${requirementCount !== 1 ? 's' : ''} of "${category.name}". `
      + 'Nobody — including you — can then add one or remove one until an administrator releases '
      + 'the category and records why. Individual requirements can still be reworded, so a typo '
      + 'is not a reason to release it. Continue?',
      async () => {
        setLockBusy(true);
        try {
          await lockCategoryRequirements(category.id);
          await loadData();
        } catch (e: any) {
          console.error(e);
          showAlert('Could not lock', e?.message ?? 'The lock was refused.');
        } finally {
          setLockBusy(false);
        }
      },
    );
  };

  /**
   * Stop ONE category receiving a shared requirement, leaving the others alone.
   *
   * Offered from inside the category that is losing it, which is where an operator notices
   * that a shared requirement does not belong — and the confirmation names how many
   * categories keep it, so "unlink" is never mistaken for "delete".
   */
  const handleUnlink = (req: ComplianceRequirement, categoryId: string, categoryName: string) => {
    const others = requirementShareCount(req) - 1;
    showConfirm(
      'Stop sharing here',
      `"${req.title}" will no longer apply to ${categoryName}. It stays on the other `
      + `${others} categor${others !== 1 ? 'ies' : 'y'} that share it, and is not deleted.`,
      async () => {
        try {
          await unlinkRequirementFromCategory(req.id, categoryId);
          await loadData();
        } catch (e: any) {
          console.error(e);
          showAlert('Could not unshare', e?.message ?? 'The change was refused.');
        }
      },
    );
  };

  /**
   * Move a requirement within its section and persist the new order.
   *
   * `visible` is the section's list AS RENDERED — globals and shared-in requirements
   * included. That is deliberate: `sortOrder` is one number per requirement, so arranging
   * this list also arranges those requirements in every other category they appear in. Which
   * is the point ("always show the same way"), and the reason the section header says so.
   *
   * Only the rows whose number actually changes are written (`reorderPlan`), so dragging one
   * item in a list of thirty is a handful of updates rather than thirty.
   */
  const moveRequirement = async (
    visible: ComplianceRequirement[],
    from: number,
    to: number,
  ) => {
    if (reordering || from === to) return;
    const ordered = moveInList(visible, from, to);
    const plan = reorderPlan(ordered.map(r => r.id), visible);
    if (plan.length === 0) return;

    const byId = new Map(plan.map(p => [p.id, p.sortOrder]));
    const previous = requirements;
    // Optimistic, same reasoning as moveSection.
    setRequirements(prev => prev.map(r => (byId.has(r.id) ? { ...r, sortOrder: byId.get(r.id)! } : r)));
    setReordering(true);
    try {
      await reorderRequirements(plan);
      await loadData();
    } catch (e: any) {
      setRequirements(previous);
      showAlert('Could not reorder', e?.message ?? 'The new order was not saved.');
    } finally {
      setReordering(false);
    }
  };

  const sectionDnd = useListDnd((from, to) => { void moveSection(from, to); });
  const requirementDnd = useListDnd((from, to) => {
    void moveRequirement(dragListRef.current, from, to);
  });

  /**
   * Promote a requirement to the global set — it applies to every category from then on.
   *
   * The confirmation quotes the real numbers on both sides, because this is the one sharing
   * action whose blast radius is not visible on screen: the row says "Shared · 8", and after
   * this it is 135. It also says the shares are dropped, so nobody thinks the two coexist.
   */
  const handleMakeGlobal = (req: ComplianceRequirement) => {
    const shared = requirementShareCount(req);
    const total = categories.length;
    showConfirm(
      'Apply to every category',
      `"${req.title}" currently applies to ${shared} categor${shared !== 1 ? 'ies' : 'y'}. `
      + `Making it global applies it to all ${total}, including any added later, and it will be `
      + `managed under Global Requirements from now on. `
      + (shared > 1 ? `Its ${shared - 1} share${shared - 1 !== 1 ? 's' : ''} become redundant and are cleared. ` : '')
      + 'Continue?',
      async () => {
        try {
          await promoteRequirementToGlobal(req.id);
          await loadData();
        } catch (e: any) {
          console.error(e);
          showAlert('Could not make it global', e?.message ?? 'The change was refused.');
        }
      },
    );
  };

  /**
   * Mark a global requirement not applicable to this category, or applicable again
   * (migration 176).
   *
   * Excluding asks for confirmation and says what it is NOT: a per-category structural
   * decision, not "this particular product has no electronics" — that is what the request
   * wizard's questions are for, and confusing the two silently drops a requirement for
   * products that do need it. Re-applying needs no confirmation; it restores the default.
   */
  const handleSetApplicability = (
    req: ComplianceRequirement,
    categoryId: string,
    categoryName: string,
    applicable: boolean,
  ) => {
    const run = async () => {
      try {
        await setRequirementApplicability(req.id, categoryId, applicable);
        await loadData();
      } catch (e: any) {
        console.error(e);
        showAlert('Could not change applicability', e?.message ?? 'The change was refused.');
      }
    };
    if (applicable) { void run(); return; }
    showConfirm(
      'Not applicable here',
      `"${req.title}" is a global requirement. It will stop applying to ${categoryName} — `
      + 'suppliers for this category will no longer be asked for it, and it stays in place for '
      + 'every other category. '
      + 'Use this for a fact about the CATEGORY ("these products have no electronics"). If it '
      + 'depends on the individual product, gate the requirement on a TCF question instead so '
      + 'the request wizard asks per product.',
      run,
    );
  };

  /** Report a pooling in the operator's terms — it reads differently from a fan-out. */
  const handlePooled = async (result: ApplySharingResult) => {
    setPoolIntoSection(null);
    await loadData();
    const n = result.linked + result.copied;
    showAlert(
      'Added',
      n === 0
        ? 'Nothing needed adding.'
        : result.copied > 0
          ? `${result.copied} requirement${result.copied !== 1 ? 's' : ''} copied in.`
          : `${result.linked} existing requirement${result.linked !== 1 ? 's' : ''} now applies here.`,
    );
  };

  /** Report a fan-out in the operator's terms, then reload so the badges are right. */
  const handleShared = async (result: ApplySharingResult) => {
    setShareTarget(null);
    await loadData();
    const parts: string[] = [];
    if (result.linked) {
      parts.push(`${result.linked} requirement${result.linked !== 1 ? 's' : ''} shared with `
        + `${result.linkedCategories} categor${result.linkedCategories !== 1 ? 'ies' : 'y'}`);
    }
    if (result.copied) parts.push(`${result.copied} cop${result.copied !== 1 ? 'ies' : 'y'} created`);
    showAlert('Applied', parts.length ? `${parts.join(' · ')}.` : 'Nothing needed changing.');
  };

  const toggleSection = (section: string) => {
      const next = new Set(expandedSections);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      setExpandedSections(next);
  };

  /**
   * Every section name that can be offered, in the operator's order: the rows, plus any
   * legacy label a requirement still carries after its row was deleted.
   * `orderSectionNames` puts the unknown ones last, deterministically.
   */
  const availableSections = useMemo(() => {
    const used = requirements.map(r => r.section).filter(Boolean) as string[];
    return orderSectionNames([...sections.map(x => x.name), ...used], sections);
  }, [sections, requirements]);

  const knownSectionNames = useMemo(
    () => new Set(sections.map(x => x.name)),
    [sections],
  );

  // Persist a section the moment a requirement adopts it, so it shows for every category.
  const persistSectionIfNew = async (name?: string) => {
    const clean = (name || '').trim();
    if (!clean || knownSectionNames.has(clean)) return;
    await addComplianceSection(clean);
  };

  const handleAddSection = async () => {
    const clean = newSectionInput.trim();
    if (!clean) return;
    if (knownSectionNames.has(clean)) { setNewSectionInput(''); return; }
    try {
      await addComplianceSection(clean);
      setNewSectionInput('');
      await loadData();
    } catch (e: any) {
      showAlert('Error', `Failed to add section: ${e.message}`);
    }
  };

  /**
   * Move a section and persist the whole new arrangement.
   *
   * Optimistic: the list reorders immediately and rolls back if the write fails. Dragging is
   * the one interaction where a round-trip before the item moves feels broken, and a reorder
   * that silently did not save would leave the operator believing they had defined an order
   * they had not.
   */
  const moveSection = async (from: number, to: number) => {
    if (reordering || from === to) return;
    const ordered = moveInList(sections, from, to);
    const previous = sections;
    setSections(ordered.map((x, i) => ({ ...x, sortOrder: i })));
    setReordering(true);
    try {
      await reorderComplianceSections(ordered.map(x => x.name));
      await loadData();
    } catch (e: any) {
      setSections(previous);
      showAlert('Could not reorder', e?.message ?? 'The new section order was not saved.');
    } finally {
      setReordering(false);
    }
  };

  const handleDeleteSection = (name: string) => {
    showConfirm('Delete Section Group', `Remove the "${name}" section group? Requirements already using it keep their label.`, async () => {
      try {
        await deleteComplianceSection(name);
        await loadData();
      } catch (e: any) {
        showAlert('Error', `Failed to delete section: ${e.message}`);
      }
    });
  };

  const renderRequirementsView = () => {
    if (!selectedCategoryForReqs) {
      // A card grid does not survive ~130 categories, so this is a table: one row per L3
      // with its L1/L2, filtered from above. Global Requirements stays pinned as a banner
      // rather than becoming a row — it is not a category and must not sort among them.
      const globalCount = requirements.filter(r => r.categoryId == null).length;
      const l1Options = distinctL1(categories);
      const l2Options = distinctL2(categories, reqL1 || undefined);
      const visible = filterCategories(categories, {
        search: reqSearch,
        l1: reqL1 || undefined,
        l2: reqL2 || undefined,
        includeInactive: false,
      });

      /**
       * Split by FINAL, because that is the one distinction that changes what you can DO with
       * a row: an open category is work in progress, a FINAL one is frozen and needs an
       * administrator to touch. Sorting by it would bury the boundary somewhere in 135 rows;
       * two labelled, collapsible groups put it in the header.
       *
       * "Still open" leads — that is where the work is, and it is the larger group. Each group
       * keeps the tree order `filterCategories` already returns, so the sequence inside a
       * group is the same as it was before the split.
       *
       * An empty group renders nothing rather than an empty heading: with no FINAL categories
       * at all, this should look exactly like the ungrouped table.
       */
      const CATEGORY_GROUPS = [
        {
          key: 'open',
          label: 'Still open',
          hint: 'Requirements can be edited',
          icon: <FolderOpen size={13} className="text-gray-400" />,
          categories: visible.filter(c => !c.isFinalized),
        },
        {
          key: 'final',
          label: 'Marked FINAL',
          hint: 'Requirements frozen — an administrator must release the category to change them',
          icon: <Lock size={13} className="text-gray-700" />,
          categories: visible.filter(c => c.isFinalized),
        },
      ].filter(g => g.categories.length > 0);

      return (
        <div>
            <h3 className="text-lg font-bold text-gray-800 mb-4">Select a Category to Manage Requirements</h3>

            <div
                onClick={() => setSelectedCategoryForReqs(GLOBAL_VIEW)}
                className="mb-4 p-4 rounded-xl border shadow-sm cursor-pointer hover:shadow-md transition-all group flex items-center justify-between bg-amber-50 border-amber-200 hover:border-amber-400"
            >
                <div className="flex items-center gap-3">
                    <Globe size={18} className="text-amber-700" />
                    <div>
                        <h3 className="font-bold text-amber-900 group-hover:text-amber-700 transition-colors">Global Requirements</h3>
                        <p className="text-amber-700/80 text-xs mt-0.5">
                            {globalCount} Requirement{globalCount !== 1 ? 's' : ''} · applied to every category
                        </p>
                    </div>
                </div>
                <span className="text-xs font-medium text-amber-700 flex items-center gap-1">
                    Manage Global <ArrowLeft className="rotate-180" size={12} />
                </span>
            </div>

            {/* The backlog created by making the regulation link required. Counted on the
                index rather than only inside each category, because 12 rows spread over
                135 categories is a number nobody discovers by browsing. */}
            {(() => {
                const unlinked = requirements.filter(r => !r.regulationId);
                if (unlinked.length === 0) return null;
                return (
                    <div className="mb-4 p-4 rounded-xl border border-amber-200 bg-amber-50 flex items-start gap-3">
                        <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-amber-900 text-sm">
                                {unlinked.length} requirement{unlinked.length !== 1 ? 's' : ''} not derived from the Regulation library
                            </h3>
                            <p className="text-amber-800/90 text-xs mt-0.5 leading-relaxed">
                                Every requirement should cite the regulation it proves compliance with —
                                new ones now must. These predate that rule. Open each and pick its source;
                                if the source is not in the library, you can add it from the same form.
                            </p>
                            <ul className="text-[11px] text-amber-900 mt-2 flex flex-wrap gap-x-3 gap-y-1">
                                {unlinked.slice(0, 12).map(r => (
                                    <li key={r.id}>
                                        <button
                                            onClick={() => setSelectedCategoryForReqs(r.categoryId ?? GLOBAL_VIEW)}
                                            className="underline hover:no-underline font-medium"
                                            title={r.categoryId ? 'Open the category that owns it' : 'Open Global Requirements'}
                                        >
                                            {r.title}
                                        </button>
                                    </li>
                                ))}
                                {unlinked.length > 12 && <li className="text-amber-700">+{unlinked.length - 12} more</li>}
                            </ul>
                        </div>
                    </div>
                );
            })()}

            {/* The TCF questions live beside Global Requirements because they are the same
                kind of thing: library-wide, not owned by any one category. */}
            <div
                onClick={() => setQuestionsOpen(true)}
                className="mb-4 p-4 rounded-xl border shadow-sm cursor-pointer hover:shadow-md transition-all group flex items-center justify-between bg-white border-gray-200 hover:border-indigo-400"
            >
                <div className="flex items-center gap-3">
                    <ListChecks size={18} className="text-indigo-600" />
                    <div>
                        <h3 className="font-bold text-primary group-hover:text-indigo-600 transition-colors">TCF Questions</h3>
                        <p className="text-muted text-xs mt-0.5">
                            {questions.length} question{questions.length !== 1 ? 's' : ''} · what the request wizard asks to decide which conditional requirements apply
                            {questions.some(q => q.needsReview) && (
                                <span className="ml-1.5 font-bold text-amber-700">
                                    · {questions.filter(q => q.needsReview).length} need review
                                </span>
                            )}
                        </p>
                    </div>
                </div>
                <span className="text-xs font-medium text-indigo-600 flex items-center gap-1">
                    Manage <ArrowLeft className="rotate-180" size={12} />
                </span>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-200 bg-light">
                    <div className="relative flex-1 min-w-[180px]">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            value={reqSearch}
                            onChange={e => setReqSearch(e.target.value)}
                            placeholder="Search any level…"
                            className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                    </div>
                    <select
                        value={reqL1}
                        onChange={e => { setReqL1(e.target.value); setReqL2(''); }}
                        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                    >
                        <option value="">All L1</option>
                        {l1Options.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <select
                        value={reqL2}
                        onChange={e => setReqL2(e.target.value)}
                        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                    >
                        <option value="">All L2</option>
                        {l2Options.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <span className="text-xs text-muted ml-auto">{visible.length} categories</span>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-light border-b border-gray-200 text-xs uppercase tracking-wide text-muted">
                            <tr>
                                <th className="text-left font-semibold px-4 py-2.5">L1</th>
                                <th className="text-left font-semibold px-3 py-2.5">L2</th>
                                <th className="text-left font-semibold px-3 py-2.5">L3 — Category</th>
                                <th className="text-right font-semibold px-3 py-2.5">Requirements</th>
                                <th className="text-left font-semibold px-3 py-2.5">Status</th>
                                <th className="px-4 py-2.5"></th>
                            </tr>
                        </thead>
                        {CATEGORY_GROUPS.map(group => {
                          const isCollapsed = collapsedCategoryGroups.has(group.key);
                          return (
                        <tbody key={group.key} className="divide-y divide-slate-100">
                            {/* One header row per group. Clicking it collapses the group, which
                                is how you get 135 open categories out of the way to look at
                                the handful that are FINAL. */}
                            <tr
                                onClick={() => setCollapsedCategoryGroups(prev => {
                                    const next = new Set(prev);
                                    if (next.has(group.key)) next.delete(group.key); else next.add(group.key);
                                    return next;
                                })}
                                className="bg-light border-y border-gray-200 cursor-pointer hover:bg-gray-100 transition-colors"
                            >
                                <td colSpan={6} className="px-4 py-2">
                                    <span className="flex items-center gap-2">
                                        {isCollapsed
                                            ? <ChevronRight size={13} className="text-gray-400" />
                                            : <ChevronDown size={13} className="text-gray-400" />}
                                        {group.icon}
                                        <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                                            {group.label}
                                        </span>
                                        <span className="text-xs text-muted">({group.categories.length})</span>
                                        <span className="text-[11px] text-gray-400 ml-1 hidden sm:inline">
                                            · {group.hint}
                                        </span>
                                    </span>
                                </td>
                            </tr>

                            {!isCollapsed && group.categories.map(cat => {
                                // Own AND shared-in (migration 173), excluding globals — those
                                // have their own banner and counting them on every row would
                                // make all 135 rows report the same inflated number.
                                const count = getRequirementsFrozenByCategory(requirements, cat.id).length;
                                const sharedIn = requirements.filter(
                                  r => r.categoryId !== cat.id && (r.assignedCategoryIds ?? []).includes(cat.id),
                                ).length;
                                return (
                                <tr
                                    key={cat.id}
                                    onClick={() => setSelectedCategoryForReqs(cat.id)}
                                    className={`cursor-pointer transition-colors group ${cat.isFinalized ? 'bg-gray-100/70 hover:bg-gray-100' : 'hover:bg-light'}`}
                                >
                                    <td className="px-4 py-2.5 text-muted whitespace-nowrap">{cat.l1Name ?? '—'}</td>
                                    <td className="px-3 py-2.5 text-muted whitespace-nowrap">{cat.l2Name ?? '—'}</td>
                                    <td className="px-3 py-2.5 font-medium text-primary group-hover:text-indigo-600">{cat.name}</td>
                                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                                        {count || '—'}
                                        {sharedIn > 0 && (
                                            <span
                                                title={`${sharedIn} of these are shared with other categories`}
                                                className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] text-indigo-600 font-medium"
                                            >
                                                <Link2 size={9} /> {sharedIn}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2.5">
                                        {cat.isFinalized && (
                                            <span
                                                title="Requirements frozen — an administrator must release the category, with a reason, before they can change"
                                                className="inline-flex items-center gap-1 text-[10px] font-bold bg-gray-900 text-white px-1.5 py-0.5 rounded"
                                            >
                                                <Lock size={9} /> FINAL
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <ArrowLeft className="rotate-180 inline text-gray-300 group-hover:text-indigo-600" size={14} />
                                    </td>
                                </tr>
                                );
                            })}
                        </tbody>
                          );
                        })}

                        {visible.length === 0 && !loading && (
                            <tbody>
                                <tr>
                                    <td colSpan={6} className="text-center py-12 text-gray-400">
                                        {categories.length === 0 ? 'No categories found.' : 'No categories match these filters.'}
                                    </td>
                                </tr>
                            </tbody>
                        )}
                    </table>
                </div>
            </div>
        </div>
      );
    }

    const isGlobalView = selectedCategoryForReqs === GLOBAL_VIEW;
    const category = isGlobalView ? null : categories.find(c => c.id === selectedCategoryForReqs);
    const globalReqs = requirements.filter(r => r.categoryId == null);
    // In a category view: globals (read-only here), the category's own, and the ones SHARED
    // with it (migration 173) — one rule, in getRequirementsForCategory, so this list and the
    // supplier's request cannot disagree about what the category requires.
    const catReqs = isGlobalView
        ? globalReqs
        : getRequirementsForCategory(requirements, selectedCategoryForReqs!);

    /**
     * Sections and their requirements, both in the operator's defined order (migration 175),
     * through the one shared rule the supplier portal and the PDF also use.
     *
     * `includeEmptySections` is on here and nowhere else: an author needs to see a group with
     * nothing in it, because that is where they are about to file something.
     */
    /**
     * Requirements marked NOT APPLICABLE to this category (migration 176). Included in the
     * library's grouping and rendered struck through, because a global requirement vanishes
     * from the list once excluded — and a state you cannot see is a state you cannot undo.
     * No other surface shows these.
     */
    const excludedHere = isGlobalView
        ? []
        : getExcludedRequirementsForCategory(requirements, selectedCategoryForReqs!);
    const excludedIds = new Set(excludedHere.map(r => r.id));

    const sectionGroups = groupRequirementsBySection(
        [...catReqs, ...excludedHere],
        sections,
        { includeEmptySections: true },
    );

    /**
     * FINAL lock (migration 172). Named `categoryLocked` and not `isLocked` because the row
     * renderer below already owns `isLocked` for a different fact — that a GLOBAL requirement
     * is read-only inside a category view. The two are unrelated and both are true at once for
     * a global row in a locked category.
     *
     * The global view is never locked: global requirements belong to no category, so no
     * category's lock reaches them (see the migration header).
     */
    const categoryLocked = !isGlobalView && !!category?.isFinalized;
    /**
     * What the lock actually freezes: the category's own requirements AND the ones shared
     * with it. Globals are excluded (no category's lock reaches them), shared ones are
     * included (the guard refuses to let them change while this category is FINAL) — so the
     * number the banner quotes is the number that is genuinely frozen.
     */
    const frozenReqs = isGlobalView
      ? []
      : getRequirementsFrozenByCategory(requirements, selectedCategoryForReqs!);
    const ownReqCount = frozenReqs.length;
    /** The category's OWN rows — the set the "apply to other categories" button fans out. */
    const ownReqs = isGlobalView
      ? []
      : requirements.filter(r => r.categoryId === selectedCategoryForReqs);

    return (
      <div>
        <button 
          onClick={() => setSelectedCategoryForReqs(null)} 
          className="mb-6 text-sm text-muted hover:text-gray-800 flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-gray-100 w-fit"
        >
          <ArrowLeft size={16} /> Back to Categories
        </button>

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <div>
            <h3 className="text-2xl font-bold text-primary flex items-center gap-3">
              {isGlobalView ? <><Globe size={22} className="text-amber-500" /> Global Requirements</> : category?.name}
              {category?.isFinalized && (
                <span title="FINAL — requirements frozen">
                  <Lock className="text-gray-900" size={18} />
                </span>
              )}
            </h3>
            <p className="text-muted text-sm">
              {isGlobalView
                ? 'These requirements apply to every category and appear locked in each one.'
                : 'Managing requirements for this category.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* History is available whatever the lock state — a frozen set is the one people
                most often need to account for, and reading the record changes nothing. */}
            <button
              onClick={() => setHistoryFor({
                id: isGlobalView ? null : selectedCategoryForReqs,
                name: isGlobalView ? 'Global Requirements' : (category?.name ?? 'Category'),
              })}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-light text-sm font-medium shadow"
              title="Who changed what, and when"
            >
              <History size={16} /> History
            </button>

            {/* The family operation: take this category's own set and put it on its siblings.
                Offered whenever there is something to fan out, and disabled-by-absence when
                the category is locked — a frozen set has nothing to give that it could also
                still change. */}
            {!isGlobalView && category && !categoryLocked && ownReqs.length > 0 && (
              <button
                onClick={() => setShareTarget({
                  ids: ownReqs.map(r => r.id),
                  label: `${ownReqs.length} requirement${ownReqs.length !== 1 ? 's' : ''} from ${category.name}`,
                })}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-indigo-300 text-indigo-700 rounded-md hover:bg-indigo-50 text-sm font-medium shadow"
                title="Link or copy this whole set to other categories"
              >
                <Layers size={16} /> Apply to categories…
              </button>
            )}

            {!isGlobalView && category && !categoryLocked && (
              <>
                <button
                  onClick={handlePreloadDefaults}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-light text-sm font-medium shadow"
                  title="Add standard template requirements"
                >
                  <RefreshCw size={16} /> Preload Standard
                </button>
                <button
                  onClick={() => handleLockCategory(category, ownReqCount)}
                  disabled={lockBusy}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-800 text-gray-800 rounded-md hover:bg-gray-800 hover:text-white disabled:opacity-40 text-sm font-medium shadow transition-colors"
                  title="Freeze this category's requirements"
                >
                  <Lock size={16} /> Mark FINAL
                </button>
              </>
            )}

            {!categoryLocked && (
              <button
                onClick={() => openAddModal()}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium shadow"
              >
                <Plus size={16} /> Add {isGlobalView ? 'Global ' : ''}Requirement
              </button>
            )}
          </div>
        </div>

        {/* The lock, stated plainly. A frozen screen whose buttons have simply vanished is
            the failure mode this banner exists to prevent — it says what is frozen, who
            froze it, when, and exactly what has to happen for it to change. */}
        {categoryLocked && category && (
          <div className="mb-6 rounded-xl border border-gray-800 bg-gray-900 text-white p-4 flex flex-col sm:flex-row sm:items-center gap-4">
            <Lock size={20} className="flex-shrink-0 text-white/70" />
            <div className="flex-1">
              <p className="font-bold text-sm">
                Marked FINAL — this list of {ownReqCount} requirement{ownReqCount !== 1 ? 's' : ''} is frozen
              </p>
              <p className="text-xs text-white/70 mt-0.5 leading-relaxed">
                {category.finalizedBy
                  ? <>Locked by {category.finalizedBy}{category.finalizedAt ? ` on ${new Date(category.finalizedAt).toLocaleDateString()}` : ''}. </>
                  : category.finalizedAt
                    ? <>Locked on {new Date(category.finalizedAt).toLocaleDateString()}. </>
                    : null}
                Nothing can be added or removed. Individual requirements can still be
                reworded — their timing and evidence rules too — which applies wherever else
                they are used.{' '}
                {canRelease
                  ? 'Release the category — stating why — to change the list itself. The reason goes on the record.'
                  : 'An administrator must release it, and record why, before the list itself can change.'}
              </p>
            </div>
            {canRelease && (
              <button
                onClick={() => setReleaseFor(category)}
                className="flex items-center gap-2 px-4 py-2 bg-white text-gray-900 rounded-md hover:bg-amber-100 text-sm font-medium flex-shrink-0"
              >
                <Unlock size={15} /> Release for editing
              </button>
            )}
          </div>
        )}

        {/* Section group management. The list is ORDERED and the order is what every screen
            renders by (migration 175) — so this panel is a vertical list with handles rather
            than the wrapped row of chips it was, because you cannot express a sequence in a
            wrapping row. Drag to arrange, or use the arrows. */}
        <div className="bg-light border border-gray-200 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Section Groups</span>
            <span className="text-[11px] text-muted">
              This order applies everywhere — the library, the supplier portal and the PDF
            </span>
          </div>

          <ul className="space-y-1 mb-3">
            {sections.map((sec, i) => (
              <li
                key={sec.name}
                {...sectionDnd.dropProps(i)}
                className={`flex items-center gap-2 bg-white border rounded-lg px-2.5 py-1.5 transition-colors ${
                  sectionDnd.overIndex === i && sectionDnd.dragIndex !== i
                    ? 'border-indigo-400 bg-indigo-50/60'
                    : 'border-gray-200'
                } ${sectionDnd.dragIndex === i ? 'opacity-40' : ''}`}
              >
                <span
                  {...sectionDnd.handleProps(i)}
                  className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500"
                  title="Drag to reorder"
                >
                  <GripVertical size={14} />
                </span>
                <span className="text-xs text-gray-700 flex-1">{sec.name}</span>
                {sec.isBuiltIn && (
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide">standard</span>
                )}
                <span className="flex items-center">
                  <button
                    type="button"
                    onClick={() => moveSection(i, i - 1)}
                    disabled={i === 0 || reordering}
                    className="p-1 text-gray-300 hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-gray-300"
                    title="Move up"
                  >
                    <ChevronUp size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSection(i, i + 1)}
                    disabled={i === sections.length - 1 || reordering}
                    className="p-1 text-gray-300 hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-gray-300"
                    title="Move down"
                  >
                    <ChevronDown size={13} />
                  </button>
                </span>
                {/* No delete for the six standard sections, matching the behaviour from when
                    they were a constant and deleting one was not expressible. */}
                {!sec.isBuiltIn && (
                  <button type="button" onClick={() => handleDeleteSection(sec.name)} className="p-1 text-gray-300 hover:text-rose-600" title="Delete section group">
                    <X size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>

          {/* A label a requirement still carries after its section row was deleted. Shown so
              the requirement is findable, and offered as a section you can re-create. */}
          {availableSections.filter(n => !knownSectionNames.has(n)).map(n => (
            <div key={n} className="flex items-center gap-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-1">
              <span className="flex-1">"{n}" is used by a requirement but is not a section group — it sorts last.</span>
              <button
                type="button"
                onClick={async () => { await addComplianceSection(n); await loadData(); }}
                className="font-medium text-indigo-600 hover:underline"
              >
                Add it
              </button>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <input
                type="text"
                placeholder="New section group…"
                value={newSectionInput}
                onChange={e => setNewSectionInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddSection(); } }}
                className="border border-gray-300 rounded-md px-2 py-1 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
              />
              <button type="button" onClick={handleAddSection} disabled={!newSectionInput.trim()}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-40 font-medium">
                <Plus size={12} /> Add
              </button>
            </span>
          </div>
        </div>

        <div className="space-y-6">
          {(
            sectionGroups.map(({ section, requirements: items }) => {
                const isExpanded = expandedSections.has(section);
                /**
                 * Reordering is offered only where it means something: a list of two or more,
                 * and not in a category whose requirements are frozen (migration 172).
                 */
                const canReorder = !categoryLocked && items.length > 1;
                return (
                    <div key={section} className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow">
                        <div 
                            className="bg-light px-5 py-3 border-b border-gray-200 flex justify-between items-center cursor-pointer hover:bg-gray-100 transition-colors"
                            onClick={() => toggleSection(section)}
                        >
                            <div className="flex items-center gap-2">
                                {isExpanded ? <FolderOpen size={18} className="text-indigo-500" /> : <Folder size={18} className="text-gray-400" />}
                                <h4 className="font-bold text-gray-700 text-sm uppercase tracking-wide">{section}</h4>
                                <span className="text-xs text-gray-400 ml-1">({items.length})</span>
                                {/* Arranging this list also arranges these requirements
                                    wherever else they appear, because sortOrder is one number
                                    per requirement. Said out loud rather than discovered. */}
                                {canReorder && items.some(r => r.categoryId == null || (r.assignedCategoryIds ?? []).length > 0) && (
                                    <span className="text-[10px] text-muted ml-1" title="Global and shared requirements hold one position across every category">
                                        · order applies in every category
                                    </span>
                                )}
                            </div>
                            {!categoryLocked && (
                            <span className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                                {/* Pooling from the library is offered FIRST, and only in a
                                    category view. Reaching for "new" when the requirement
                                    already exists elsewhere is how a library grows three
                                    spellings of "RoHS test report". */}
                                {!isGlobalView && (
                                <button
                                    onClick={() => setPoolIntoSection(section)}
                                    className="text-xs flex items-center gap-1 bg-white border border-gray-300 px-2 py-1 rounded text-indigo-600 hover:bg-indigo-50 font-medium"
                                    title="Pick requirements that already exist elsewhere in the library"
                                >
                                    <FolderInput size={14} /> Add Existing
                                </button>
                                )}
                                <button
                                    onClick={() => openAddModal(section)}
                                    className="text-xs flex items-center gap-1 bg-white border border-gray-300 px-2 py-1 rounded text-gray-600 hover:bg-light font-medium"
                                    title="Write a new requirement"
                                >
                                    <Plus size={14} /> New
                                </button>
                            </span>
                            )}
                        </div>
                        
                        {isExpanded && (
                            <div className="divide-y divide-slate-100">
                                {items.length === 0 && (
                                    <div className="px-5 py-4 text-xs text-gray-400">No requirements in this section yet.</div>
                                )}
                                {items.map((r, rowIndex) => {
                                const isLocked = !isGlobalView && r.categoryId == null;
                                /**
                                 * Sharing (migration 173). `shareCount` counts the home category
                                 * too, so 1 means unshared and 0 means global.
                                 *
                                 * `isBorrowed` is the case worth distinguishing in the UI: this
                                 * category SEES the requirement but does not own it. Editing it
                                 * here would change it for every other category that shares it,
                                 * so the row offers "stop sharing here" and sends the edit to the
                                 * owning category rather than pretending it is local.
                                 */
                                const shareCount = requirementShareCount(r);
                                const isShared = shareCount > 1;
                                /** Marked not applicable to the category being viewed. */
                                const isExcludedHere = excludedIds.has(r.id);
                                const isBorrowed = !isGlobalView && r.categoryId != null
                                    && r.categoryId !== selectedCategoryForReqs;
                                const ownerName = isBorrowed
                                    ? (categories.find(c => c.id === r.categoryId)?.name ?? 'another category')
                                    : null;
                                return (
                                <div
                                    key={r.id}
                                    {...(canReorder ? requirementDnd.dropProps(rowIndex) : {})}
                                    onDragEnter={canReorder ? () => { dragListRef.current = items; } : undefined}
                                    className={`p-5 transition-colors group ${
                                        isExcludedHere ? 'bg-gray-50' : 'bg-white hover:bg-light'
                                    } ${
                                        canReorder && requirementDnd.overIndex === rowIndex && requirementDnd.dragIndex !== rowIndex
                                            ? 'ring-2 ring-inset ring-indigo-400'
                                            : ''
                                    } ${canReorder && requirementDnd.dragIndex === rowIndex ? 'opacity-40' : ''}`}
                                >
                                    <div className="flex justify-between items-start gap-4">
                                    {canReorder && (
                                        <div className="flex flex-col items-center pt-0.5 flex-shrink-0">
                                            <span
                                                {...requirementDnd.handleProps(rowIndex)}
                                                onMouseDown={() => { dragListRef.current = items; }}
                                                className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500"
                                                title="Drag to reorder"
                                            >
                                                <GripVertical size={14} />
                                            </span>
                                            {/* Arrows as the accessible fallback — the same pairing
                                                useListDnd was written for in the IM editor. */}
                                            <button
                                                type="button"
                                                onClick={() => moveRequirement(items, rowIndex, rowIndex - 1)}
                                                disabled={rowIndex === 0 || reordering}
                                                className="text-gray-300 hover:text-indigo-600 disabled:opacity-0"
                                                title="Move up"
                                            >
                                                <ChevronUp size={12} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => moveRequirement(items, rowIndex, rowIndex + 1)}
                                                disabled={rowIndex === items.length - 1 || reordering}
                                                className="text-gray-300 hover:text-indigo-600 disabled:opacity-0"
                                                title="Move down"
                                            >
                                                <ChevronDown size={12} />
                                            </button>
                                        </div>
                                    )}
                                    <div className="flex-1">
                                        <div className="flex items-center gap-3 mb-1">
                                        <h4 className={`font-bold text-sm ${isExcludedHere ? 'text-gray-400 line-through' : 'text-primary'}`}>{r.title}</h4>
                                        {isExcludedHere && (
                                            <span
                                                title="Marked not applicable to this category — suppliers here are not asked for it"
                                                className="inline-flex items-center gap-1 bg-gray-200 text-gray-600 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide"
                                            >
                                                <Ban size={10} /> Not applicable here
                                            </span>
                                        )}
                                        {r.isMandatory && <span className="bg-rose-100 text-rose-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide">Mandatory</span>}
                                        {r.categoryId == null && <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide"><Globe size={10} /> Global</span>}
                                        {/* In the Global view, how many categories this global
                                            requirement is NOT asked for in (migration 176). */}
                                        {isGlobalView && requirementExclusionCount(r) > 0 && (
                                            <button
                                                onClick={() => setExclusionsFor(r)}
                                                title="Categories this requirement is not applicable to"
                                                className="inline-flex items-center gap-1 bg-gray-200 text-gray-700 hover:bg-gray-300 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide"
                                            >
                                                <Ban size={10} /> Not in {requirementExclusionCount(r)}
                                            </button>
                                        )}
                                        {/* Not derived from anything in the Regulation library.
                                            A visible backlog rather than a silent state: these
                                            rows predate the rule and each one needs a source
                                            naming, which the editor now insists on. */}
                                        {!r.regulationId && (
                                            <span
                                                title="Not linked to the Regulation library — open it and pick the regulation it derives from"
                                                className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide"
                                            >
                                                <AlertTriangle size={10} /> No regulation
                                            </span>
                                        )}
                                        {isShared && (
                                            <span
                                                title={`One requirement shared with ${shareCount} categories — editing it changes all of them`}
                                                className="inline-flex items-center gap-1 bg-indigo-100 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide"
                                            >
                                                <Link2 size={10} /> Shared · {shareCount}
                                            </span>
                                        )}
                                        {isBorrowed && (
                                            <span className="text-[10px] text-muted">from {ownerName}</span>
                                        )}
                                        {isLocked && <span className="inline-flex items-center gap-1 text-gray-400 text-[10px] font-bold px-1.5 py-0.5 uppercase tracking-wide"><Lock size={10} /> Locked</span>}
                                        </div>
                                        {/* The law behind the ask (migration 139). Internal only —
                                            the supplier portal renders none of this. */}
                                        {(() => {
                                            const reg = r.regulationId ? regulationById.get(r.regulationId) : null;
                                            if (!reg) return null;
                                            const edition = [reg.version, reg.editionYear ? String(reg.editionYear) : ''].filter(Boolean).join(' · ');
                                            return (
                                                <div className="flex flex-wrap items-center gap-2 mb-2 text-[10px]">
                                                    <Link
                                                        to={`/regulations/${reg.id}`}
                                                        className="inline-flex items-center gap-1 font-mono font-bold text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded hover:bg-sky-100"
                                                        title={reg.title}
                                                    >
                                                        <Scale size={10} /> {reg.referenceCode}
                                                        {(() => {
                                                            const clause = r.clauseId
                                                                ? reg.clauses?.find(c => c.id === r.clauseId)
                                                                : null;
                                                            return clause
                                                                ? <span className="text-sky-500">§{clause.number}</span>
                                                                : null;
                                                        })()}
                                                    </Link>
                                                    {edition && <span className="text-gray-400">{edition}</span>}
                                                    {reg.lastAmendedAt && <span className="text-gray-400">last change {reg.lastAmendedAt}</span>}
                                                    {reg.versionState === 'newer_available' && (
                                                        <span className="font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                                                            Newer version available
                                                        </span>
                                                    )}
                                                    {reg.versionState === 'repealed' && reg.status !== 'expired' && (
                                                        <span className="font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                                                            Repealed on EUR-Lex
                                                        </span>
                                                    )}
                                                    {/* Expiry is OUR decision and it stops work, so it outranks the
                                                        EUR-Lex verdict in the row rather than sitting beside it. */}
                                                    {reg.status === 'expired' && (
                                                        <span className={`font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${
                                                            blockedRegulationIds.has(reg.id)
                                                                ? 'bg-rose-600 text-white'
                                                                : 'text-amber-800 bg-amber-50 border border-amber-200'
                                                        }`}>
                                                            <Ban size={9} />
                                                            {blockedRegulationIds.has(reg.id)
                                                                ? 'Expired — blocking new requests'
                                                                : 'Expired, replaced'}
                                                        </span>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                        <p className="text-gray-600 text-xs leading-relaxed mb-3">{r.description}</p>
                                        
                                        <div className="bg-light p-2.5 rounded-xl border border-gray-100 flex flex-wrap gap-x-6 gap-y-2 items-center">
                                            <div className="flex items-center gap-1.5 min-w-[120px]">
                                                <Clock size={12} className="text-gray-400" />
                                                <div className="flex flex-col">
                                                    <span className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter leading-none">Timing</span>
                                                    <span className="text-[10px] font-bold text-gray-700">{r.timingType === 'POST_ETD' ? `ETD + ${r.timingWeeks}w` : 'At ETD'}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1.5 min-w-[140px]">
                                                <Building size={12} className="text-gray-400" />
                                                <div className="flex flex-col">
                                                    <span className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter leading-none">Origin</span>
                                                    <span className="text-[10px] font-bold text-gray-700">{r.testReportOrigin === 'supplier_inhouse' ? 'In-House Accepted' : '3rd Party Lab Only'}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1.5 min-w-[140px]">
                                                <FileCheck size={12} className="text-gray-400" />
                                                <div className="flex flex-col">
                                                    <span className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter leading-none">Declaration</span>
                                                    <span className="text-[10px] font-bold text-gray-700">{r.selfDeclarationAccepted ? 'Accepted' : 'Report Mandatory'}</span>
                                                </div>
                                            </div>

                                            {(() => {
                                                const desc = describeQuestionCondition(r.condition, questions);
                                                if (!desc) return null;
                                                return (
                                                    <div className="flex items-center gap-1.5 min-w-[160px]">
                                                        <GitBranch size={12} className="text-indigo-500" />
                                                        <div className="flex flex-col">
                                                            <span className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter leading-none">Applies If</span>
                                                            <span className="text-[10px] font-bold text-indigo-700">{desc}</span>
                                                        </div>
                                                    </div>
                                                );
                                            })()}

                                        </div>
                                    </div>
                                    
                                    {/* Order matters. A GLOBAL row inside a locked category is not
                                        frozen by that lock — it is edited in the Global view, and
                                        saying "Frozen" here would send somebody to an administrator
                                        for a release that would not have unlocked it anyway. */}
                                    {isLocked ? (
                                        /* A GLOBAL requirement seen from inside a category. Its
                                           TEXT is edited in the Global view — one row, shown
                                           everywhere — but whether it APPLIES here is this
                                           category's own decision (migration 176), so that
                                           control belongs on this screen and nowhere else. */
                                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                            {!categoryLocked && category && (
                                                isExcludedHere ? (
                                                    <button
                                                        onClick={() => handleSetApplicability(r, category.id, category.name, true)}
                                                        className="text-[10px] font-medium text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded whitespace-nowrap flex items-center gap-1"
                                                        title="Apply this global requirement to this category again"
                                                    >
                                                        <RefreshCw size={11} /> Re-apply here
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleSetApplicability(r, category.id, category.name, false)}
                                                        className="text-[10px] font-medium text-gray-500 hover:text-rose-600 hover:bg-rose-50 px-2 py-1 rounded whitespace-nowrap flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                                        title="This category never needs this requirement"
                                                    >
                                                        <Ban size={11} /> Not applicable here
                                                    </button>
                                                )
                                            )}
                                            <span className="flex items-center gap-1 text-[10px] text-gray-400 whitespace-nowrap" title="Managed in Global Requirements">
                                                <Lock size={12} /> Edit in Global
                                            </span>
                                        </div>
                                    ) : categoryLocked ? (
                                        /* FINAL freezes the LIST, not the wording (migration 177).
                                           So editing is offered here; adding, deleting, sharing
                                           and promoting are not, because each of those changes
                                           what this category requires. */
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                            <button
                                                onClick={() => handleEditRequirement(r)}
                                                className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors"
                                                title="Edit the wording, timing or evidence rules — allowed even though this category is FINAL"
                                            >
                                                <Edit2 size={14} />
                                            </button>
                                            <span
                                                className="flex items-center gap-1 text-[10px] text-gray-500 whitespace-nowrap"
                                                title="This category is FINAL: nothing can be added to or removed from its requirement list until an administrator releases it"
                                            >
                                                <Lock size={12} /> List frozen
                                            </span>
                                        </div>
                                    ) : isBorrowed ? (
                                        /* Shared IN from another category. Editing is offered where the
                                           requirement lives, because an edit made here silently rewrites
                                           it for every other category sharing it — and the operator
                                           should be looking at that list when they decide. Unsharing is
                                           local, so it belongs here. */
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                            <button
                                                onClick={() => setSelectedCategoryForReqs(r.categoryId)}
                                                className="text-[10px] font-medium text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded whitespace-nowrap"
                                                title={`Edit it in ${ownerName}, where it is owned`}
                                            >
                                                Edit in {ownerName}
                                            </button>
                                            <button
                                                onClick={() => handleUnlink(r, selectedCategoryForReqs!, category?.name ?? 'this category')}
                                                className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-full transition-colors"
                                                title="Stop sharing this requirement with this category"
                                            >
                                                <Unlink size={14} />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            {isGlobalView && (
                                                <button
                                                onClick={() => setExclusionsFor(r)}
                                                className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-full transition-colors"
                                                title="Mark categories this requirement does not apply to"
                                                >
                                                <Ban size={14} />
                                                </button>
                                            )}
                                            {!isGlobalView && (
                                                <>
                                                <button
                                                onClick={() => setShareTarget({ ids: [r.id], label: r.title })}
                                                className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors"
                                                title="Apply this requirement to other categories"
                                                >
                                                <Link2 size={14} />
                                                </button>
                                                {/* Promote to the global set. Only offered by the
                                                    owning category — the same rule as editing. */}
                                                <button
                                                onClick={() => handleMakeGlobal(r)}
                                                className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-full transition-colors"
                                                title="Apply to EVERY category (move it to Global Requirements)"
                                                >
                                                <Globe size={14} />
                                                </button>
                                                </>
                                            )}
                                            <button
                                            onClick={() => handleEditRequirement(r)}
                                            className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors"
                                            title={isShared ? `Edits apply to all ${shareCount} categories sharing this` : 'Edit'}
                                            >
                                            <Edit2 size={14} />
                                            </button>
                                            <button
                                            onClick={() => handleDeleteRequirement(r)}
                                            className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-full transition-colors"
                                            title={isShared ? `Deletes it from all ${shareCount} categories sharing this` : 'Delete'}
                                            >
                                            <Trash2 size={14} />
                                            </button>
                                        </div>
                                    )}
                                    </div>
                                </div>
                                );
                                })}
                            </div>
                        )}
                    </div>
                );
            })
          )}
        </div>
      </div>
    );
  };

  return (
    <Layout>
      <ConfirmationModal
        isOpen={modalState.isOpen}
        title={modalState.title}
        message={modalState.message}
        onConfirm={modalState.onConfirm}
        onCancel={() => setModalState(prev => ({ ...prev, isOpen: false }))}
        isAlert={modalState.isAlert}
      />

      <div className="mb-6">
        <h1 className="text-3xl font-bold text-primary">Compliance Library</h1>
        <p className="text-muted">Manage regulatory requirements for your product categories.</p>
      </div>

      <div className="bg-white rounded-xl shadow border border-gray-200 p-6 min-h-[400px]">
        {loading ? <div>Loading...</div> : renderRequirementsView()}
      </div>


      {questionsOpen && (
        <TcfQuestionsManager
          questions={questions}
          requirements={requirements}
          onClose={() => setQuestionsOpen(false)}
          onChanged={loadData}
        />
      )}

      {historyFor && (
        <RequirementHistoryModal
          categoryId={historyFor.id}
          categoryName={historyFor.name}
          regulations={regulations}
          categories={categories}
          onClose={() => setHistoryFor(null)}
        />
      )}

      {releaseFor && (
        <ReleaseCategoryModal
          categoryId={releaseFor.id}
          categoryName={releaseFor.name}
          /* The frozen set, not just the owned rows — a shared requirement is frozen by
             this category's lock too, so it is part of what the release unfreezes. */
          requirementCount={getRequirementsFrozenByCategory(requirements, releaseFor.id).length}
          onClose={() => setReleaseFor(null)}
          onReleased={() => { setReleaseFor(null); loadData(); }}
        />
      )}

      {exclusionsFor && (
        <RequirementExclusionsModal
          requirement={exclusionsFor}
          categories={categories}
          onClose={() => setExclusionsFor(null)}
          onSaved={async () => { setExclusionsFor(null); await loadData(); }}
        />
      )}

      {poolIntoSection && selectedCategoryForReqs && selectedCategoryForReqs !== GLOBAL_VIEW && (
        <AddExistingRequirementsModal
          requirements={requirements}
          categories={categories}
          targetCategoryId={selectedCategoryForReqs}
          targetCategoryName={categories.find(c => c.id === selectedCategoryForReqs)?.name ?? 'this category'}
          targetSection={poolIntoSection}
          onClose={() => setPoolIntoSection(null)}
          onAdded={handlePooled}
        />
      )}

      {shareTarget && selectedCategoryForReqs && selectedCategoryForReqs !== GLOBAL_VIEW && (
        <ApplyRequirementsModal
          requirementIds={shareTarget.ids}
          requirements={requirements}
          categories={categories}
          sourceCategoryId={selectedCategoryForReqs}
          subjectLabel={shareTarget.label}
          onClose={() => setShareTarget(null)}
          onApplied={handleShared}
        />
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl animate-in fade-in zoom-in duration-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-light px-6 py-4 border-b border-gray-200 flex justify-between items-center flex-shrink-0">
               <h3 className="font-bold text-lg text-gray-800 capitalize">
                 {editingItem.id ? 'Edit' : 'Add'} Requirement
               </h3>
               <span className={`text-xs px-2 py-1 rounded font-medium ${(editingItem.categoryId == null) ? 'bg-amber-100 text-amber-800 inline-flex items-center gap-1' : 'bg-indigo-100 text-blue-800'}`}>
                   {editingItem.categoryId == null
                     ? <><Globe size={12} /> Global · All Categories</>
                     : (categories.find(c => c.id === editingItem.categoryId)?.name || 'No Category')}
               </span>
            </div>
            
            <div className="overflow-y-auto p-6 flex-1">
            <form id="reqForm" onSubmit={handleSaveRequirement} className="space-y-5">

              {/* Editing the DEFINITION of a requirement held by a FINAL category is allowed
                  (migration 177) — the lock freezes which requirements a category has, not
                  their wording. It is not silent, though: the categories whose signed-off set
                  is about to be reworded are named, because that is the fact the operator
                  needs and cannot see from this form. */}
              {(() => {
                if (!editingItem.id) return null;
                const finals = finalCategoriesForRequirement(editingItem, categories);
                if (finals.length === 0) return null;
                return (
                  <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 flex gap-2.5">
                    <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-900 leading-relaxed">
                      <p className="font-bold">
                        Used by {finals.length} categor{finals.length !== 1 ? 'ies' : 'y'} marked FINAL
                      </p>
                      <p className="mt-0.5">
                        {finals.map(c => c.name).join(', ')} {finals.length !== 1 ? 'have' : 'has'} a
                        signed-off requirement set. Your changes to the wording, timing or evidence
                        rules apply there too, and to any open supplier request that already carries
                        this requirement. What each category REQUIRES does not change — only how it
                        is described.
                      </p>
                    </div>
                  </div>
                );
              })()}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Section Group</label>
                <div className="flex gap-2">
                    <select 
                        className="flex-1 border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={editingItem.section || ''}
                        onChange={e => {
                            setEditingItem({...editingItem, section: e.target.value});
                            setNewSectionName(e.target.value);
                        }}
                    >
                        <option value="">-- Select or Type New --</option>
                        {availableSections.map(s => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                    <input 
                        type="text" 
                        placeholder="Or Type New Section Name"
                        className="flex-1 border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={newSectionName}
                        onChange={e => {
                            setNewSectionName(e.target.value);
                            setEditingItem({...editingItem, section: e.target.value});
                        }}
                    />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Requirement Title</label>
                <input 
                  placeholder="e.g. Power Cord Safety" 
                  required 
                  className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none" 
                  value={editingItem.title} 
                  onChange={e => setEditingItem({...editingItem, title: e.target.value})} 
                />
              </div>
              
              {/* The regulation behind this requirement.
                  REQUIRED as of this change. The Regulation library is the central register
                  and the TCF is derived from it, so a requirement has to cite a source. That
                  rule only works because the source can be added from right here — see
                  InlineRegulationCreator — otherwise people would leave it unset, which is
                  exactly the state this replaces. (Migration 139 originally left it optional
                  on the grounds that a BOM has no law behind it; the decision has been
                  reversed deliberately — a BOM is demanded by a technical-documentation
                  annex, and naming which one is the point.) */}
              <div className="bg-sky-50/50 border border-sky-200 p-4 rounded-xl space-y-2">
                <label className="block text-sm font-medium text-sky-900 mb-1 flex items-center gap-1.5">
                  <Scale size={14} /> Regulation <span className="text-rose-600">*</span>
                </label>
                <div className="flex gap-2">
                  <select
                    className={`flex-1 border p-2.5 rounded-md text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none ${
                      editingItem.regulationId ? 'border-gray-300' : 'border-rose-300'
                    }`}
                    value={editingItem.regulationId || ''}
                    onChange={e => applyRegulationLink(editingItem, e.target.value || null)}
                  >
                    <option value="">— select the regulation this derives from —</option>
                    {regulations.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.referenceCode} — {r.title.length > 70 ? `${r.title.slice(0, 70)}…` : r.title}
                        {r.status === 'superseded' ? ' (superseded)' : ''}
                      </option>
                    ))}
                  </select>
                  {!creatingRegulation && (
                    <button
                      type="button"
                      onClick={() => setCreatingRegulation(true)}
                      className="px-3 py-2 bg-white border border-sky-300 text-sky-800 rounded-md text-xs font-medium hover:bg-sky-50 whitespace-nowrap flex items-center gap-1"
                      title="The regulation is not in the library yet"
                    >
                      <Plus size={13} /> Not listed
                    </button>
                  )}
                </div>

                {creatingRegulation && (
                  <InlineRegulationCreator
                    actor={user?.name}
                    onCancel={() => setCreatingRegulation(false)}
                    onCreated={async created => {
                      // Reload so the new entry is in `regulations`, then select it — the
                      // link also carries the regulation's TCF description into an empty
                      // description, which is why it goes through applyRegulationLink.
                      setCreatingRegulation(false);
                      await loadData();
                      applyRegulationLink(editingItem, created.id);
                    }}
                  />
                )}
                {(() => {
                  const reg = editingItem.regulationId ? regulationById.get(editingItem.regulationId) : null;
                  const clauses = reg?.clauses ?? [];
                  if (reg && clauses.length > 0) {
                    return (
                      <div>
                        <label className="block text-[11px] font-semibold text-sky-900 mb-1 mt-2">
                          Narrow to a clause (optional)
                        </label>
                        <select
                          className="w-full border border-gray-300 p-2 rounded-md text-xs bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                          value={editingItem.clauseId || ''}
                          onChange={e => applyClauseLink(editingItem, e.target.value || null)}
                        >
                          <option value="">— The whole regulation —</option>
                          {clauses.map(c => (
                            <option key={c.id} value={c.id}>
                              {[c.number, c.qualifier].filter(Boolean).join(' ')}
                              {c.title ? ` — ${c.title}` : ''}
                              {c.amendedIn ? ` (changed in ${c.amendedIn})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  }
                  return null;
                })()}
                {(() => {
                  const reg = editingItem.regulationId ? regulationById.get(editingItem.regulationId) : null;
                  if (!reg) {
                    return (
                      <p className="text-[11px] text-rose-700">
                        Every requirement derives from something in the Regulation library — that
                        is the central register, and linking it is what makes one row carry the
                        summary, the version and what the manual must contain. If the source is
                        not listed yet, add it with <strong>Not listed</strong>.
                      </p>
                    );
                  }
                  const edition = [reg.version, reg.editionYear ? String(reg.editionYear) : ''].filter(Boolean).join(' · ');
                  return (
                    <div className="text-[11px] text-gray-600 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {edition && <span className="font-semibold">{edition}</span>}
                      {reg.lastAmendedAt && <span>last change {reg.lastAmendedAt}</span>}
                      {reg.versionState === 'newer_available' && (
                        <span className="text-amber-700 font-semibold">A newer version exists</span>
                      )}
                      {reg.versionState === 'repealed' && (
                        <span className="text-rose-700 font-semibold">Repealed</span>
                      )}
                      <Link to={`/regulations/${reg.id}`} className="text-indigo-600 hover:underline ml-auto">
                        Open regulation →
                      </Link>
                    </div>
                  );
                })()}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Reference Code (Optional)</label>
                    <input 
                        placeholder="e.g. EN-60335-1" 
                        className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-400" 
                        value={editingItem.referenceCode || ''} 
                        disabled={!!editingItem.regulationId}
                        title={editingItem.regulationId
                          ? 'Taken from the linked regulation, so the two can never disagree.'
                          : undefined}
                        onChange={e => setEditingItem({...editingItem, referenceCode: e.target.value})} 
                    />
                </div>
                <div className="flex items-end pb-2">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input 
                        type="checkbox" 
                        className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                        checked={editingItem.isMandatory}
                        onChange={e => setEditingItem({...editingItem, isMandatory: e.target.checked})}
                    />
                    <span className="text-sm font-medium text-gray-700">Mandatory Requirement</span>
                    </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Long Description</label>
                <textarea 
                  placeholder="Full details of the requirement..." 
                  rows={3}
                  className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none" 
                  value={editingItem.description} 
                  onChange={e => setEditingItem({...editingItem, description: e.target.value})} 
                />
              </div>

              <div className="bg-light border border-gray-200 p-4 rounded-xl shadow space-y-4">
                  <h4 className="font-bold text-sm text-gray-800 border-b pb-2 border-gray-200">Submission Rules</h4>
                  
                  <div className="grid grid-cols-2 gap-4">
                      <div>
                          <label className="block text-[10px] font-bold text-muted uppercase mb-1">Timing</label>
                          <select 
                             className="w-full border rounded text-sm p-2 bg-white"
                             value={editingItem.timingType}
                             onChange={(e) => setEditingItem({...editingItem, timingType: e.target.value})}
                          >
                              <option value="ETD">Mandatory at ETD</option>
                              <option value="POST_ETD">Deferred (Post-ETD)</option>
                          </select>
                          {editingItem.timingType === 'POST_ETD' && (
                              <div className="mt-2 flex items-center gap-2">
                                  <span className="text-xs text-gray-600">Due</span>
                                  <input 
                                    type="number" 
                                    min="1"
                                    className="w-16 border rounded p-1 text-center text-sm"
                                    value={editingItem.timingWeeks || ''}
                                    onChange={(e) => setEditingItem({...editingItem, timingWeeks: parseInt(e.target.value) || 0})}
                                  />
                                  <span className="text-xs text-gray-600">weeks after ETD</span>
                              </div>
                          )}
                      </div>

                      <div>
                          <label className="block text-[10px] font-bold text-muted uppercase mb-1">Report Origin</label>
                          <select 
                             className="w-full border rounded text-sm p-2 bg-white"
                             value={editingItem.testReportOrigin}
                             onChange={(e) => setEditingItem({...editingItem, testReportOrigin: e.target.value})}
                          >
                              <option value="third_party_mandatory">3rd Party Lab (Mandatory)</option>
                              <option value="supplier_inhouse">Supplier In-House Test</option>
                          </select>
                      </div>
                  </div>

                  <div className="pt-1">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input 
                            type="checkbox" 
                            className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                            checked={editingItem.selfDeclarationAccepted}
                            onChange={e => setEditingItem({...editingItem, selfDeclarationAccepted: e.target.checked})}
                        />
                        <span className="text-sm font-medium text-gray-700">Supplier Self-Declaration Accepted</span>
                      </label>
                  </div>
              </div>

              {/* Conditional applicability — gated on a TCF QUESTION (migration 174), not on a
                  category attribute. The editor is its own component now: the inline version
                  was ~110 lines of IIFE, and the attribute picker it contained was the thing
                  that broke when the attributes were deleted. */}
              <RequirementConditionEditor
                condition={editingItem.condition ?? null}
                onChange={next => setEditingItem({ ...editingItem, condition: next })}
                questions={questions}
                onManageQuestions={() => setQuestionsOpen(true)}
              />

            </form>
            </div>
              
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 bg-white p-4 rounded-b-xl flex-shrink-0">
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)} 
                  className="px-5 py-2 text-gray-600 hover:bg-gray-100 rounded-md text-sm font-medium"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  form="reqForm"
                  className="px-5 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-md text-sm font-medium shadow"
                >
                  Save Requirement
                </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default ComplianceLibrary;
