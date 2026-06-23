import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { queryClientInstance } from '@/lib/query-client';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isSettingUpWorkspace, setIsSettingUpWorkspace] = useState(false);

  useEffect(() => {
    // Check current session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        loadUserProfile(session.user);
      } else {
        setIsLoadingAuth(false);
        setAuthChecked(true);
      }
    });

    // Listen for auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        loadUserProfile(session.user);
      } else {
        setUser(null);
        setIsAuthenticated(false);
        setIsLoadingAuth(false);
        setAuthChecked(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadUserProfile = async (authUser) => {
    try {
      setIsLoadingAuth(true);

      // Load the user's profile row from public.users
      const { data: profile, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      // Merge auth user + profile
      const fullUser = {
        id: authUser.id,
        email: authUser.email,
        role: profile?.role || 'external',
        first_name: profile?.first_name || '',
        last_name: profile?.last_name || '',
        full_name: profile?.full_name || authUser.email,
        phone: profile?.phone || '',
        business_name: profile?.business_name || '',
        construction_role: profile?.construction_role || null,
        notify_rfis: profile?.notify_rfis ?? true,
        notify_documents: profile?.notify_documents ?? true,
      };

      if (profile?.disabled === true) {
        setAuthError({ type: 'account_deactivated', message: 'Account deactivated' });
        setIsAuthenticated(false);
        setIsLoadingAuth(false);
        setAuthChecked(true);
        return;
      }

      setUser(fullUser);
      setIsAuthenticated(true);
      setAuthError(null);

      // Activate any pending project assignments on login
      try {
        setIsSettingUpWorkspace(true);
        const { data, error: fnError } = await supabase.functions.invoke('processPendingAssignments', {});
        if (!fnError && data?.activated > 0) {
          // Re-fetch profile to get updated role
          const { data: refreshed } = await supabase.from('users').select('*').eq('id', authUser.id).single();
          if (refreshed) {
            setUser(u => ({ ...u, role: refreshed.role }));
          }
          queryClientInstance.invalidateQueries({ queryKey: ['users'] });
          queryClientInstance.invalidateQueries({ queryKey: ['projects'] });
        }
      } catch (e) {
        console.warn('[AuthContext] processPendingAssignments failed, retrying in 3s:', e?.message);
        // Retry once after a short delay — cold-start timeouts are common on first login
        setTimeout(async () => {
          try {
            await supabase.functions.invoke('processPendingAssignments', {});
          } catch (retryErr) {
            console.warn('[AuthContext] processPendingAssignments retry also failed:', retryErr?.message);
          }
        }, 3000);
      } finally {
        setIsSettingUpWorkspace(false);
      }
    } catch (error) {
      console.error('[AuthContext] loadUserProfile error:', error);
      setAuthError({ type: 'unknown', message: error.message });
      setIsAuthenticated(false);
    } finally {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setIsAuthenticated(false);
  };

  // Kept for compatibility with any component that calls navigateToLogin
  const navigateToLogin = () => {
    window.location.href = '/login';
  };

  const checkUserAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) await loadUserProfile(session.user);
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings: false,
      isSettingUpWorkspace,
      authError,
      appPublicSettings: null,
      authChecked,
      logout,
      navigateToLogin,
      checkUserAuth,
      checkAppState: checkUserAuth,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
