
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '../types';
import { getUserProfile, login as apiLogin, logout as apiLogout } from '../services/apiService';
import { supabase, isLive } from '../services/core/supabase.client';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

// Added comment above fix: Initializing the AuthContext
const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Added comment above fix: Managing user and loading state
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    try {
      const profile = await getUserProfile(userId);
      setUser(profile);
    } catch (e: any) {
      console.warn("[Auth] Failed to fetch profile (may be non-PM user):", e.message);
      setUser(null);
    }
  };

  const refreshProfile = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await fetchProfile(session.user.id);
      }
    } catch (e: any) {
      console.error("[Auth] Error refreshing profile:", e.message);
    }
  };

  // Added comment above fix: Subscribing to auth changes on component mount
  useEffect(() => {
    if (!isLive) {
        setIsLoading(false);
        return;
    }

    let isMounted = true;

    const initializeAuth = async () => {
      // Determine if we are on a public portal route
      const isPortal = window.location.hash.includes('/supplier/') || 
                       window.location.hash.includes('/compliance/supplier/') ||
                       window.location.hash.includes('/sourcing/supplier/') ||
                       window.location.hash.includes('/supplier-dashboard/');

      try {
        // If on portal, we bypass session fetching to avoid Lock conflicts
        if (isPortal) {
           console.debug("[Auth] Public Portal detected. Bypassing PM profile initialization.");
           setIsLoading(false);
           return;
        }

        // 1. Check initial session for PM/Admin users
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
           console.warn("[Auth] Session check failed (common on public portals):", error.message);
        }

        if (isMounted && session?.user) {
          await fetchProfile(session.user.id);
        }
      } catch (e: any) {
        // Log but don't block app mount
        console.warn("[Auth] Caught error during session init:", e.message);
      } finally {
        if (isMounted) setIsLoading(false);
      }

      // 2. Listen for session changes
      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        console.debug('[Auth] Session event:', event);
        if (isMounted) {
          if (session?.user) {
            await fetchProfile(session.user.id);
          } else {
            setUser(null);
          }
          setIsLoading(false);
        }
      });

      return () => {
        isMounted = false;
        subscription.unsubscribe();
      };
    };

    initializeAuth();
  }, []);

  const login = async (email: string, pass: string) => {
    await apiLogin(email, pass);
  };

  const logout = async () => {
    await apiLogout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated: !!user, 
      isLoading, 
      login, 
      logout,
      refreshProfile
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  // Added comment above fix: Consuming the AuthContext via hook
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
