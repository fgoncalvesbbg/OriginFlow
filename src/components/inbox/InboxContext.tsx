/**
 * Inbox context — lets a routed page read the inbox Layout already loaded, and open the
 * drawer.
 *
 * Exists so the dashboard's counters and the drawer cannot disagree. Before this, the
 * "Pending Reviews" tile ran its own narrower query (`project_documents.status = 'uploaded'`,
 * which is one of six sources) and read 0 while eight items were genuinely waiting. A page
 * that wants "how much is on my plate" must get it from the same snapshot the drawer lists.
 *
 * `useInbox()` returns null outside a Layout — a page rendered without the shell (or in a
 * test) degrades to hiding the counter rather than throwing.
 */

import React, { createContext, useContext } from 'react';
import type { ProjectInbox } from '../../hooks/useProjectInbox';

export interface InboxContextValue {
  inbox: ProjectInbox;
  /** Open the drawer, e.g. from a dashboard tile. */
  openInbox: () => void;
}

const InboxContext = createContext<InboxContextValue | null>(null);

export const InboxProvider: React.FC<{ value: InboxContextValue; children: React.ReactNode }> = ({ value, children }) => (
  <InboxContext.Provider value={value}>{children}</InboxContext.Provider>
);

/** The app-shell inbox, or null when rendered outside Layout. */
export const useInbox = (): InboxContextValue | null => useContext(InboxContext);
