/**
 * Supplier proposal service
 * Manages supplier proposals
 */

import { supabase, portalClient } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { SupplierProposal } from '../../types';
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
