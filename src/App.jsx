import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ProtectedRoute from '@/components/ProtectedRoute';
import { canAccess } from '@/lib/permissions';
import ErrorBoundary from '@/components/shared/ErrorBoundary';

import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';

import AppLayout from '@/components/layout/AppLayout';
import Dashboard from '@/pages/Dashboard';
import Projects from '@/pages/Projects.jsx';
import ProjectDetail from '@/pages/ProjectDetail';
import Documents from '@/pages/Documents';
import RFIs from '@/pages/RFIs';
import RFIDetail from '@/pages/RFIDetail.jsx';
import Programme from '@/pages/Programme';
import Settings from '@/pages/Settings.jsx';
import Tenders from '@/pages/Tenders';
import TenderDetail from '@/pages/TenderDetail';
import TenderSubmit from '@/pages/TenderSubmit';
import TenderTestSuite from '@/pages/TenderTestSuite';
import AccountDeactivated from '@/pages/AccountDeactivated';

const TendersRoute = ({ children }) => {
  const { user } = useAuth();
  if (!canAccess(user, 'tenders')) return <Navigate to="/" replace />;
  return children;
};

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, isSettingUpWorkspace, authError, navigateToLogin } = useAuth();
  const location = useLocation();

  // Public routes — bypass all auth checks entirely
  const isPublicRoute = location.pathname.startsWith('/tender-submit/');
  if (isPublicRoute) {
    return (
      <Routes>
        <Route path="/tender-submit/:token" element={<TenderSubmit />} />
      </Routes>
    );
  }

  if (isLoadingPublicSettings || isLoadingAuth || isSettingUpWorkspace) {
    const message = isSettingUpWorkspace ? 'Setting up your workspace...' : 'Loading ConstructIQ...';
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-muted border-t-primary rounded-full animate-spin"></div>
          <span className="text-sm text-muted-foreground font-medium">{message}</span>
        </div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'account_deactivated') {
      return <AccountDeactivated />;
    } else if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
          <Route path="/projects" element={<ErrorBoundary><Projects /></ErrorBoundary>} />
          <Route path="/projects/:id" element={<ErrorBoundary><ProjectDetail /></ErrorBoundary>} />
          <Route path="/documents" element={<ErrorBoundary><Documents /></ErrorBoundary>} />
          <Route path="/rfis" element={<ErrorBoundary><RFIs /></ErrorBoundary>} />
          <Route path="/rfis/:id" element={<ErrorBoundary><RFIDetail /></ErrorBoundary>} />
          <Route path="/programme" element={<ErrorBoundary><Programme /></ErrorBoundary>} />
          <Route path="/tenders" element={<TendersRoute><ErrorBoundary><Tenders /></ErrorBoundary></TendersRoute>} />
          <Route path="/tenders/:id" element={<TendersRoute><ErrorBoundary><TenderDetail /></ErrorBoundary></TendersRoute>} />
          <Route path="/settings" element={<ErrorBoundary><Settings /></ErrorBoundary>} />
          <Route path="/tender-tests" element={<TendersRoute><TenderTestSuite /></TendersRoute>} />
        </Route>
      </Route>

      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <AuthenticatedApp />
          </Router>
          <Toaster />
        </QueryClientProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}

export default App