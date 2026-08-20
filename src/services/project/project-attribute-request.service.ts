/**
 * Project attribute-request service — CRUD for supplier attribute-data requests, including the
 * token-based supplier-portal submission flow (via the public portal client).
 */
import { db, portalDb, orEmpty, type Row } from '../../data';
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
  deadline: r.deadline ?? null,
  copiedFromSku: r.copied_from_sku ?? null,
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
  prefillData?: SubmittedValue[],
  deadline?: string | null,
  copiedFromSku?: string | null
): Promise<ProjectAttributeRequest> => {
  if (!isLive) throw new Error('Database not configured.');

  const token = generateUUID();

  const created = await db.insert<Row>('project_attribute_requests', {
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
    deadline: deadline || null,
    copied_from_sku: copiedFromSku || null,
  });
  return map(created);
};

export const getAttributeRequestsByProject = async (projectId: string): Promise<ProjectAttributeRequest[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('project_attribute_requests', {
      where: { project_id: projectId },
      order: { column: 'created_at', ascending: false },
    }),
    'getAttributeRequestsByProject',
  );
  return rows.map(map);
};

/**
 * Attribute-data requests for a project, addressed by the project's supplier-link token
 * (the public SupplierPortal). Uses the get_attribute_requests_by_project_token
 * SECURITY DEFINER routine: the project_attribute_requests table is not readable by the
 * anonymous `anon` role the portal client runs as.
 */
export const getAttributeRequestsByProjectPublic = async (projectToken: string): Promise<ProjectAttributeRequest[]> => {
  if (!isLive || !projectToken) return [];
  const rows = await orEmpty(
    portalDb.rpc<Row[]>('get_attribute_requests_by_project_token', { p_project_token: projectToken }),
    'getAttributeRequestsByProjectPublic',
  );
  return (rows || []).map(map);
};

/**
 * All attribute-data requests across a supplier's projects, for the access-code-verified
 * supplier dashboard. Uses the get_attribute_requests_by_supplier SECURITY DEFINER routine
 * (validates the supplier's portal token + access code) rather than a direct table read,
 * which row-level security blocks for the anonymous portal client.
 */
export const getAttributeRequestsForSupplier = async (supplierToken: string, accessCode: string): Promise<ProjectAttributeRequest[]> => {
  if (!isLive || !supplierToken || !accessCode) return [];
  const rows = await orEmpty(
    portalDb.rpc<Row[]>('get_attribute_requests_by_supplier', {
      p_supplier_token: supplierToken,
      p_code: accessCode,
    }),
    'getAttributeRequestsForSupplier',
  );
  return (rows || []).map(map);
};

export const getAttributeRequestByToken = async (token: string): Promise<ProjectAttributeRequest | null> => {
  if (!isLive || !token) return null;
  // The project_attribute_requests table is not readable by the anonymous `anon`
  // role the portal client runs as, so go through the get_attribute_request_by_token
  // SECURITY DEFINER routine (granted to anon) instead of a direct table read.
  try {
    const data = await portalDb.rpc<Row | Row[] | null>('get_attribute_request_by_token', { p_token: token });
    const row = Array.isArray(data) ? data[0] : data;
    return row ? map(row) : null;
  } catch (e) {
    console.error('getAttributeRequestByToken error:', e);
    return null;
  }
};

export const deleteAttributeRequest = async (id: string): Promise<void> => {
  if (!isLive) throw new Error('Database not configured.');
  await db.delete('project_attribute_requests', { where: { id } });
};

// PM/admin-side direct edit of a request's attribute data (by id, not token).
export const updateAttributeRequestData = async (id: string, submittedData: SubmittedValue[]): Promise<ProjectAttributeRequest> => {
  if (!isLive) throw new Error('Database not configured.');
  const updated = await db.update<Row>(
    'project_attribute_requests',
    { submitted_data: submittedData },
    { where: { id } },
  );
  return map(updated);
};

export const submitAttributeRequest = async (token: string, submittedData: SubmittedValue[]): Promise<void> => {
  if (!isLive) throw new Error('Database not configured.');
  // Submit via the submit_attribute_request_secure SECURITY DEFINER routine: the anon
  // portal client cannot UPDATE the table directly under row-level security.
  await portalDb.rpc('submit_attribute_request_secure', {
    p_token: token,
    p_data: submittedData,
  });
};
