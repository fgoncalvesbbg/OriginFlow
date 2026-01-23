/**
 * RFQ service
 * Manages Request for Quote functionality
 */

import { supabase, portalClient } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { RFQ, RFQEntry, RFQStatus, RFQEntryStatus, RFQAttributeValue, RFQAttachment } from '../../types';
import { mapRFQ } from '../../utils/mappers.utils';
import { handleError, generateUUID } from '../../utils';

/**
 * Get all RFQs
 */
export const getRFQs = async (): Promise<RFQ[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('rfqs').select('*, category_l3:categories_l3(name)').order('created_at', { ascending: false });
    if (error) return [];
    return (data || []).map(mapRFQ);
};

/**
 * Get RFQ by ID with all entries
 */
export const getRFQById = async (id: string): Promise<RFQ | undefined> => {
    if (!id || !isLive) return undefined;
    const { data, error } = await supabase.from('rfqs').select('*, category_l3:categories_l3(name)').eq('id', id).single();
    if (error) return undefined;

    const rfq = mapRFQ(data);
    const { data: entries } = await supabase.from('rfq_entries').select('*, supplier:suppliers(name)').eq('rfq_id', id);
    if (entries) {
        rfq.entries = entries.map((e: any) => ({
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
          submittedAt: e.submitted_at,
          createdAt: e.created_at,
          supplierName: e.supplier?.name,
          rfqTitle: e.rfqs?.title,
          rfqIdentifier: e.rfqs?.rfq_id
        }));
    }
    return rfq;
};

/**
 * Get RFQ entry by token (for supplier portal)
 */
export const getRFQEntryByToken = async (token: string): Promise<{ rfq: RFQ, entry: RFQEntry } | undefined> => {
    if (!isLive) return undefined;
    const { data: entryData, error } = await portalClient.from('rfq_entries').select('*').eq('token', token).maybeSingle();
    if (error || !entryData) {
        console.error("getRFQEntryByToken: Entry not found or error", error);
        return undefined;
    }

    const entry: RFQEntry = {
      id: entryData.id,
      rfqId: entryData.rfq_id,
      supplierId: entryData.supplier_id,
      token: entryData.token,
      status: entryData.status,
      unitPrice: entryData.unit_price,
      moq: entryData.moq,
      leadTimeWeeks: entryData.lead_time_weeks,
      toolingCost: entryData.tooling_cost,
      currency: entryData.currency,
      supplierNotes: entryData.supplier_notes,
      quoteFileUrl: entryData.quote_file_url,
      submittedAt: entryData.submitted_at,
      createdAt: entryData.created_at,
      supplierName: entryData.supplier?.name,
      rfqTitle: entryData.rfqs?.title,
      rfqIdentifier: entryData.rfqs?.rfq_id
    };

    let { data: rfqData, error: rfqError } = await portalClient.from('rfqs').select('*, category_l3:categories_l3(name)').eq('id', entry.rfqId).maybeSingle();

    if (rfqError || !rfqData) {
        const { data: retryData } = await portalClient.from('rfqs').select('*').eq('id', entry.rfqId).maybeSingle();
        rfqData = retryData;
    }

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
    attachments?: RFQAttachment[]
): Promise<RFQ> => {
    const { data: rfqData, error } = await supabase.from('rfqs').insert({
        title,
        rfq_id: rfqId,
        description,
        created_by: createdBy,
        category_id: categoryId || null,
        attributes: attributes,
        thumbnail_url: thumbnailUrl,
        attachments: attachments,
        status: RFQStatus.OPEN,
        created_at: new Date().toISOString()
    }).select().single();

    if (error) handleError(error, 'createRFQ');

    const newRFQ = mapRFQ(rfqData);

    if (supplierIds.length > 0) {
        const entriesPayload = supplierIds.map(sid => ({
            rfq_id: newRFQ.id,
            supplier_id: sid,
            token: generateUUID(),
            status: RFQEntryStatus.PENDING,
            created_at: new Date().toISOString()
        }));

        const { error: entriesError } = await supabase.from('rfq_entries').insert(entriesPayload);
        if (entriesError) console.error("Failed to create RFQ entries", entriesError);
    }

    return newRFQ;
};

/**
 * Delete an RFQ
 */
export const deleteRFQ = async (id: string): Promise<void> => {
    const { error } = await supabase.from('rfqs').delete().eq('id', id);
    if (error) handleError(error, 'deleteRFQ');
};

/**
 * Award an RFQ to a specific supplier entry
 */
export const awardRFQ = async (rfqId: string, entryId: string): Promise<void> => {
    const { error: entryError } = await supabase.from('rfq_entries').update({ status: RFQEntryStatus.AWARDED }).eq('id', entryId);
    if (entryError) handleError(entryError, 'awardRFQ (entry)');

    const { error: rfqError } = await supabase.from('rfqs').update({ status: RFQStatus.AWARDED }).eq('id', rfqId);
    if (rfqError) handleError(rfqError, 'awardRFQ (rfq)');
};
