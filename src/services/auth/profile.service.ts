/**
 * User profile service
 * Handles user profile CRUD operations and role management
 */

import { supabase } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { User, UserRole } from '../../types';
import { mapProfile } from '../../utils/mappers.utils';

/**
 * Get all user profiles
 */
export const getProfiles = async (): Promise<User[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('profiles').select('*');
    if (error) return [];
    return (data || []).map(mapProfile);
};

/**
 * Get a specific user profile by ID
 */
export const getUserProfile = async (userId: string): Promise<User | null> => {
    if (!isLive) return null;
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();

    if (!data) {
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user?.id === userId) {
            const newProfile = {
                id: userId,
                email: userData.user.email || '',
                name: userData.user.user_metadata?.name || 'User',
                role: UserRole.PM
            };
            const { data: created, error: createError } = await supabase.from('profiles').insert(newProfile).select().single();
            if (createError) return null;
            return mapProfile(created);
        }
        return null;
    }
    return mapProfile(data);
};

/**
 * Update user role
 */
export const updateUserRole = async (userId: string, role: UserRole): Promise<void> => {
    await supabase.from('profiles').update({ role }).eq('id', userId);
};
