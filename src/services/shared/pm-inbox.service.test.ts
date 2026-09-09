import { describe, it, expect } from 'vitest';
import { buildInboxItems, type InboxSources } from './pm-inbox.service';
import { ComplianceRequestStatus, DocStatus, ResponsibleParty } from '../../types';
import type { Notification } from '../../types';
import type { InboxItem } from '../../types/inbox.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EMPTY: InboxSources = {
  projects: [{ id: 'p1', name: 'Air Fryer 2027', supplier_id: 's1' }],
  suppliers: [{ id: 's1', name: 'Ningbo Kitchen Co' }],
  notifications: [],
  attributeRequests: [],
  complianceRequests: [],
  documents: [],
  proposals: [],
  reviewComments: [],
  dismissedKeys: [],
};

const build = (overrides: Partial<InboxSources>): InboxItem[] =>
  buildInboxItems({ ...EMPTY, ...overrides });

const attrReq = (o: Record<string, unknown>) => ({
  id: 'ar1', project_id: 'p1', project_name: 'Air Fryer 2027', status: 'pending',
  sku_number: 'KL-1234', sku_title: 'Air fryer 5.5L', deadline: null,
  created_at: '2026-09-01T00:00:00Z', submitted_at: null, ...o,
});

const tcf = (o: Record<string, unknown>) => ({
  id: 'tcf1', request_id: 'TCF-2025-8938', project_id: 'p1', project_name: 'Air Fryer 2027',
  supplier_id: 's1', status: ComplianceRequestStatus.PENDING_SUPPLIER, deadline: null,
  created_at: '2026-09-01T00:00:00Z', submitted_at: null, ...o,
});

const doc = (o: Record<string, unknown>) => ({
  id: 'd1', project_id: 'p1', title: 'CB certificate', step_number: 4,
  status: DocStatus.NOT_STARTED, responsible_party: ResponsibleParty.SUPPLIER,
  deadline: null, created_at: '2026-09-01T00:00:00Z', uploaded_at: null, ...o,
});

const notif = (o: Partial<Notification>): Notification => ({
  id: 'n1', userId: 'u1', message: 'Supplier submitted TCF-2025-8938',
  link: '/compliance/request/tcf1', isRead: false, createdAt: '2026-09-01T00:00:00Z', ...o,
});

// ---------------------------------------------------------------------------
// Lane assignment — who is the blocker
// ---------------------------------------------------------------------------

