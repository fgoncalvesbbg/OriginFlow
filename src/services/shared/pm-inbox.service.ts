/**
 * Project inbox service — one list of every open topic on the PM's projects.
 *
 * The PM's real question is "what is open, and who is it waiting on?". Answering it meant
 * opening each project in turn, because the answer is spread across six tables that share
 * nothing but a project_id. This module reads all six and normalizes them into `InboxItem`s.
 *
 * Access control is NOT implemented here. Every read goes through the authenticated `db`
 * client, and the row-level-security policies on each table already restrict a PM to their
 * own projects (`can_see_project`, `pm_access_own_*`, `pm_see_linked_supplier_proposals`).
 * The inbox therefore inherits project scoping for free — and must never widen it by, say,
 * resolving names through a SECURITY DEFINER routine.
 *
 * Every source is read with `orEmpty` and reported in `failedSources`: one unreachable
 * table degrades the panel to "3 of 6 sources loaded" rather than quietly presenting a
 * short list as though it were the whole picture. That distinction matters here more than
 * in most reads — an inbox that silently under-reports is worse than one that fails.
 */

import { db, withDeadline, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { ComplianceRequestStatus, DocStatus, ResponsibleParty } from '../../types';
import { getNotifications } from './notification.service';
import type { Notification } from '../../types';
import type { InboxItem, InboxSnapshot } from '../../types/inbox.types';
import { daysUntilDateOnly } from '../../utils/date.utils';

/** Same bound as the dashboard read: a stalled connection must fail, not hang the panel. */
const READ_TIMEOUT_MS = 20000;

/** Per-source row cap. Generous enough to be the whole truth in practice, bounded enough to stay one request. */
const SOURCE_LIMIT = 300;

/**
 * Documents at `not_started` with no deadline are unfilled checklist rows created with the
 * project, not requests anyone has made — there are 56 of them live against 0 real asks.
 * A document only counts as "waiting on supplier" once someone actually asked: the status
 * moved to `waiting_upload`, or a deadline was put on it.
 */
const docIsRealAsk = (r: Row): boolean =>
  r.status === DocStatus.WAITING_UPLOAD || Boolean(r.deadline);

interface NameMaps {
  projectName: Map<string, string>;
  projectSupplier: Map<string, string>;
  supplierName: Map<string, string>;
}

const resolveProject = (maps: NameMaps, projectId: string | null | undefined) =>
  (projectId && maps.projectName.get(projectId)) || 'Unknown project';

const resolveSupplierForProject = (maps: NameMaps, projectId: string | null | undefined) => {
  const supplierId = projectId ? maps.projectSupplier.get(projectId) : undefined;
  return supplierId ? maps.supplierName.get(supplierId) : undefined;
};

/** Calendar-day comparison, matching the dashboard: a deadline dated today is not overdue. */
const daysLeftOf = (deadline: string | null | undefined): number | null =>
  deadline ? daysUntilDateOnly(deadline) : null;

/**
 * Read the PM's whole inbox.
 *
 * Dismissed items are filtered out here rather than in the component, so the badge count
 * and the list can never disagree.
 */
export const getInboxSnapshot = async (userId: string | null): Promise<InboxSnapshot> => {
  if (!isLive) return { items: [], failedSources: [] };

  const failedSources: string[] = [];
  /** Tolerate one dead source; name it so the panel can admit the list is partial. */
  const source = async (table: string, read: Promise<Row[]>): Promise<Row[]> => {
    try {
      return await read;
    } catch (e) {
      console.warn(`[inbox] source "${table}" failed`, e);
      failedSources.push(table);
      return [];
    }
  };

  const results = await withDeadline(
    (signal) =>
      Promise.all([
        // Launches only. Re-edits (migration 182) have no phases, no documents and no
        // supplier, so they can never produce an inbox item — carrying them here would
        // only pad the 1000-row budget.
        source('projects', db.select<Row>('projects', { columns: 'id, name, supplier_id', where: { kind: 'launch' }, limit: 1000, signal })),
        source('suppliers', db.select<Row>('suppliers', { columns: 'id, name', limit: 1000, signal })),
        // Reuses the canonical read rather than re-querying the table, so the ownership
        // filter lives in exactly one place. The cost is that this one read cannot join
        // the shared abort signal; `withDeadline` still bounds the whole batch, the
        // request just is not cancelled when it trips.
        source('notifications', getNotifications(userId ?? '') as unknown as Promise<Row[]>),
        source(
          'project_attribute_requests',
          db.select<Row>('project_attribute_requests', {
            columns: 'id, project_id, project_name, token, status, sku_number, sku_title, note, deadline, created_at, submitted_at, batch_token',
            where: { status: ['pending', 'submitted'] },
            order: { column: 'created_at', ascending: false },
            limit: SOURCE_LIMIT,
            signal,
          }),
        ),
        source(
          'compliance_requests',
          db.select<Row>('compliance_requests', {
            columns: 'id, request_id, project_id, project_name, supplier_id, status, deadline, created_at, submitted_at',
            where: {
              status: [
                ComplianceRequestStatus.PENDING_SUPPLIER,
                ComplianceRequestStatus.SUBMITTED,
                ComplianceRequestStatus.UNDER_REVIEW,
              ],
            },
            order: { column: 'created_at', ascending: false },
            limit: SOURCE_LIMIT,
            signal,
          }),
        ),
        source(
          'project_documents',
          db.select<Row>('project_documents', {
            columns: 'id, project_id, title, step_number, status, responsible_party, deadline, created_at, uploaded_at',
            where: {
              responsible_party: ResponsibleParty.SUPPLIER,
              status: [DocStatus.NOT_STARTED, DocStatus.WAITING_UPLOAD, DocStatus.UPLOADED, DocStatus.UNDER_REVIEW],
            },
            order: { column: 'created_at', ascending: false },
            limit: SOURCE_LIMIT,
            signal,
          }),
        ),
        source(
          'supplier_proposals',
          db.select<Row>('supplier_proposals', {
            // Server-side join on the supplier name — see data/PORTING.md.
            columns: 'id, supplier_id, title, description, status, created_at, supplier:suppliers(name)',
            where: { status: 'new' },
            order: { column: 'created_at', ascending: false },
            limit: SOURCE_LIMIT,
            signal,
          }),
        ),
        source(
          'review_comments',
          db.select<Row>('review_comments', {
            columns: 'id, project_id, subject_type, language, section_title, body, author_name, status, created_at',
            // Manuals only. Since migration 162 this table also holds design-spec notes,
            // and this lane's title and /im-generator/ link are both IM-specific.
            where: { status: 'open', subject_type: { op: 'in', value: ['im', 'warning_leaflet'] } },
            order: { column: 'created_at', ascending: false },
            limit: SOURCE_LIMIT,
            signal,
          }),
        ),
        source(
          'pm_inbox_dismissals',
          userId
            ? db.select<Row>('pm_inbox_dismissals', { columns: 'item_key', where: { user_id: userId }, limit: 2000, signal })
            : Promise.resolve([] as Row[]),
        ),
      ]),
    READ_TIMEOUT_MS,
    'getInboxSnapshot',
  ).catch((e) => {
    console.error('[read] getInboxSnapshot timed out or failed', e);
    return null;
  });

  if (!results) return { items: [], failedSources: ['all'] };
  const [projects, suppliers, notifications, attrReqs, tcfReqs, docs, proposals, reviewNotes, dismissals] = results;

  return {
    items: buildInboxItems({
      projects,
      suppliers,
      notifications: notifications as unknown as Notification[],
      attributeRequests: attrReqs,
      complianceRequests: tcfReqs,
      documents: docs,
      proposals,
      reviewComments: reviewNotes,
      dismissedKeys: dismissals.map((d) => d.item_key as string),
    }),
    failedSources,
  };
};

/** Raw rows the builder normalizes. One field per source table. */
export interface InboxSources {
  projects: readonly Row[];
  suppliers: readonly Row[];
  /** Already mapped by getNotifications, so camelCase here rather than raw rows. */
  notifications: readonly Notification[];
  attributeRequests: readonly Row[];
  complianceRequests: readonly Row[];
  documents: readonly Row[];
  proposals: readonly Row[];
  reviewComments: readonly Row[];
  dismissedKeys: readonly string[];
}

/**
 * Normalize every source into one sorted, dismissal-filtered list.
 *
 * Pure, and exported for that reason: the lane assignment, the state-scoped keys, the
 * "is this document a real ask" rule and the sort order are the parts worth testing, and
 * none of them should need a database to exercise.
 *
 * Dismissed items are dropped here rather than in the component, so the topbar badge and
 * the drawer can never disagree about what is open.
 */
export const buildInboxItems = (sources: InboxSources): InboxItem[] => {
  const {
    projects, suppliers, notifications, attributeRequests: attrReqs, complianceRequests: tcfReqs,
    documents: docs, proposals, reviewComments: reviewNotes, dismissedKeys,
  } = sources;

  const maps: NameMaps = {
    projectName: new Map(projects.map((p) => [p.id as string, (p.name as string) || 'Untitled project'])),
    projectSupplier: new Map(projects.filter((p) => p.supplier_id).map((p) => [p.id as string, p.supplier_id as string])),
    supplierName: new Map(suppliers.map((s) => [s.id as string, (s.name as string) || 'Unknown supplier'])),
  };

  const items: InboxItem[] = [];

  // --- Notifications addressed to this PM -------------------------------------
  for (const n of notifications) {
    items.push({
      key: `notification:${n.id}:${n.isRead ? 'read' : 'unread'}`,
      kind: 'notification',
      lane: 'info',
      title: n.message,
      projectId: null,
      projectName: '',
      link: n.link || null,
      status: n.isRead ? 'read' : 'unread',
      statusLabel: n.isRead ? 'Read' : 'New',
      at: n.createdAt,
      unread: !n.isRead,
    });
  }

  // --- Supplier attribute-data requests ---------------------------------------
  for (const r of attrReqs) {
    const submitted = r.status === 'submitted';
    const sku = (r.sku_number as string) || '';
    items.push({
      key: `attribute_request:${r.id}:${r.status}`,
      kind: 'attribute_request',
      lane: submitted ? 'review' : 'waiting',
      title: submitted
        ? `Attribute data submitted${sku ? ` for ${sku}` : ''}`
        : `Attribute data requested${sku ? ` for ${sku}` : ''}`,
      detail: (r.sku_title as string) || (r.note as string) || undefined,
      projectId: r.project_id ?? null,
      projectName: (r.project_name as string) || resolveProject(maps, r.project_id),
      supplierName: resolveSupplierForProject(maps, r.project_id),
      // The PM reviews and edits submitted attribute data on the project's step 2/3 panel;
      // the portal URL is the supplier's copy and is not where a PM acts.
      link: r.project_id ? `/project/${r.project_id}` : null,
      status: r.status,
      statusLabel: submitted ? 'Needs review' : 'Awaiting supplier',
      at: (r.submitted_at as string) || r.created_at,
      deadline: r.deadline ?? null,
      daysLeft: daysLeftOf(r.deadline),
    });
  }

  // --- Compliance / TCF requests ----------------------------------------------
  for (const r of tcfReqs) {
    const waiting = r.status === ComplianceRequestStatus.PENDING_SUPPLIER;
    items.push({
      key: `compliance_request:${r.id}:${r.status}`,
      kind: 'compliance_request',
      lane: waiting ? 'waiting' : 'review',
      title: `TCF ${r.request_id}`,
      detail: waiting ? 'Sent to supplier, no response yet' : 'Supplier response ready to review',
      projectId: r.project_id ?? null,
      projectName: (r.project_name as string) || resolveProject(maps, r.project_id) || 'Standalone',
      supplierName: r.supplier_id
        ? maps.supplierName.get(r.supplier_id as string)
        : resolveSupplierForProject(maps, r.project_id),
      link: `/compliance/request/${r.id}`,
      status: r.status,
      statusLabel: waiting
        ? 'Awaiting supplier'
        : r.status === ComplianceRequestStatus.UNDER_REVIEW
          ? 'In review'
          : 'Needs review',
      at: (r.submitted_at as string) || r.created_at,
      deadline: r.deadline ?? null,
      daysLeft: daysLeftOf(r.deadline),
    });
  }

  // --- Supplier-owned project documents ---------------------------------------
  for (const d of docs) {
    const received = d.status === DocStatus.UPLOADED || d.status === DocStatus.UNDER_REVIEW;
    if (!received && !docIsRealAsk(d)) continue;
    items.push({
      key: `document:${d.id}:${d.status}`,
      kind: 'document',
      lane: received ? 'review' : 'waiting',
      title: (d.title as string) || 'Untitled document',
      detail: received ? 'Uploaded by supplier' : `Requested from supplier · step ${d.step_number}`,
      projectId: d.project_id ?? null,
      projectName: resolveProject(maps, d.project_id),
      supplierName: resolveSupplierForProject(maps, d.project_id),
      link: d.project_id ? `/project/${d.project_id}` : null,
      status: d.status,
      statusLabel: received
        ? d.status === DocStatus.UNDER_REVIEW
          ? 'In review'
          : 'Needs review'
        : 'Awaiting upload',
      at: (d.uploaded_at as string) || d.created_at,
      deadline: d.deadline ?? null,
      daysLeft: daysLeftOf(d.deadline),
    });
  }

  // --- New supplier proposals --------------------------------------------------
  for (const p of proposals) {
    items.push({
      key: `proposal:${p.id}:${p.status}`,
      kind: 'proposal',
      lane: 'review',
      title: (p.title as string) || 'Untitled proposal',
      detail: (p.description as string) || undefined,
      // Proposals arrive against a supplier, not a project — they are pre-project offers.
      projectId: null,
      projectName: '',
      supplierName: (p.supplier as any)?.name || maps.supplierName.get(p.supplier_id as string),
      link: '/sourcing',
      status: p.status,
      statusLabel: 'New proposal',
      at: p.created_at,
    });
  }

  // --- Open supplier review notes on instruction manuals ----------------------
  for (const c of reviewNotes) {
    items.push({
      key: `review_comment:${c.id}:${c.status}`,
      kind: 'review_comment',
      lane: 'review',
      title: `Manual note${c.section_title ? ` on “${c.section_title}”` : ''}`,
      detail: (c.body as string) || undefined,
      projectId: c.project_id ?? null,
      projectName: resolveProject(maps, c.project_id),
      supplierName: (c.author_name as string) || resolveSupplierForProject(maps, c.project_id),
      link: c.project_id ? `/project/${c.project_id}/im-generator/${c.subject_type || ''}` : null,
      status: c.status,
      statusLabel: 'Open note',
      at: c.created_at,
    });
  }

  const dismissed = new Set(dismissedKeys);
  const visible = items.filter((i) => !dismissed.has(i.key));

  // Overdue first, then the rest of the deadlines by urgency, then newest. An item with no
  // deadline sorts after every dated one rather than jumping the queue with a `0`.
  visible.sort((a, b) => {
    const ad = a.daysLeft ?? Number.POSITIVE_INFINITY;
    const bd = b.daysLeft ?? Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    return new Date(b.at).getTime() - new Date(a.at).getTime();
  });

  return visible;
};

/**
 * Dismiss one item for this user.
 *
 * A notification is also marked read and stamped `dismissed_at`, because the row is the
 * PM's own and the bell must stop counting it. Everything else is someone else's row, so
 * the acknowledgement lives in `pm_inbox_dismissals` and the source is left untouched.
 */
export const dismissInboxItem = async (userId: string, item: InboxItem): Promise<void> => {
  if (!isLive || !userId) return;

  if (item.kind === 'notification') {
    const id = item.key.split(':')[1];
    await db.updateWhere('notifications', { is_read: true, dismissed_at: new Date().toISOString() }, { where: { id } });
    return;
  }

  await db.upsert(
    'pm_inbox_dismissals',
    { user_id: userId, item_key: item.key, dismissed_at: new Date().toISOString() },
    { onConflict: 'user_id,item_key' },
  );
};

/** Dismiss several items at once — the panel's per-lane "Dismiss all". */
export const dismissInboxItems = async (userId: string, items: readonly InboxItem[]): Promise<void> => {
  if (!isLive || !userId || items.length === 0) return;

  const notifIds = items.filter((i) => i.kind === 'notification').map((i) => i.key.split(':')[1]);
  const derived = items.filter((i) => i.kind !== 'notification');
  const now = new Date().toISOString();

  await Promise.all([
    notifIds.length
      ? db.updateWhere('notifications', { is_read: true, dismissed_at: now }, { where: { id: notifIds } })
      : Promise.resolve(),
    derived.length
      ? db.upsert(
          'pm_inbox_dismissals',
          derived.map((i) => ({ user_id: userId, item_key: i.key, dismissed_at: now })),
          { onConflict: 'user_id,item_key' },
        )
      : Promise.resolve(),
  ]);
};

/**
 * Undo a dismissal. The panel keeps the last dismissal in memory and offers "Undo" for a
 * few seconds, because dismissing the wrong row in a list that reorders under you is easy
 * and the item would otherwise be unreachable from the panel.
 */
export const restoreInboxItem = async (userId: string, item: InboxItem): Promise<void> => {
  if (!isLive || !userId) return;

  if (item.kind === 'notification') {
    const id = item.key.split(':')[1];
    await db.updateWhere('notifications', { dismissed_at: null }, { where: { id } });
    return;
  }

  await db.delete('pm_inbox_dismissals', { where: { user_id: userId, item_key: item.key } });
};
