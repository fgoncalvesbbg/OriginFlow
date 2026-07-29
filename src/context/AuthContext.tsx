
/**
 * Auth context: tracks the session and current user profile, exposes useAuth(), and
 * subscribes to auth-state changes for the app. Talks to the auth PORT (src/data), never
 * to an identity-provider SDK directly.
 */
import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { User } from '../types';
import { getUserProfile, login as apiLogin, logout as apiLogout } from '../services';
import { auth, withDeadline, type AuthSubscription } from '../data';
import { isLive } from '../config/environment.config';
import { isPortalRoute } from '../config/routes.config';

/**
 * Hard ceiling on how long the app may sit behind the "Loading session…" gate.
 * If session init hasn't settled by now (e.g. a hung getSession on a stale
 * connection), we force the app to render rather than freeze forever — the user
 * lands on login or the app shell and the connection banner takes over.
 */
const AUTH_INIT_WATCHDOG_MS = 12000;
/** Bound for the initial getSession/profile reads so init can't hang. */
const AUTH_REQUEST_TIMEOUT_MS = 10000;

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
  // Mirror of `user` readable inside async callbacks without stale closures.
  const userRef = useRef<User | null>(null);
  userRef.current = user;

  const fetchProfile = async (userId: string) => {
    try {
      const profile = await withDeadline(
        () => getUserProfile(userId),
        AUTH_REQUEST_TIMEOUT_MS,
        'fetchProfile',
      );
      if (profile) {
        setUser(profile);
      } else if (!userRef.current) {
        // No profile row AND no existing session (fresh load) → unauthenticated.
        setUser(null);
      }
      // Otherwise keep the user we already have.
    } catch (e: any) {
      // NEVER drop an authenticated user on a transient/timeout failure — doing so
      // logs them out mid-operation (e.g. during an AI translation) and bounces
      // them to /login. Only clear if we never had a user to begin with.
      console.warn("[Auth] Profile fetch failed; keeping existing session:", e?.message ?? e);
      if (!userRef.current) setUser(null);
    }
  };

  const refreshProfile = async () => {
    try {
      const session = await auth.getSession();
      if (session?.user) {
        await fetchProfile(session.user.id);
      }
    } catch (e: any) {
      console.error("[Auth] Error refreshing profile:", e.message);
    }
  };

  // Added comment above fix: Subscribing to auth changes on component mount
  useEffect(() => {
    let isMounted = true;
    let settled = false;
    let subscription: AuthSubscription | undefined;

    if (!isLive) {
      setIsLoading(false);
      return () => {
        isMounted = false;
        subscription?.unsubscribe();
      };
    }

    // Watchdog: never let the "Loading session…" gate hang forever. If init has
    // not settled within the deadline (e.g. getSession stuck on a stale socket),
    // force the app to render and log it so the freeze is traceable.
    const stopLoading = () => {
      settled = true;
      if (isMounted) setIsLoading(false);
    };
    const watchdog = setTimeout(() => {
      if (!settled) {
        console.error(
          `[Auth] Session init did not complete within ${AUTH_INIT_WATCHDOG_MS / 1000}s — forcing render. ` +
          'The backend may be unavailable; the reconnect banner will guide recovery.',
        );
        stopLoading();
      }
    }, AUTH_INIT_WATCHDOG_MS);

    const initializeAuth = async () => {
      // Determine if we are on a public portal route
      const isPortal = isPortalRoute();

      try {
        // If on portal, we bypass session fetching to avoid Lock conflicts
        if (isPortal) {
           console.debug("[Auth] Public Portal detected. Bypassing PM profile initialization.");
           return;
        }

        // 1. Check initial session for PM/Admin users (bounded so a stale
        // connection can't wedge the whole app on the loading screen). The port
        // resolves null — and logs why — when there is no usable session, which is
        // routine on public portals.
        const session = await withDeadline(
          () => auth.getSession(),
          AUTH_REQUEST_TIMEOUT_MS,
          'getSession',
        );

        if (isMounted && session?.user) {
          await fetchProfile(session.user.id);
        }
      } catch (e: any) {
        // Log but don't block app mount
        console.warn("[Auth] Caught error during session init:", e?.message ?? e);
      } finally {
        clearTimeout(watchdog);
        stopLoading();
      }

      // 2. Listen for session changes
      subscription = auth.onAuthStateChange(async (event, session) => {
        console.debug('[Auth] Session event:', event);
        if (!isMounted) return;
        try {
          if (event === 'SIGNED_OUT' || !session?.user) {
            // Only an explicit sign-out clears the user (and lets ProtectedRoute
            // navigate to /login). Nothing else may log the user out.
            setUser(null);
          } else if (!userRef.current) {
            // Populate the profile on sign-in / initial session only. On
            // TOKEN_REFRESHED (or any event where we already hold the user) we do
            // NOT refetch — a slow profile read must never drop an active session.
            await fetchProfile(session.user.id);
          }
        } finally {
          stopLoading();
        }
      });
    };

    initializeAuth();

    return () => {
      isMounted = false;
      clearTimeout(watchdog);
      subscription?.unsubscribe();
    };
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
