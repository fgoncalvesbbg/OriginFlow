/**
 * RFQ entry service
 * Manages RFQ entries and supplier responses
 */

import { portalClient } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { RFQEntry } from '../../types';
import { runMutation } from '../core/db';

/**
 * Get all RFQs available for a supplier
 */
export const getRFQsForSupplier = async (token: string, code: string): Promise<RFQEntry[]> => {
    if (!isLive) return [];
    const { data, error } = await portalClient.rpc('get_rfqs_for_supplier', {
        p_supplier_token: token,
        p_code: code,
    });

    if (error) {
        console.error('getRFQsForSupplier error:', error);
        return [];
    }

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
      attachments: e.attachments ?? [],
      submittedAt: e.submitted_at,
      createdAt: e.created_at,
      rfqTitle: e.rfq_title,
      rfqIdentifier: e.rfq_identifier,
      attributeResponses: e.attribute_responses ?? []
    }));
};

/**
 * Submit an RFQ entry response from a supplier, authorized by the entry's
 * capability token. The SECURITY DEFINER RPC updates only the matching row, so
 * anon can no longer update arbitrary entries by id.
 */
export const submitRFQEntry = async (token: string, data: Partial<RFQEntry>): Promise<void> => {
    const payload = {
        unit_price: data.unitPrice,
        moq: data.moq,
        lead_time_weeks: data.leadTimeWeeks,
        tooling_cost: data.toolingCost,
        currency: data.currency,
        supplier_notes: data.supplierNotes,
        quote_file_url: data.quoteFileUrl,
        attachments: data.attachments ?? [],
        attribute_responses: data.attributeResponses ?? []
    };

    await runMutation(portalClient.rpc('submit_rfq_entry_secure', { p_token: token, p_payload: payload }), 'submitRFQEntry');
};
