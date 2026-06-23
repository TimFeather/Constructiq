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
  const workspaceSetupDoneRef = React.useRef(false);

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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Skip silent token refreshes if already authenticated
      if (event === 'TOKEN_REFRESHED' && isAuthenticated) {
        return;
      }
      if (session) {
        loadUserProfile(session.user, event === 'SIGNED_IN');
      } else {
        setUser(null);
        setIsAuthenticated(false);
        setIsLoadingAuth(false);
        setAuthChecked(true);
        workspaceSetupDoneRef.current = false;
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadUserProfile = async (authUser, runWorkspaceSetup = false) => {
    try {
      // Only show loading state if this is first auth check or workspace setup
      if (runWorkspaceSetup || !authChecked) setIsLoadingAuth(true);

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
        if (runWorkspaceSetup || !authChecked) setIsLoadingAuth(false);
        setAuthChecked(true);
        return;
      }

      setUser(fullUser);
      setIsAuthenticated(true);
      setAuthError(null);

      // Only run workspace setup on actual sign-in, not token refreshes or tab focus
      // Guard with ref to prevent duplicate runs even if multiple auth events fire
      if (!runWorkspaceSetup || workspaceSetupDoneRef.current) return;

      workspaceSetupDoneRef.current = true;

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
      if (runWorkspaceSetup || !authChecked) setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setIsAuthenticated(false);
    workspaceSetupDoneRef.current = false;
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
