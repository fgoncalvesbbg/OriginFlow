/**
 * Supplier service
 * Manages supplier information and portal tokens
 */

import { supabase, portalClient } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { Supplier } from '../../types';
import { mapSupplier } from '../../utils/mappers.utils';
import { handleError, generateUUID } from '../../utils';

/**
 * Get all suppliers
 */
export const getSuppliers = async (): Promise<Supplier[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('suppliers').select('*');
    if (error) {
        console.error("getSuppliers failed", error);
        return [];
    }
    return (data || []).map(mapSupplier);
};

/**
 * Get supplier by ID
 */
export const getSupplierById = async (id: string, signal?: AbortSignal): Promise<Supplier | undefined> => {
    if (!id || !isLive) return undefined;
    const { data, error } = await supabase.from('suppliers').select('*').eq('id', id).single();
    if (error || !data) return undefined;
    return mapSupplier(data);
};

/**
 * Get supplier by portal token
 */
export const getSupplierByToken = async (token: string, signal?: AbortSignal): Promise<Supplier | undefined> => {
    if (!isLive) return undefined;
    const { data, error } = await portalClient.from('suppliers').select('*').eq('portal_token', token).maybeSingle();
    if (error) return undefined;
    return data ? mapSupplier(data) : undefined;
};

/**
 * Create a new supplier
 */
export const createSupplier = async (name: string, code: string, email: string): Promise<Supplier> => {
    const { data, error } = await supabase.from('suppliers').insert({ name, code, email }).select().single();
    if (error) handleError(error, 'createSupplier');
    return mapSupplier(data);
};

/**
 * Update supplier information
 */
export const updateSupplier = async (id: string, updates: Partial<Supplier>): Promise<Supplier> => {
    const { data, error } = await supabase.from('suppliers').update({
        name: updates.name,
        code: updates.code,
        email: updates.email
    }).eq('id', id).select().single();
    if (error) handleError(error, 'updateSupplier');
    return mapSupplier(data);
};

/**
 * Generate a 6-digit numeric access code
 */
const generateAccessCode = (): string => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Ensure supplier has a portal token (create if doesn't exist)
 */
export const ensureSupplierToken = async (supplierId: string): Promise<string> => {
    if (!supplierId) throw new Error("Supplier ID is required");

    const sup = await getSupplierById(supplierId);
    if (!sup) throw new Error("Supplier not found");
    if (sup.portalToken) return sup.portalToken;

    const token = generateUUID();
    const { error } = await supabase.from('suppliers').update({ portal_token: token }).eq('id', supplierId);

    if (error) {
        handleError(error, 'ensureSupplierToken');
        throw new Error(`Failed to generate access token: ${error.message}`);
    }

    return token;
};

/**
 * Ensure supplier has an access code (create if doesn't exist)
 */
export const ensureSupplierAccessCode = async (supplierId: string, signal?: AbortSignal): Promise<string> => {
    if (!supplierId) throw new Error("Supplier ID is required");

    const sup = await getSupplierById(supplierId, signal);
    if (!sup) throw new Error("Supplier not found");
    if (sup.accessCode) return sup.accessCode;

    const accessCode = generateAccessCode();
    if (!accessCode) {
        throw new Error("Failed to generate access code");
    }

    const { data, error } = await supabase
        .from('suppliers')
        .update({ access_code: accessCode })
        .eq('id', supplierId)
        .select('access_code')
        .single()
        .abortSignal(signal);

    if (error) {
        console.error('Error creating access code:', error);
        handleError(error, 'ensureSupplierAccessCode');
        throw new Error(`Failed to generate access code: ${error.message}`);
    }

    if (!data?.access_code) {
        throw new Error("Access code was not saved properly. Please try again.");
    }

    return data.access_code;
};

/**
 * Regenerate supplier access code (for resending via email)
 */
export const regenerateSupplierAccessCode = async (supplierId: string): Promise<string> => {
    if (!supplierId) throw new Error("Supplier ID is required");

    const sup = await getSupplierById(supplierId);
    if (!sup) throw new Error("Supplier not found");

    const accessCode = generateAccessCode();
    if (!accessCode) {
        throw new Error("Failed to generate new access code");
    }

    const { data, error } = await supabase
        .from('suppliers')
        .update({ access_code: accessCode })
        .eq('id', supplierId)
        .select('access_code')
        .single();

    if (error) {
        console.error('Error regenerating access code:', error);
        handleError(error, 'regenerateSupplierAccessCode');
        throw new Error(`Failed to regenerate access code: ${error.message}`);
    }

    if (!data?.access_code) {
        throw new Error("New access code was not saved properly. Please try again.");
    }

    return data.access_code;
};
