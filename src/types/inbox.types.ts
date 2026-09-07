/**
 * Project inbox types — the PM's single list of open topics across their projects.
 *
 * Six unrelated tables answer the question "what is open on my projects?". The inbox
 * normalizes them into one `InboxItem` so the panel can sort, filter and dismiss without
 * knowing which module a row came from.
 */

/** Which table an item came from. Also selects its icon and its route. */
export type InboxKind =
  | 'notification'
  | 'attribute_request'
  | 'compliance_request'
  | 'document'
  | 'proposal'
  | 'review_comment';

/**
 * Which of the PM's three questions an item answers.
 *
 *  - `review`  the supplier has answered; the ball is in the PM's court.
 *  - `waiting` the PM has asked; the ball is in the supplier's court.
 *  - `info`    a notification addressed to this PM. No ball.
 */
export type InboxLane = 'review' | 'waiting' | 'info';

export interface InboxItem {
  /**
   * Dismissal key, `<kind>:<id>:<state>`.
   *
   * The state segment is load-bearing: dismissing an item while it is `pending`
   * acknowledges only that wait. When the supplier submits, the key changes to
   * `…:submitted`, no dismissal row matches, and the item returns under "Needs your
   * review". Never reduce this to `<kind>:<id>` — that would let one dismissal swallow
   * every future state of the same request.
   */
  key: string;
  kind: InboxKind;
  lane: InboxLane;
  /** One line, already human-readable. No IDs unless the ID is what the PM recognises. */
  title: string;
  /** Optional second line: the ask, the note body, the document name. */
  detail?: string;
  projectId: string | null;
  projectName: string;
  supplierName?: string;
  /** In-app route to act on it (no leading `#`), or null when there is nowhere to go. */
  link: string | null;
  /** Raw source status, for the badge. */
  status: string;
  /** Short human label for `status`, e.g. "Awaiting supplier". */
  statusLabel: string;
  /** When it entered this state — submitted_at where the source has one, else created_at. */
  at: string;
  deadline?: string | null;
  /** Calendar days until `deadline`; negative is overdue. Null when there is no deadline. */
  daysLeft?: number | null;
  /** Notifications only: still unread. */
  unread?: boolean;
}

export interface InboxSnapshot {
  items: InboxItem[];
  /** Sources that failed to load, by table name. The panel says so rather than showing a short list as if it were complete. */
  failedSources: string[];
}
