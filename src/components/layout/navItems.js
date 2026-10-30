import {
  LayoutDashboard, FolderKanban, FileText, MessageSquareMore,
  GanttChart, Settings, FileSignature, ListChecks,
} from 'lucide-react';
import { canAccess, isAdmin, getRole } from '@/lib/permissions';

// Full navigation: the desktop sidebar and the mobile menu drawer both read this,
// so a page added here shows up on phones too.
export const NAV_ITEMS = [
  { path: '/dashboard',  icon: LayoutDashboard,   label: 'Dashboard',  show: () => true },
  { path: '/projects',   icon: FolderKanban,      label: 'Projects',   show: () => true },
  { path: '/documents',  icon: FileText,          label: 'Documents',  show: () => true },
  { path: '/rfis',       icon: MessageSquareMore, label: 'RFIs',       show: () => true },
  { path: '/programme',  icon: GanttChart,        label: 'Programme',  show: () => true },
  { path: '/tenders',    icon: FileSignature,     label: 'Tenders',    show: user => canAccess(user, 'tenders') },
  { path: '/my-tenders', icon: ListChecks,        label: 'My Tenders', show: user => getRole(user) === 'external' },
  { path: '/settings',   icon: Settings,          label: 'Settings',   show: user => isAdmin(user) },
];

// Bottom tab bar on phones: the everyday pages only (at most 5 for any role).
// Everything else is in the menu drawer.
export const TAB_ITEMS = [
  { path: '/dashboard',  icon: LayoutDashboard,   label: 'Home',       show: () => true },
  { path: '/projects',   icon: FolderKanban,      label: 'Projects',   show: () => true },
  { path: '/rfis',       icon: MessageSquareMore, label: 'RFIs',       show: () => true },
  { path: '/tenders',    icon: FileSignature,     label: 'Tenders',    show: user => canAccess(user, 'tenders') },
  { path: '/my-tenders', icon: ListChecks,        label: 'My Tenders', show: user => getRole(user) === 'external' },
  { path: '/programme',  icon: GanttChart,        label: 'Programme',  show: () => true },
];

export function isNavActive(path, pathname) {
  return path === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(path);
}
