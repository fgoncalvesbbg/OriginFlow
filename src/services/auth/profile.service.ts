/**
 * User profile service
 * Handles user profile CRUD operations and role management
 */

import { auth, db, orEmpty } from '../../data';
import { isLive } from '../../config/environment.config';
import { User, UserRole } from '../../types';
import { mapProfile } from '../../utils/mappers.utils';

interface ProfileRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  is_super_admin?: boolean;
}

/**
 * Get all user profiles
 */
export const getProfiles = async (): Promise<User[]> => {
    if (!isLive) return [];
    const rows = await orEmpty(db.select<ProfileRow>('profiles'), 'getProfiles');
    return rows.map(mapProfile);
};

/**
 * Get a specific user profile by ID
 */
export const getUserProfile = async (userId: string): Promise<User | null> => {
    if (!isLive) return null;
    const existing = await db.selectMaybeOne<ProfileRow>('profiles', { where: { id: userId } });
    if (existing) return mapProfile(existing);

    // No profile row yet: self-provision one for the signed-in user on first login.
    const user = await auth.getUser();
    if (user?.id !== userId) return null;

    try {
        const created = await db.insert<ProfileRow>('profiles', {
            id: userId,
            email: user.email || '',
            name: (user.metadata?.name as string | undefined) || 'User',
            role: UserRole.PM,
        });
        return mapProfile(created);
    } catch {
        return null;
    }
};

/**
 * Update user role
 */
export const updateUserRole = async (userId: string, role: UserRole): Promise<void> => {
    await db.updateWhere('profiles', { role }, { where: { id: userId } });
};

/**
 * Grant or revoke the Super Admin tier.
 *
 * The database is the real gate, not this call: a BEFORE UPDATE trigger on
 * `profiles` (migration 154) reverts any change to `is_super_admin` made by a
 * caller who is not already a super admin, and the `Super admins update any
 * profile` policy is what lets a super admin write someone else's row at all.
 * So a non-super-admin calling this succeeds at the HTTP level and changes
 * nothing — callers must re-read the profiles to see what actually landed
 * rather than assuming the write took.
 */
export const setSuperAdmin = async (userId: string, isSuperAdmin: boolean): Promise<void> => {
    await db.updateWhere('profiles', { is_super_admin: isSuperAdmin }, { where: { id: userId } });
};