describe('buildInboxItems lane assignment', () => {
  it('puts a pending attribute request in the waiting lane and a submitted one in review', () => {
    const [pending] = build({ attributeRequests: [attrReq({ status: 'pending' })] });
    expect(pending.lane).toBe('waiting');
    expect(pending.statusLabel).toBe('Awaiting supplier');

    const [submitted] = build({
      attributeRequests: [attrReq({ status: 'submitted', submitted_at: '2026-09-05T00:00:00Z' })],
    });
    expect(submitted.lane).toBe('review');
    expect(submitted.statusLabel).toBe('Needs review');
  });

  it('treats a pending_supplier TCF as waiting and a submitted one as review', () => {
    expect(build({ complianceRequests: [tcf({})] })[0].lane).toBe('waiting');
    expect(build({ complianceRequests: [tcf({ status: ComplianceRequestStatus.SUBMITTED })] })[0].lane).toBe('review');
  });

  it('distinguishes a submitted TCF from one already under review', () => {
    const [underReview] = build({ complianceRequests: [tcf({ status: ComplianceRequestStatus.UNDER_REVIEW })] });
    expect(underReview.statusLabel).toBe('In review');
  });

  it('files new supplier proposals and open manual notes as review work', () => {
    const [proposal] = build({ proposals: [{ id: 'pr1', supplier_id: 's1', title: 'Cordless kettle', status: 'new', created_at: '2026-09-01T00:00:00Z' }] });
    expect(proposal.lane).toBe('review');
    expect(proposal.supplierName).toBe('Ningbo Kitchen Co');

    // subject_type, not template_type: migration 162 renamed the column when the review
    // layer stopped being IM-only.
    const [note] = build({ reviewComments: [{ id: 'c1', project_id: 'p1', subject_type: 'user_manual', section_title: 'Safety', body: 'Wrong voltage', author_name: 'Wang', status: 'open', created_at: '2026-09-01T00:00:00Z' }] });
    expect(note.lane).toBe('review');
    expect(note.link).toBe('/project/p1/im-generator/user_manual');
  });

  it('puts the PM’s own notifications in the info lane, flagging unread ones', () => {
    const items = build({ notifications: [notif({ isRead: false }), notif({ id: 'n2', isRead: true })] });
    expect(items.every(i => i.lane === 'info')).toBe(true);
    expect(items.find(i => i.key.startsWith('notification:n1'))?.unread).toBe(true);
    expect(items.find(i => i.key.startsWith('notification:n2'))?.unread).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Documents — an unfilled checklist row is not an open request
// ---------------------------------------------------------------------------

describe('buildInboxItems document filtering', () => {
  it('ignores a not_started supplier document that nobody has actually asked for', () => {
    // 56 rows live look like this: created with the project, no deadline, never requested.
    expect(build({ documents: [doc({ status: DocStatus.NOT_STARTED, deadline: null })] })).toHaveLength(0);
  });

  it('counts a not_started document as waiting once it has a deadline', () => {
    const [item] = build({ documents: [doc({ status: DocStatus.NOT_STARTED, deadline: '2026-09-20' })] });
    expect(item.lane).toBe('waiting');
    expect(item.statusLabel).toBe('Awaiting upload');
  });

  it('counts a waiting_upload document as waiting even with no deadline', () => {
    const [item] = build({ documents: [doc({ status: DocStatus.WAITING_UPLOAD, deadline: null })] });
    expect(item.lane).toBe('waiting');
  });

  it('always surfaces an uploaded document as review work regardless of deadline', () => {
    const [item] = build({ documents: [doc({ status: DocStatus.UPLOADED, deadline: null, uploaded_at: '2026-09-06T00:00:00Z' })] });
    expect(item.lane).toBe('review');
    expect(item.statusLabel).toBe('Needs review');
    expect(item.at).toBe('2026-09-06T00:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// Dismissal keys — the reason dismissing open work is safe
// ---------------------------------------------------------------------------

describe('buildInboxItems dismissal keys', () => {
  it('encodes the item state in the key, so dismissing a wait cannot hide the submission', () => {
    const pendingKey = build({ attributeRequests: [attrReq({ status: 'pending' })] })[0].key;
    expect(pendingKey).toBe('attribute_request:ar1:pending');

    // The PM dismisses the wait. The supplier then submits: same row, new state.
    const afterSubmit = build({
      attributeRequests: [attrReq({ status: 'submitted', submitted_at: '2026-09-05T00:00:00Z' })],
      dismissedKeys: [pendingKey],
    });
    expect(afterSubmit).toHaveLength(1);
    expect(afterSubmit[0].key).toBe('attribute_request:ar1:submitted');
    expect(afterSubmit[0].lane).toBe('review');
  });

  it('hides an item whose exact state was dismissed', () => {
    expect(build({
      attributeRequests: [attrReq({ status: 'pending' })],
      dismissedKeys: ['attribute_request:ar1:pending'],
    })).toHaveLength(0);
  });

  it('resurfaces a notification when it flips from unread to read', () => {
    // Marking read changes the key, which is deliberate: dismissing the unread copy is an
    // acknowledgement of the alert, not of the message.
    expect(build({ notifications: [notif({ isRead: false })], dismissedKeys: ['notification:n1:unread'] })).toHaveLength(0);
    expect(build({ notifications: [notif({ isRead: true })], dismissedKeys: ['notification:n1:unread'] })).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Ordering and name resolution
// ---------------------------------------------------------------------------

describe('buildInboxItems ordering', () => {
  it('sorts overdue first, then by urgency, then newest', () => {
    const today = new Date();
    const iso = (offsetDays: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() + offsetDays);
      return d.toISOString().slice(0, 10);
    };
    const items = build({
      complianceRequests: [
        tcf({ id: 'soon', request_id: 'TCF-SOON', deadline: iso(2) }),
        tcf({ id: 'late', request_id: 'TCF-LATE', deadline: iso(-5) }),
        tcf({ id: 'far', request_id: 'TCF-FAR', deadline: iso(30) }),
      ],
    });
    expect(items.map(i => i.title)).toEqual(['TCF TCF-LATE', 'TCF TCF-SOON', 'TCF TCF-FAR']);
  });

  it('sorts undated items after every dated one rather than treating them as due today', () => {
    const items = build({
      complianceRequests: [tcf({ id: 'undated', request_id: 'TCF-UNDATED', deadline: null })],
      proposals: [{ id: 'pr1', supplier_id: 's1', title: 'Kettle', status: 'new', created_at: '2026-09-01T00:00:00Z' }],
      documents: [doc({ status: DocStatus.WAITING_UPLOAD, deadline: '2027-01-01' })],
    });
    expect(items[0].title).toBe('CB certificate');
    expect(items.slice(1).every(i => i.daysLeft == null)).toBe(true);
  });

  it('resolves the project and supplier name for a document that carries neither', () => {
    const [item] = build({ documents: [doc({ status: DocStatus.WAITING_UPLOAD })] });
    expect(item.projectName).toBe('Air Fryer 2027');
    expect(item.supplierName).toBe('Ningbo Kitchen Co');
  });

  it('falls back to a placeholder when the project is not in the caller’s scope', () => {
    const [item] = build({ documents: [doc({ project_id: 'unknown', status: DocStatus.WAITING_UPLOAD })] });
    expect(item.projectName).toBe('Unknown project');
    expect(item.supplierName).toBeUndefined();
  });
});
