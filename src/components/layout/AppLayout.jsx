import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import MobileNav from './MobileNav';
import MobileMenu from './MobileMenu';
import { cn } from '@/lib/utils';

export default function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
      </div>

      {/* Main content */}
      <div className={cn(
        "transition-all duration-300 flex flex-col min-h-screen",
        sidebarCollapsed ? "lg:ml-[68px]" : "lg:ml-[240px]"
      )}>
        <TopBar onMenuOpen={() => setMobileMenuOpen(true)} />
        {/* Bottom padding clears the fixed mobile tab bar */}
        <main className="flex-1 p-4 pb-[calc(4rem+env(safe-area-inset-bottom,0px))] lg:p-6">
          <Outlet />
        </main>
      </div>

      {/* Mobile menu drawer + bottom nav */}
      <MobileMenu open={mobileMenuOpen} onOpenChange={setMobileMenuOpen} />
      <MobileNav />
    </div>
  );
}
