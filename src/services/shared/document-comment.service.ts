/**
 * Document comment service
 * Manages comments and discussions on documents
 */

import { supabase } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { DocumentComment } from '../../types';
import { handleError } from '../../utils/error.utils';

/**
 * Get all comments for a document
 */
export const getDocumentComments = async (docId: string): Promise<DocumentComment[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('document_comments').select('*').eq('document_id', docId).order('created_at');
    if (error) return [];
    return (data || []).map((c: any) => ({
        id: c.id,
        documentId: c.document_id,
        content: c.content,
        authorName: c.author_name,
        authorRole: c.author_role,
        createdAt: c.created_at
    }));
};

/**
 * Add a comment to a document
 */
export const addDocumentComment = async (docId: string, content: string, authorName: string, authorRole: string): Promise<DocumentComment> => {
    const { data, error } = await supabase.from('document_comments').insert({
        document_id: docId,
        content,
        author_name: authorName,
        author_role: authorRole,
        created_at: new Date().toISOString()
    }).select().single();
    if (error) handleError(error, 'addComment');
    return {
        id: data.id,
        documentId: data.document_id,
        content: data.content,
        authorName: data.author_name,
        authorRole: data.author_role,
        createdAt: data.created_at
    };
};
