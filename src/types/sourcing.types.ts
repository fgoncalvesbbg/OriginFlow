/**
 * Sourcing module types (Request for Quote / RFQ)
 */

export enum RFQStatus {
  OPEN = 'open',
  CLOSED = 'closed',
  AWARDED = 'awarded'
}

export enum RFQEntryStatus {
  PENDING = 'pending',
  SUBMITTED = 'submitted',
  AWARDED = 'awarded'
}

export interface RFQAttributeValue {
  attributeId: string;
  name: string;
  value: string;
  type: 'fixed' | 'range' | 'text';
}

export interface RFQAttachment {
  name: string;
  url: string;
  type: string;
}

export interface RFQEntry {
  id: string;
  rfqId: string;
  supplierId: string;
  token: string;
  status: RFQEntryStatus;
  unitPrice?: number;
  moq?: number;
  leadTimeWeeks?: number;
  toolingCost?: number;
  currency?: string;
  supplierNotes?: string;
  quoteFileUrl?: string;
  submittedAt?: string;
  createdAt: string;
  supplierName?: string;
  rfqTitle?: string;
  rfqIdentifier?: string;
}

export interface RFQ {
  id: string;
  rfqId: string;
  title: string;
  categoryId?: string;
  description: string;
  attributes: RFQAttributeValue[];
  thumbnailUrl?: string;
  attachments: RFQAttachment[];
  createdBy: string;
  createdAt: string;
  status: RFQStatus;
  categoryName?: string;
  entries?: RFQEntry[];
}

export interface SupplierProposal {
  id: string;
  supplierId: string;
  supplierName?: string;
  title: string;
  description: string;
  fileUrl: string;
  status: string;
  createdAt: string;
}
