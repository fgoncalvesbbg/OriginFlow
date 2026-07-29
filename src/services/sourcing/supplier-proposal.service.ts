/**
 * Supplier proposal service
 * Manages supplier proposals
 */

import { db, portalDb, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { SupplierProposal, RFQAttributeValue, RFQAttachment, RFQ, RFQStatus, RFQEntryStatus } from '../../types';
import { generateUUID, generateNumericCode } from '../../utils';

const mapProposal = (p: any): SupplierProposal => ({
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
});

/**
 * Get all supplier proposals
 */
export const getAllSupplierProposals = async (): Promise<SupplierProposal[]> => {
    if (!isLive) return [];
    // Server-side join on the supplier name — see data/PORTING.md.
    const rows = await db.select<Row>('supplier_proposals', {
        columns: '*, supplier:suppliers(name)',
        order: { column: 'created_at', ascending: false },
    });
    return rows.map(mapProposal);
};

/**
 * Get proposals for a supplier in the access-code-verified supplier portal.
 * Uses the get_supplier_proposals SECURITY DEFINER routine (validates the supplier's
 * portal token + access code); the supplier_proposals table is not readable by the
 * anonymous portal client under row-level security.
 */
export const getSupplierProposals = async (supplierToken: string, accessCode: string): Promise<SupplierProposal[]> => {
    if (!isLive || !supplierToken || !accessCode) return [];
    const rows = await orEmpty(
        portalDb.rpc<Row[]>('get_supplier_proposals', {
            p_supplier_token: supplierToken,
            p_code: accessCode,
        }),
        'getSupplierProposals',
    );
    return (rows || []).map(mapProposal);
};

/**
 * Create an enhanced supplier proposal with full RFQ structure
 */
export const createEnhancedSupplierProposal = async (
    supplierToken: string,
    accessCode: string,
    title: string,
    description: string,
    categoryId?: string,
    attributes?: RFQAttributeValue[],
    thumbnailUrl?: string,
    attachments?: RFQAttachment[]
): Promise<void> => {
    // Insert via the create_supplier_proposal_secure SECURITY DEFINER routine: it validates
    // the supplier's portal token + access code, so the anonymous portal client never
    // writes to the supplier_proposals table directly (which row-level security would block).
    await portalDb.rpc('create_supplier_proposal_secure', {
        p_supplier_token: supplierToken,
        p_code: accessCode,
        p_title: title,
        p_description: description,
        p_category_id: categoryId || '',
        p_attributes: attributes || [],
        p_thumbnail_url: thumbnailUrl || null,
        p_attachments: attachments || [],
    });
};

/**
 * Helper function to generate RFQ ID
 */
const generateRFQId = (): string => {
    const year = new Date().getFullYear();
    const random = generateNumericCode(4);
    return `RFQ-${year}-${random}`;
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
    const proposalData = await db.selectMaybeOne<Row>('supplier_proposals', { where: { id: proposalId } });
    if (!proposalData) throw new Error('Proposal not found');

    // 2. Create RFQ from proposal data
    const rfqId = generateRFQId();
    const rfqData = await db.insert<Row>('rfqs', {
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
    });

    // 3. Create RFQ entries for selected suppliers
    if (supplierIds && supplierIds.length > 0) {
        const entriesPayload = supplierIds.map(sid => ({
            rfq_id: rfqData.id,
            supplier_id: sid,
            token: generateUUID(),
            status: RFQEntryStatus.PENDING,
            created_at: new Date().toISOString()
        }));
        await db.insertMany('rfq_entries', entriesPayload);
    }

    // 4. Update proposal status
    await db.updateWhere('supplier_proposals', { status: 'converted_to_rfq' }, { where: { id: proposalId } });

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
