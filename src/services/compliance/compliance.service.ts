/**
 * Compliance service
 * Manages compliance requests and responses
 */

import { db, portalDb, orEmpty, orUndefined, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { ComplianceRequest, ComplianceResponseItem, ComplianceRequestStatus } from '../../types';
import { mapComplianceRequest } from '../../utils/mappers.utils';
import { generateUUID, generateNumericCode } from '../../utils';
import { upsertSupplierNotification } from '../shared/notification.service';

/**
 * Get all compliance requests
 */
export const getComplianceRequests = async (): Promise<ComplianceRequest[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('compliance_requests', { order: { column: 'created_at', ascending: false } }),
    'getComplianceRequests',
  );
  return rows.map(mapComplianceRequest);
};

/**
 * Get compliance request by ID
 */
export const getComplianceRequestById = async (id: string): Promise<ComplianceRequest | undefined> => {
  if (!id || !isLive) return undefined;
  const row = await orUndefined(
    db.selectMaybeOne<Row>('compliance_requests', { where: { id } }),
    'getComplianceRequestById',
  );
  return row ? mapComplianceRequest(row) : undefined;
};

/**
 * Compliance requests for a supplier in the standalone compliance portal
 * (/compliance/supplier-portal), where the supplier authenticates with their supplier
 * code + 6-digit portal access code. Uses the get_compliance_requests_by_supplier_code
 * SECURITY DEFINER routine, which validates code + access code server-side, so the data is
 * only listed for someone who already holds the access code (no unauthenticated lookups).
 */
export const getComplianceRequestsBySupplierCode = async (code: string, accessCode: string): Promise<ComplianceRequest[]> => {
    if (!isLive || !code || !accessCode) return [];
    const rows = await orEmpty(
        portalDb.rpc<Row[]>('get_compliance_requests_by_supplier_code', {
            p_code: code,
            p_access_code: accessCode,
        }),
        'getComplianceRequestsBySupplierCode',
    );
    return (rows || []).map(mapComplianceRequest);
};

/**
 * Compliance requests for a supplier in the access-code-verified supplier portal.
 * Uses the get_compliance_requests_by_supplier SECURITY DEFINER routine (validates the
 * supplier's portal token + access code); the compliance_requests table is not readable
 * by the anonymous portal client under row-level security.
 */
export const getComplianceRequestsBySupplierToken = async (supplierToken: string, accessCode: string): Promise<ComplianceRequest[]> => {
    if (!isLive || !supplierToken || !accessCode) return [];
    const rows = await orEmpty(
        portalDb.rpc<Row[]>('get_compliance_requests_by_supplier', {
            p_supplier_token: supplierToken,
            p_code: accessCode,
        }),
        'getComplianceRequestsBySupplierToken',
    );
    return (rows || []).map(mapComplianceRequest);
};

/**
 * Create a new compliance request
 */
export const createComplianceRequest = async (
  projectId: string, projectName: string, requestIdCode: string, supplierId: string,
  categoryId: string, features: { featureId: string; value: boolean }[], deadline?: string,
  conditionAttributes: Record<string, string> = {}
): Promise<ComplianceRequest> => {
  const token = generateUUID();
  const accessCode = generateNumericCode(6);

  const created = await db.insert<Row>('compliance_requests', {
    project_id: projectId || null,
    project_name: projectName,
    request_id: requestIdCode,
    supplier_id: supplierId,
    category_id: categoryId,
    features,
    condition_attributes: conditionAttributes,
    status: ComplianceRequestStatus.PENDING_SUPPLIER,
    token,
    access_code: accessCode,
    deadline: deadline || null,
    created_at: new Date().toISOString()
  });
  return mapComplianceRequest(created);
};

/**
 * Verify supplier access to compliance request using token and access code
 */
export const verifySupplierAccess = async (token: string, accessCode: string): Promise<ComplianceRequest> => {
    if (!isLive) throw new Error("Connection error: the database is not configured.");
    const data = await portalDb.rpc<Row | Row[] | null>('get_compliance_request_secure', {
        p_token: token,
        p_code: accessCode
    });

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
    await portalDb.rpc('submit_compliance_response_secure', {
        p_token: token,
        p_code: accessCode,
        p_responses: responses,
        p_status: status,
        p_respondent_name: respondentName,
        p_respondent_position: respondentPosition
    });
};

/**
 * Submit compliance response (authenticated)
 */
export const submitComplianceResponse = async (reqId: string, responses: ComplianceResponseItem[], status?: ComplianceRequestStatus, user?: string): Promise<void> => {
    const updates: Row = { responses, submitted_at: new Date().toISOString() };
    if (status) updates.status = status;
    if (status === ComplianceRequestStatus.APPROVED) updates.completed_at = new Date().toISOString();
    if (user) updates.updated_by = user;

    await db.updateWhere('compliance_requests', updates, { where: { id: reqId } });
};

/**
 * Delete a compliance request
 */
export const deleteComplianceRequest = async (id: string): Promise<void> => {
    await db.delete('compliance_requests', { where: { id } });
};

/**
 * Check pending compliance deadlines and keep supplier notifications in sync.
 */
export const checkComplianceDeadlines = async (): Promise<void> => {
    if (!isLive) return;

    let rows: Row[];
    try {
        rows = await db.select<Row>('compliance_requests', {
            where: {
                status: ComplianceRequestStatus.PENDING_SUPPLIER,
                deadline: { op: 'isNotNull' },
            },
        });
    } catch (e) {
        console.warn('Failed to check compliance deadlines:', e);
        return;
    }

    const now = new Date();
    const msPerDay = 24 * 60 * 60 * 1000;
    const reminderWindowDays = 14;

    for (const rawRequest of rows) {
        const request = mapComplianceRequest(rawRequest);
        if (!request.deadline || !request.supplierId) continue;

        const deadlineDate = new Date(request.deadline);
        if (Number.isNaN(deadlineDate.getTime())) continue;

        const daysLeft = Math.ceil((deadlineDate.getTime() - now.getTime()) / msPerDay);
        if (daysLeft > reminderWindowDays) continue;

        let message = `Compliance request ${request.requestId} is due on ${deadlineDate.toLocaleDateString()}.`;
        if (daysLeft < 0) {
            message = `Compliance request ${request.requestId} is overdue by ${Math.abs(daysLeft)} day(s).`;
        } else if (daysLeft === 0) {
            message = `Compliance request ${request.requestId} is due today.`;
        } else {
            message = `Compliance request ${request.requestId} is due in ${daysLeft} day(s).`;
        }

        await upsertSupplierNotification({
            supplierId: request.supplierId,
            message,
            link: `/compliance/supplier/${request.token}`
        });
    }
};
