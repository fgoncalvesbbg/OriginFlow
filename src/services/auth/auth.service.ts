/**
 * Authentication service
 * Handles user login, signup, logout, and session management
 */

import { auth } from '../../data';
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
    // The port rejects on bad credentials, so reaching this line means a real session.
    const session = await auth.signInWithPassword(email, pass);
    const profile = await getUserProfile(session.user.id);
    if (profile) return profile;
    return mapProfile({ id: session.user.id, email: email, name: 'User', role: UserRole.PM });
};

/**
 * Sign up new user with email, password, and name
 */
export const signUp = async (email: string, pass: string, name: string): Promise<void> => {
    if (!isLive) handleError(null, 'signUp');
    await auth.signUp(email, pass, { name });
};

/**
 * Logout current user
 */
export const logout = async (): Promise<void> => {
    await auth.signOut();
};
