import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { HardHat, LogOut } from 'lucide-react';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';
import { NAV_ITEMS, isNavActive } from './navItems';

// Phone/tablet stand-in for the desktop sidebar (which is hidden below lg).
// Opened by the menu button in the top bar.
export default function MobileMenu({ open, onOpenChange }) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const companyLogoUrl = user?.company_logo_url;
  const companyName = user?.company_name || 'ConstructIQ';

  // Links close the drawer themselves; this catches the Android back button.
  useEffect(() => {
    onOpenChange(false);
  }, [location.pathname, onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[280px] p-0 flex flex-col gap-0" aria-describedby={undefined}>
        <div className="flex items-center gap-2.5 h-16 px-4 pr-12 border-b flex-shrink-0">
          {companyLogoUrl ? (
            <img src={companyLogoUrl} alt="Logo" className="h-9 max-w-[36px] object-contain flex-shrink-0 rounded" />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
              <HardHat className="w-5 h-5 text-primary-foreground" />
            </div>
          )}
          <SheetTitle className="font-heading font-bold text-lg tracking-tight truncate">
            {companyName}
          </SheetTitle>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
          {NAV_ITEMS.filter(item => item.show(user)).map(({ path, icon: Icon, label }) => {
            const isActive = isNavActive(path, location.pathname);
            return (
              <SheetClose asChild key={path}>
                <Link
                  to={path}
                  className={cn(
                    'flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  )}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  <span className="truncate">{label}</span>
                </Link>
              </SheetClose>
            );
          })}
        </nav>

        <div
          className="border-t px-4 pt-3 flex-shrink-0"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <p className="text-sm font-medium truncate">{user?.full_name || 'User'}</p>
          <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
          <button
            onClick={logout}
            className="mt-3 w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="w-4 h-4" /> Log out
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
