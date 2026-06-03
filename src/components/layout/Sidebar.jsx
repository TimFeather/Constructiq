import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, FolderKanban, FileText, MessageSquareMore, 
  GanttChart, Settings, ChevronLeft, ChevronRight, HardHat
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';

const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/projects', icon: FolderKanban, label: 'Projects' },
  { path: '/documents', icon: FileText, label: 'Documents' },
  { path: '/rfis', icon: MessageSquareMore, label: 'RFIs' },
  { path: '/programme', icon: GanttChart, label: 'Programme' },
  { path: '/settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar({ collapsed, onToggle }) {
  const location = useLocation();
  const { user } = useAuth();
  const companyLogoUrl = user?.company_logo_url;
  const companyName = user?.company_name || 'ConstructIQ';

  return (
    <aside className={cn(
      "fixed left-0 top-0 h-full z-40 bg-sidebar text-sidebar-foreground transition-all duration-300 flex flex-col no-print",
      collapsed ? "w-[68px]" : "w-[240px]"
    )}>
      {/* Logo */}
      <div className="flex items-center h-16 px-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2.5 min-w-0">
          {companyLogoUrl ? (
            <img src={companyLogoUrl} alt="Logo" className="h-9 max-w-[36px] object-contain flex-shrink-0 rounded" />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-sidebar-primary flex items-center justify-center flex-shrink-0">
              <HardHat className="w-5 h-5 text-sidebar-primary-foreground" />
            </div>
          )}
          {!collapsed && (
            <span className="font-heading font-bold text-lg tracking-tight text-sidebar-primary-foreground truncate">
              {companyName}
            </span>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {navItems.map(({ path, icon: Icon, label }) => {
          const isActive = path === '/' 
            ? location.pathname === '/' 
            : location.pathname.startsWith(path);
          return (
            <Link
              key={path}
              to={path}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                isActive 
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-sidebar-primary/20" 
                  : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
              )}
              title={collapsed ? label : undefined}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        className="flex items-center justify-center h-12 border-t border-sidebar-border text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors"
      >
        {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
      </button>
    </aside>
  );
}