/**
 * Project attribute-request service — CRUD for supplier attribute-data requests, including the
 * token-based supplier-portal submission flow (via portalClient).
 */
import { supabase, portalClient } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { ProjectAttributeRequest } from '../../types';
import { generateUUID } from '../../utils';

type SubmittedValue = { attributeId: string; name: string; value: string; type?: string };

const map = (r: any): ProjectAttributeRequest => ({
  id: r.id,
  projectId: r.project_id,
  projectIdCode: r.project_id_code ?? '',
  categoryId: r.category_id ?? null,
  projectName: r.project_name ?? '',
  categoryName: r.category_name ?? '',
  token: r.token,
  step: r.step ?? 2,
  skuNumber: r.sku_number ?? '',
  skuTitle: r.sku_title ?? '',
  status: r.status,
  submittedData: r.submitted_data ?? null,
  note: r.note ?? null,
  createdAt: r.created_at,
  submittedAt: r.submitted_at ?? null,
});

export const createAttributeRequest = async (
  projectId: string,
  projectName: string,
  projectIdCode: string,
  categoryId: string | null,
  categoryName: string,
  step: 2 | 3,
  skuNumber: string,
  skuTitle: string,
  note?: string,
  prefillData?: SubmittedValue[]
): Promise<ProjectAttributeRequest> => {
  if (!isLive) throw new Error('Database not configured.');

  const token = generateUUID();

  const { data, error } = await supabase
    .from('project_attribute_requests')
    .insert({
      project_id: projectId,
      project_name: projectName,
      project_id_code: projectIdCode,
      category_id: categoryId,
      category_name: categoryName,
      step,
      sku_number: skuNumber,
      sku_title: skuTitle,
      note: note || null,
      token,
      submitted_data: prefillData?.length ? prefillData : null,
    })
    .select()
    .single();

  if (error) {
    console.error('createAttributeRequest error:', error);
    throw new Error(error.message || 'Failed to create request');
  }
  return map(data);
};

export const getAttributeRequestsByProject = async (projectId: string): Promise<ProjectAttributeRequest[]> => {
  if (!isLive) return [];
  const { data, error } = await supabase
    .from('project_attribute_requests')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getAttributeRequestsByProject error:', error);
    return [];
  }
  return (data || []).map(map);
};

/**
 * Attribute-data requests for a project, addressed by the project's supplier-link token
 * (the public SupplierPortal). Uses the get_attribute_requests_by_project_token
 * SECURITY DEFINER RPC: the project_attribute_requests table is not readable by the
 * anonymous `anon` role the portal client runs as.
 */
export const getAttributeRequestsByProjectPublic = async (projectToken: string): Promise<ProjectAttributeRequest[]> => {
  if (!isLive || !projectToken) return [];
  const { data, error } = await portalClient.rpc('get_attribute_requests_by_project_token', { p_project_token: projectToken });
  if (error) {
    console.error('getAttributeRequestsByProjectPublic error:', error);
    return [];
  }
  return (data || []).map(map);
};

/**
 * All attribute-data requests across a supplier's projects, for the access-code-verified
 * supplier dashboard. Uses the get_attribute_requests_by_supplier SECURITY DEFINER RPC
 * (validates the supplier's portal token + access code) rather than a direct table read,
 * which RLS blocks for the anonymous portal client.
 */
export const getAttributeRequestsForSupplier = async (supplierToken: string, accessCode: string): Promise<ProjectAttributeRequest[]> => {
  if (!isLive || !supplierToken || !accessCode) return [];
  const { data, error } = await portalClient.rpc('get_attribute_requests_by_supplier', {
    p_supplier_token: supplierToken,
    p_code: accessCode,
  });
  if (error) {
    console.error('getAttributeRequestsForSupplier error:', error);
    return [];
  }
  return (data || []).map(map);
};

export const getAttributeRequestByToken = async (token: string): Promise<ProjectAttributeRequest | null> => {
  if (!isLive || !token) return null;
  // The project_attribute_requests table is not readable by the anonymous `anon`
  // role the portal client runs as, so go through the get_attribute_request_by_token
  // SECURITY DEFINER RPC (granted to anon) instead of a direct table read.
  const { data, error } = await portalClient.rpc('get_attribute_request_by_token', { p_token: token });
  if (error) {
    console.error('getAttributeRequestByToken error:', error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row ? map(row) : null;
};

export const deleteAttributeRequest = async (id: string): Promise<void> => {
  if (!isLive) throw new Error('Database not configured.');
  const { error } = await supabase
    .from('project_attribute_requests')
    .delete()
    .eq('id', id);
  if (error) {
    console.error('deleteAttributeRequest error:', error);
    throw new Error(error.message || 'Failed to delete request');
  }
};

// PM/admin-side direct edit of a request's attribute data (by id, not token).
export const updateAttributeRequestData = async (id: string, submittedData: SubmittedValue[]): Promise<ProjectAttributeRequest> => {
  if (!isLive) throw new Error('Database not configured.');
  const { data, error } = await supabase
    .from('project_attribute_requests')
    .update({ submitted_data: submittedData })
    .eq('id', id)
    .select()
    .single();
  if (error) {
    console.error('updateAttributeRequestData error:', error);
    throw new Error(error.message || 'Failed to update attributes');
  }
  return map(data);
};

export const submitAttributeRequest = async (token: string, submittedData: SubmittedValue[]): Promise<void> => {
  if (!isLive) throw new Error('Database not configured.');
  // Submit via the submit_attribute_request_secure SECURITY DEFINER RPC: the anon
  // portal client cannot UPDATE the table directly under RLS.
  const { error } = await portalClient.rpc('submit_attribute_request_secure', {
    p_token: token,
    p_data: submittedData,
  });
  if (error) {
    console.error('submitAttributeRequest error:', error);
    throw new Error(error.message || 'Failed to submit');
  }
};
