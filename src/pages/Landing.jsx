import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import {
  HardHat, FileSignature, FolderKanban, MessageSquareMore,
  FileText, ArrowRight, Shield, Users, CheckCircle
} from 'lucide-react';

const FEATURES = [
  {
    icon: FileSignature,
    title: 'Tenders',
    desc: 'Invite subcontractors, manage pricing submissions, and track closing dates in one place.',
    bg: 'bg-blue-50',
    text: 'text-blue-600',
  },
  {
    icon: FolderKanban,
    title: 'Projects',
    desc: 'Oversee project activity, manage your team, and track progress from start to finish.',
    bg: 'bg-teal-50',
    text: 'text-teal-600',
  },
  {
    icon: MessageSquareMore,
    title: 'RFIs',
    desc: 'Create, assign, and respond to Requests for Information with a full audit trail.',
    bg: 'bg-purple-50',
    text: 'text-purple-600',
  },
  {
    icon: FileText,
    title: 'Documents',
    desc: 'Secure file storage with folder organisation, sharing controls, and version history.',
    bg: 'bg-orange-50',
    text: 'text-orange-600',
  },
];

export default function Landing() {
  const { user, isLoadingAuth } = useAuth();

  if (!isLoadingAuth && user) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen flex flex-col">

      {/* ── Hero ── */}
      <div className="bg-sidebar flex flex-col">

        {/* Top nav */}
        <header className="flex items-center justify-between px-6 sm:px-10 py-5 max-w-6xl mx-auto w-full">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-sidebar-primary flex items-center justify-center">
              <HardHat className="w-5 h-5 text-sidebar-primary-foreground" />
            </div>
            <span className="text-lg font-bold text-white tracking-tight">ConstructIQ</span>
          </div>
          <Link
            to="/login"
            className="text-sm font-medium text-white/70 hover:text-white border border-white/20 hover:border-white/40 rounded-lg px-4 py-2 transition-colors"
          >
            Sign In
          </Link>
        </header>

        {/* Hero content */}
        <div className="flex flex-col items-center justify-center text-center px-6 py-24 sm:py-32">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-widest text-sidebar-primary uppercase mb-5">
              Construction Management Platform
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-6">
              Every project stage,<br />
              <span className="text-sidebar-primary">one platform</span>
            </h1>
            <p className="text-lg text-white/55 leading-relaxed mb-10 max-w-lg mx-auto">
              Manage tenders, RFIs, documents, and project teams in one secure platform built for the construction industry.
            </p>
            <Button asChild size="lg" className="px-8 text-base h-12 font-semibold">
              <Link to="/login">
                Sign In to ConstructIQ
                <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
            <p className="mt-5 text-sm text-white/35">
              Access is by invitation only — contact your administrator to get started.
            </p>
          </div>
        </div>
      </div>

      {/* ── Features ── */}
      <div className="bg-background py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-xs font-semibold text-primary/60 uppercase tracking-widest mb-3">
            Everything you need
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold text-center text-foreground mb-12">
            One platform. Every stage of the project.
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {FEATURES.map(({ icon: Icon, title, desc, bg, text }) => (
              <div key={title} className="bg-card rounded-xl border border-border p-6 space-y-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${bg}`}>
                  <Icon className={`w-5 h-5 ${text}`} />
                </div>
                <h3 className="font-semibold text-foreground">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Trust bar ── */}
      <div className="bg-muted/40 border-t border-border py-10 px-6">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-8 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary flex-shrink-0" />
            <span>Secure, role-based access control</span>
          </div>
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary flex-shrink-0" />
            <span>Internal &amp; subcontractor portals</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-primary flex-shrink-0" />
            <span>Full audit trail on every action</span>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="bg-background border-t border-border py-6 px-6">
        <p className="text-center text-xs text-muted-foreground/60">
          &copy; {new Date().getFullYear()} ConstructIQ &nbsp;&bull;&nbsp; Powered by Total Home Solutions
        </p>
      </footer>

    </div>
  );
}
