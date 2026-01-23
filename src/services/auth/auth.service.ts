/**
 * Authentication service
 * Handles user login, signup, logout, and session management
 */

import { supabase } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { User, UserRole } from '../../types';
import { mapProfile, } from '../../utils/mappers.utils';
import { handleError } from '../../utils/error.utils';
import { getUserProfile } from './profile.service';

/**
 * Login user with email and password
 */
export const login = async (email: string, pass: string): Promise<User> => {
    if (!isLive) handleError(null, 'login');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) handleError(error, 'login');
    if (data.user) {
        const profile = await getUserProfile(data.user.id);
        if (profile) return profile;
        return mapProfile({ id: data.user.id, email: email, name: 'User', role: UserRole.PM });
    }
    throw new Error("Login failed");
};

/**
 * Sign up new user with email, password, and name
 */
export const signUp = async (email: string, pass: string, name: string): Promise<void> => {
    if (!isLive) handleError(null, 'signUp');
    const { data, error } = await supabase.auth.signUp({
        email,
        password: pass,
        options: { data: { name } }
    });
    if (error) handleError(error, 'signUp');
};

/**
 * Logout current user
 */
export const logout = async (): Promise<void> => {
    await supabase.auth.signOut();
};

/**
 * Get current session user
 */
export const getSessionUser = async (): Promise<User | null> => {
    if (!isLive) return null;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return getUserProfile(session.user.id);
};
