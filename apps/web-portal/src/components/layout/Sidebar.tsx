'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useAuthStore } from '@/store/authStore';
import { useState, useMemo } from 'react';
import { getMenuForRole, type MenuItem } from '@/lib/rbac/menu-config';
import { getRole } from '@/lib/rbac';

export default function Sidebar() {
  const pathname = usePathname();
  const { user, profile, activeMembership, checkPermission } = useAuth();
  const logout = useAuthStore(state => state.logout);

  // Display strings use the canonical backend role ids (underscore form).
  const displayName = profile?.display_name ?? 'Signed in';
  const roleLabel = activeMembership
    ? getRole(activeMembership.role)?.name ?? activeMembership.role.replace('_', ' ')
    : 'No active role';
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      window.location.assign('/login');
    }
  };

  // State for collapsible groups
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    'users-access': true,
    'operations': true,
    'specialized': true,
    'system': true,
    'patients': true,
    'appointments': true,
    'clinical': true,
    'iot': true,
    'ai': true,
    'earnings': true,
    'analytics': true,
    'doctor-profile-section': true,
  });

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + '/');

  // Get menu based on role and filter by permissions
  const menuGroups = useMemo(() => {
    if (!user) return [];
    
    const roleMenu = getMenuForRole(user.activeRole);
    
    // Filter menu groups and items by permissions
    return roleMenu
      .map(group => ({
        ...group,
        items: group.items.filter(item => {
          // If no permission required, show it
          if (!item.requiredPermission) return true;
          
          // Check if user has permission
          return checkPermission(item.requiredPermission);
        }).map(item => {
          // Filter children if they exist
          if (item.children) {
            return {
              ...item,
              children: item.children.filter(child => {
                if (!child.requiredPermission) return true;
                return checkPermission(child.requiredPermission);
              }),
            };
          }
          return item;
        }),
      }))
      .filter(group => group.items.length > 0); // Remove empty groups
  }, [user, checkPermission]);

  // Render menu item
  const renderMenuItem = (item: MenuItem, isChild = false) => {
    const hasChildren = item.children && item.children.length > 0;
    const active = item.route ? isActive(item.route) : false;
    
    const className = `flex items-center ${hasChildren ? 'justify-between' : ''} gap-3 px-3 py-2.5 rounded-lg transition-all group ${
      active
        ? 'bg-primary/10 text-primary font-semibold shadow-sm'
        : 'text-gray-600 hover:text-primary hover:bg-gray-50'
    } ${isChild ? 'text-xs' : 'text-sm'}`;

    const content = (
      <>
        <div className="flex items-center gap-3">
          <span className={`material-symbols-outlined ${isChild ? 'text-[16px]' : 'text-[20px]'} ${active ? 'fill-1' : ''}`}>
            {item.icon}
          </span>
          <span className="font-medium">{item.label}</span>
        </div>
      </>
    );

    if (item.route) {
      return (
        <Link key={item.id} href={item.route} className={className}>
          {content}
        </Link>
      );
    }

    return (
      <div key={item.id} className={className}>
        {content}
      </div>
    );
  };

  // Render submenu
  const renderSubmenu = (item: MenuItem) => {
    if (!item.children || item.children.length === 0) return null;
    
    // Always show submenu if item has children (not just when parent is active)
    const isParentActive = pathname.startsWith(item.route || '');

    return (
      <div className={`ml-8 space-y-0.5 border-l-2 pl-3 mt-1 ${isParentActive ? 'border-primary/30' : 'border-gray-200'}`}>
        {item.children.map(child => (
          <Link
            key={child.id}
            href={child.route || '#'}
            className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-xs transition-all ${
              pathname === child.route
                ? 'text-primary font-semibold bg-primary/5'
                : 'text-gray-500 hover:text-primary hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">{child.icon}</span>
              <span>{child.label}</span>
            </div>
          </Link>
        ))}
      </div>
    );
  };

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col z-20 hidden lg:flex shadow-[4px_0_24px_rgba(0,0,0,0.02)] h-screen sticky top-0">
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="SmartCura" className="size-8" />
          <h2 className="text-[#111318] text-lg font-bold tracking-tight">SmartCura</h2>
        </div>
        <button
          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
          title="Search (Cmd+K)"
        >
          <span className="material-symbols-outlined text-[20px] text-gray-500">search</span>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {menuGroups.map((group, groupIndex) => (
          <div key={group.id}>
            {/* Group Header */}
            {group.label && (
              <button
                onClick={() => toggleGroup(group.id)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 uppercase tracking-wider transition-colors"
              >
                <span>{group.label}</span>
                <span
                  className={`material-symbols-outlined text-[16px] transition-transform ${
                    expandedGroups[group.id] ? 'rotate-180' : ''
                  }`}
                >
                  expand_more
                </span>
              </button>
            )}

            {/* Group Items */}
            {(!group.label || expandedGroups[group.id]) && (
              <div className={`space-y-0.5 ${group.label ? 'ml-2' : ''}`}>
                {group.items.map(item => (
                  <div key={item.id}>
                    {renderMenuItem(item)}
                    {renderSubmenu(item)}
                  </div>
                ))}
              </div>
            )}

            {/* Divider after first group */}
            {groupIndex === 0 && <div className="h-px bg-gray-200 my-3"></div>}
            
            {/* Spacing between groups */}
            {groupIndex > 0 && group.label && <div className="pt-2"></div>}
          </div>
        ))}
      </nav>

      {/* Footer - User Profile */}
      <div className="p-3 border-t border-gray-100">
        <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors group">
          <div className="size-9 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold border-2 border-white shadow-sm">
            {profile?.display_name?.trim().charAt(0).toUpperCase() || '—'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-[#111318] truncate">{displayName}</p>
            <p className="text-xs text-gray-500 truncate capitalize">{roleLabel}</p>
          </div>
          <button
            onClick={() => void handleLogout()}
            disabled={isLoggingOut}
            className="p-1.5 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
            title="Logout"
          >
            <span className="material-symbols-outlined text-[20px] text-red-600 hover:text-red-700">
              logout
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
}
