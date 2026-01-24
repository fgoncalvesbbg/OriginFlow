/**
 * Supplier proposal service
 * Manages supplier proposals
 */

import { supabase, portalClient } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { SupplierProposal, RFQAttributeValue, RFQAttachment, RFQ, RFQStatus, RFQEntryStatus } from '../../types';
import { handleError } from '../../utils/error.utils';

/**
 * Get all supplier proposals
 */
export const getAllSupplierProposals = async (): Promise<SupplierProposal[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('supplier_proposals').select('*, supplier:suppliers(name)').order('created_at', { ascending: false });
    if (error) handleError(error, 'getAllSupplierProposals');
    return (data || []).map((p: any) => ({
        id: p.id,
        supplierId: p.supplier_id,
        supplierName: p.supplier?.name,
        title: p.title,
        description: p.description,
        fileUrl: p.file_url,
        categoryId: p.category_id,
        attributes: p.attributes || [],
        thumbnailUrl: p.thumbnail_url,
        attachments: p.attachments || [],
        status: p.status,
        createdAt: p.created_at
    }));
};

/**
 * Get proposals for a specific supplier
 */
export const getSupplierProposals = async (supplierId: string): Promise<SupplierProposal[]> => {
    if (!isLive) return [];
    const { data, error } = await portalClient.from('supplier_proposals').select('*').eq('supplier_id', supplierId).order('created_at', { ascending: false });
    if (error) return [];
    return (data || []).map((p: any) => ({
        id: p.id,
        supplierId: p.supplier_id,
        supplierName: p.supplier?.name,
        title: p.title,
        description: p.description,
        fileUrl: p.file_url,
        categoryId: p.category_id,
        attributes: p.attributes || [],
        thumbnailUrl: p.thumbnail_url,
        attachments: p.attachments || [],
        status: p.status,
        createdAt: p.created_at
    }));
};

/**
 * Create a new supplier proposal
 */
export const createSupplierProposal = async (supplierId: string, title: string, description: string, fileUrl: string): Promise<void> => {
    const { error } = await portalClient.from('supplier_proposals').insert({
        supplier_id: supplierId,
        title,
        description,
        file_url: fileUrl,
        status: 'new',
        created_at: new Date().toISOString()
    });
    if (error) handleError(error, 'createSupplierProposal');
};

/**
 * Create an enhanced supplier proposal with full RFQ structure
 */
export const createEnhancedSupplierProposal = async (
    supplierId: string,
    title: string,
    description: string,
    categoryId?: string,
    attributes?: RFQAttributeValue[],
    thumbnailUrl?: string,
    attachments?: RFQAttachment[]
): Promise<void> => {
    const { error } = await portalClient.from('supplier_proposals').insert({
        supplier_id: supplierId,
        title,
        description,
        category_id: categoryId || null,
        attributes: attributes || [],
        thumbnail_url: thumbnailUrl || null,
        attachments: attachments || [],
        status: 'new',
        created_at: new Date().toISOString()
    });
    if (error) handleError(error, 'createEnhancedSupplierProposal');
};

/**
 * Helper function to generate RFQ ID
 */
const generateRFQId = (): string => {
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `RFQ-${year}-${random}`;
};

/**
 * Helper function to generate UUID
 */
const generateUUID = (): string => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

/**
 * Convert a supplier proposal to an RFQ (PM action)
 */
export const convertProposalToRFQ = async (
    proposalId: string,
    createdBy: string,
    supplierIds: string[]
): Promise<RFQ> => {
    // 1. Fetch the proposal
    const { data: proposalData, error: fetchError } = await supabase
        .from('supplier_proposals')
        .select('*')
        .eq('id', proposalId)
        .single();

    if (fetchError || !proposalData) {
        handleError(fetchError, 'convertProposalToRFQ - fetch');
        throw new Error('Proposal not found');
    }

    // 2. Create RFQ from proposal data
    const rfqId = generateRFQId();
    const { data: rfqData, error: rfqError } = await supabase
        .from('rfqs')
        .insert({
            title: proposalData.title,
            rfq_id: rfqId,
            description: proposalData.description,
            created_by: createdBy,
            category_id: proposalData.category_id,
            attributes: proposalData.attributes || [],
            thumbnail_url: proposalData.thumbnail_url,
            attachments: proposalData.attachments || [],
            status: RFQStatus.OPEN,
            created_at: new Date().toISOString()
        })
        .select()
        .single();

    if (rfqError) {
        handleError(rfqError, 'convertProposalToRFQ - create RFQ');
        throw new Error('Failed to create RFQ');
    }

    // 3. Create RFQ entries for selected suppliers
    if (supplierIds && supplierIds.length > 0) {
        const entriesPayload = supplierIds.map(sid => ({
            rfq_id: rfqData.id,
            supplier_id: sid,
            token: generateUUID(),
            status: RFQEntryStatus.PENDING,
            created_at: new Date().toISOString()
        }));

        const { error: entriesError } = await supabase.from('rfq_entries').insert(entriesPayload);
        if (entriesError) {
            handleError(entriesError, 'convertProposalToRFQ - create entries');
            throw new Error('Failed to create RFQ entries');
        }
    }

    // 4. Update proposal status
    const { error: updateError } = await supabase
        .from('supplier_proposals')
        .update({ status: 'converted_to_rfq' })
        .eq('id', proposalId);

    if (updateError) {
        handleError(updateError, 'convertProposalToRFQ - update status');
        throw new Error('Failed to update proposal status');
    }

    return {
        id: rfqData.id,
        rfqId: rfqData.rfq_id,
        title: rfqData.title,
        description: rfqData.description,
        attributes: rfqData.attributes || [],
        thumbnailUrl: rfqData.thumbnail_url,
        attachments: rfqData.attachments || [],
        createdBy: rfqData.created_by,
        createdAt: rfqData.created_at,
        status: rfqData.status,
        categoryId: rfqData.category_id
    };
};
