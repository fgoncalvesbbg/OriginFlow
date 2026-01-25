/**
 * Compliance service
 * Manages compliance requests and responses
 */

import { supabase, portalClient } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { ComplianceRequest, ComplianceResponseItem, ComplianceRequestStatus } from '../../types';
import { mapComplianceRequest } from '../../utils/mappers.utils';
import { handleError, generateUUID } from '../../utils';

/**
 * Get all compliance requests
 */
export const getComplianceRequests = async (): Promise<ComplianceRequest[]> => {
  if (!isLive) return [];
  const { data, error } = await supabase.from('compliance_requests').select('*').order('created_at', { ascending: false });
  if (error) return [];
  return (data || []).map(mapComplianceRequest);
};

/**
 * Get compliance request by ID
 */
export const getComplianceRequestById = async (id: string): Promise<ComplianceRequest | undefined> => {
  if (!id || !isLive) return undefined;
  const { data, error } = await supabase.from('compliance_requests').select('*').eq('id', id).single();
  if (error) return undefined;
  return mapComplianceRequest(data);
};

/**
 * Get compliance request by token (for supplier portal)
 */
export const getComplianceRequestByToken = async (token: string): Promise<ComplianceRequest | undefined> => {
    if (!isLive) return undefined;
    const { data, error } = await portalClient.from('compliance_requests').select('*').eq('token', token).maybeSingle();
    if (error) return undefined;
    if (!data) return undefined;
    return mapComplianceRequest(data);
};

/**
 * Get all compliance requests for a specific supplier
 */
export const getComplianceRequestsBySupplierId = async (supplierId: string): Promise<ComplianceRequest[]> => {
    if (!isLive) return [];
    const { data, error } = await portalClient.from('compliance_requests').select('*').eq('supplier_id', supplierId);
    if (error) return [];
    return (data || []).map(mapComplianceRequest);
};

/**
 * Create a new compliance request
 */
export const createComplianceRequest = async (
  projectId: string, projectName: string, requestIdCode: string, supplierId: string,
  categoryId: string, features: { featureId: string; value: boolean }[], deadline?: string
): Promise<ComplianceRequest> => {
  const token = generateUUID();
  const accessCode = Math.floor(100000 + Math.random() * 900000).toString();

  const { data, error } = await supabase.from('compliance_requests').insert({
    project_id: projectId || null,
    project_name: projectName,
    request_id: requestIdCode,
    supplier_id: supplierId,
    category_id: categoryId,
    features,
    status: ComplianceRequestStatus.PENDING_SUPPLIER,
    token,
    access_code: accessCode,
    deadline: deadline || null,
    created_at: new Date().toISOString()
  }).select().single();
  if (error) handleError(error, 'create compliance req');
  return mapComplianceRequest(data);
};

/**
 * Verify supplier access to compliance request using token and access code
 */
export const verifySupplierAccess = async (token: string, accessCode: string): Promise<ComplianceRequest> => {
    if (!isLive) throw new Error("Connection error: Supabase is not configured.");
    const { data, error } = await portalClient.rpc('get_compliance_request_secure', {
        p_token: token,
        p_code: accessCode
    });

    if (error) handleError(error, 'verify access');
    if (!data) throw new Error('Invalid credentials');

    const requestData = Array.isArray(data) ? data[0] : data;
    if (!requestData) throw new Error('Invalid credentials');

    return mapComplianceRequest(requestData);
};

/**
 * Submit compliance response from supplier (secure, token-based)
 */
export const submitComplianceResponseSecure = async (
    token: string,
    accessCode: string,
    responses: ComplianceResponseItem[],
    status: ComplianceRequestStatus,
    respondentName: string,
    respondentPosition: string
): Promise<void> => {
    const { error } = await portalClient.rpc('submit_compliance_response_secure', {
        p_token: token,
        p_code: accessCode,
        p_responses: responses,
        p_status: status,
        p_respondent_name: respondentName,
        p_respondent_position: respondentPosition
    });

    if (error) handleError(error, 'submit response');
};

/**
 * Submit compliance response (authenticated)
 */
export const submitComplianceResponse = async (reqId: string, responses: ComplianceResponseItem[], status?: ComplianceRequestStatus, user?: string): Promise<void> => {
    const updates: any = { responses, submitted_at: new Date().toISOString() };
    if (status) updates.status = status;
    if (status === ComplianceRequestStatus.APPROVED) updates.completed_at = new Date().toISOString();
    if (user) updates.updated_by = user;

    await supabase.from('compliance_requests').update(updates).eq('id', reqId);
};

/**
 * Delete a compliance request
 */
export const deleteComplianceRequest = async (id: string): Promise<void> => {
    await supabase.from('compliance_requests').delete().eq('id', id);
};

/**
 * Check and process compliance deadlines (empty stub for now)
 */
export const checkComplianceDeadlines = async (): Promise<void> => {
};
