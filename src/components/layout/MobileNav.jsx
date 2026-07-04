import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, FolderKanban,
  MessageSquareMore, GanttChart, FileSignature,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';
import { canAccess } from '@/lib/permissions';

export default function MobileNav() {
  const location = useLocation();
  const { user } = useAuth();

  const navItems = [
    { path: '/',          icon: LayoutDashboard,   label: 'Home',     show: true },
    { path: '/projects',  icon: FolderKanban,      label: 'Projects', show: true },
    { path: '/rfis',      icon: MessageSquareMore, label: 'RFIs',     show: true },
    { path: '/tenders',   icon: FileSignature,     label: 'Tenders',  show: canAccess(user, 'tenders') },
    { path: '/programme', icon: GanttChart,        label: 'Gantt',    show: true },
  ].filter(item => item.show);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border lg:hidden no-print"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-center justify-around h-16 px-1">
        {navItems.map(({ path, icon: Icon, label }) => {
          const isActive = path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(path);
          return (
            <Link
              key={path}
              to={path}
              className={cn(
                'flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg transition-colors min-w-0',
                isActive ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium truncate">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}