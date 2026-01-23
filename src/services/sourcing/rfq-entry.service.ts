/**
 * RFQ entry service
 * Manages RFQ entries and supplier responses
 */

import { portalClient } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { RFQEntry } from '../../types';
import { handleError } from '../../utils/error.utils';

/**
 * Get all RFQs available for a supplier
 */
export const getRFQsForSupplier = async (supplierId: string): Promise<RFQEntry[]> => {
    if (!isLive) return [];
    const { data, error } = await portalClient.from('rfq_entries')
        .select('*, rfqs!inner(*)')
        .eq('supplier_id', supplierId)
        .eq('rfqs.status', 'open');

    if (error) return [];

    return (data || []).map((e: any) => ({
      id: e.id,
      rfqId: e.rfq_id,
      supplierId: e.supplier_id,
      token: e.token,
      status: e.status,
      unitPrice: e.unit_price,
      moq: e.moq,
      leadTimeWeeks: e.lead_time_weeks,
      tooling_cost: e.tooling_cost,
      currency: e.currency,
      supplierNotes: e.supplier_notes,
      quoteFileUrl: e.quote_file_url,
      submittedAt: e.submitted_at,
      createdAt: e.created_at,
      supplierName: e.supplier?.name,
      rfqTitle: e.rfqs?.title,
      rfqIdentifier: e.rfqs?.rfq_id
    }));
};

/**
 * Submit an RFQ entry response from supplier
 */
export const submitRFQEntry = async (entryId: string, data: Partial<RFQEntry>): Promise<void> => {
    const payload: any = {
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        unit_price: data.unitPrice,
        moq: data.moq,
        lead_time_weeks: data.leadTimeWeeks,
        tooling_cost: data.toolingCost,
        supplier_notes: data.supplierNotes,
        quote_file_url: data.quoteFileUrl
    };

    const { error } = await portalClient.from('rfq_entries').update(payload).eq('id', entryId);
    if (error) handleError(error, 'submitRFQEntry');
};
