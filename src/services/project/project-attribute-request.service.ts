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

export const getAttributeRequestByToken = async (token: string): Promise<ProjectAttributeRequest | null> => {
  if (!isLive) return null;
  const { data, error } = await portalClient
    .from('project_attribute_requests')
    .select('*')
    .eq('token', token)
    .single();
  if (error || !data) return null;
  return map(data);
};

export const submitAttributeRequest = async (token: string, submittedData: SubmittedValue[]): Promise<void> => {
  if (!isLive) throw new Error('Database not configured.');
  const { error } = await portalClient
    .from('project_attribute_requests')
    .update({ status: 'submitted', submitted_data: submittedData, submitted_at: new Date().toISOString() })
    .eq('token', token);
  if (error) {
    console.error('submitAttributeRequest error:', error);
    throw new Error(error.message || 'Failed to submit');
  }
};
