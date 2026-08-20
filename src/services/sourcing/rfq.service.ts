/**
 * RFQ service
 * Manages Request for Quote functionality
 */

import { db, portalDb, orEmpty, orUndefined, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { RFQ, RFQEntry, RFQStatus, RFQEntryStatus, RFQAttributeValue, RFQAttachment } from '../../types';
import { mapRFQ } from '../../utils/mappers.utils';
import { generateUUID } from '../../utils';

/** Server-side joins — see data/PORTING.md for the SQL a non-PostgREST adapter must generate. */
const RFQ_COLUMNS = '*, category_l3:categories_l3(name)';
const ENTRY_COLUMNS = '*, supplier:suppliers(name)';

const mapEntry = (e: any): RFQEntry => ({
  id: e.id,
  rfqId: e.rfq_id,
  supplierId: e.supplier_id,
  token: e.token,
  status: e.status,
  unitPrice: e.unit_price,
  moq: e.moq,
  leadTimeWeeks: e.lead_time_weeks,
  toolingCost: e.tooling_cost,
  currency: e.currency,
  supplierNotes: e.supplier_notes,
  quoteFileUrl: e.quote_file_url,
  attachments: e.attachments ?? [],
  submittedAt: e.submitted_at,
  createdAt: e.created_at,
  supplierName: e.supplier?.name,
  rfqTitle: e.rfqs?.title,
  rfqIdentifier: e.rfqs?.rfq_id,
  rfqDeadline: e.rfqs?.deadline ?? undefined,
  attributeResponses: e.attribute_responses ?? []
});

/**
 * Get all RFQs
 */
export const getRFQs = async (): Promise<RFQ[]> => {
    if (!isLive) return [];
    const rows = await orEmpty(
        db.select<Row>('rfqs', {
            columns: RFQ_COLUMNS,
            order: { column: 'created_at', ascending: false },
        }),
        'getRFQs',
    );
    return rows.map(mapRFQ);
};

/**
 * Get RFQ by ID with all entries
 */
export const getRFQById = async (id: string): Promise<RFQ | undefined> => {
    if (!id || !isLive) return undefined;
    const row = await orUndefined(
        db.selectMaybeOne<Row>('rfqs', { columns: RFQ_COLUMNS, where: { id } }),
        'getRFQById',
    );
    if (!row) return undefined;

    const rfq = mapRFQ(row);
    const entries = await orEmpty(
        db.select<Row>('rfq_entries', { columns: ENTRY_COLUMNS, where: { rfq_id: id } }),
        'getRFQById:entries',
    );
    rfq.entries = entries.map(mapEntry);
    return rfq;
};

/**
 * Get RFQ entry by token (for supplier portal)
 */
export const getRFQEntryByToken = async (token: string): Promise<{ rfq: RFQ, entry: RFQEntry } | undefined> => {
    if (!isLive) return undefined;
    const entryRows = await orUndefined(
        portalDb.rpc<Row | Row[] | null>('get_rfq_entry_by_token', { p_token: token }),
        'getRFQEntryByToken',
    );
    const entryData = Array.isArray(entryRows) ? entryRows[0] : entryRows;
    if (!entryData) {
        console.error("getRFQEntryByToken: Entry not found");
        return undefined;
    }

    const entry = mapEntry(entryData);

    const rfqRows = await orUndefined(
        portalDb.rpc<Row | Row[] | null>('get_rfq_by_entry_token', { p_token: token }),
        'getRFQEntryByToken:rfq',
    );
    const rfqData = Array.isArray(rfqRows) ? rfqRows[0] : rfqRows;

    if (!rfqData) return undefined;

    return { rfq: mapRFQ(rfqData), entry };
};

/**
 * Create a new RFQ
 */
export const createRFQ = async (
    title: string,
    rfqId: string,
    description: string,
    supplierIds: string[],
    createdBy: string,
    categoryId?: string,
    attributes?: RFQAttributeValue[],
    thumbnailUrl?: string,
    attachments?: RFQAttachment[],
    deadline?: string | null
): Promise<RFQ> => {
    const rfqData = await db.insert<Row>('rfqs', {
        title,
        rfq_id: rfqId,
        description,
        created_by: createdBy,
        category_id: categoryId || null,
        attributes: attributes,
        thumbnail_url: thumbnailUrl,
        attachments: attachments,
        deadline: deadline || null,
        status: RFQStatus.OPEN,
        created_at: new Date().toISOString()
    });

    const newRFQ = mapRFQ(rfqData);

    if (supplierIds.length > 0) {
        const entriesPayload = supplierIds.map(sid => ({
            rfq_id: newRFQ.id,
            supplier_id: sid,
            token: generateUUID(),
            status: RFQEntryStatus.PENDING,
            created_at: new Date().toISOString()
        }));

        // Best-effort: the RFQ itself is already created, so a failure here is logged
        // rather than rolled back (matching the previous behaviour).
        try {
            await db.insertMany('rfq_entries', entriesPayload);
        } catch (e) {
            console.error("Failed to create RFQ entries", e);
        }
    }

    return newRFQ;
};

/**
 * Delete an RFQ
 */
export const deleteRFQ = async (id: string): Promise<void> => {
    await db.delete('rfqs', { where: { id } });
};

/**
 * Award an RFQ to a specific supplier entry
 */
export const awardRFQ = async (rfqId: string, entryId: string): Promise<void> => {
    await db.updateWhere('rfq_entries', { status: RFQEntryStatus.AWARDED }, { where: { id: entryId } });
    await db.updateWhere('rfqs', { status: RFQStatus.AWARDED }, { where: { id: rfqId } });
};

/**
 * Return a submitted entry to 'pending' so the supplier can correct their quote.
 *
 * A quote is one-shot from the supplier's side: `submit_rfq_entry_secure` refuses a
 * second submission, and the portal shows a read-only summary. That is the right
 * default for a commercial record, but a mistyped price then has no route back into
 * the comparison table except email. This is that route — a deliberate PM action.
 *
 * The previously submitted figures are left in place so the supplier sees what they
 * are correcting rather than an empty form.
 */
export const reopenRFQEntry = async (entryId: string): Promise<void> => {
    await db.updateWhere(
        'rfq_entries',
        { status: RFQEntryStatus.PENDING, submitted_at: null },
        { where: { id: entryId } },
    );
};
