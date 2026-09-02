/**
 * Role preferences & smart defaults (UX only, non-authoritative).
 *
 * This module stores nothing but display/ordering hints. It holds no tokens, no
 * permissions and no session state, and it must never be used to decide access:
 * the backend decides which memberships exist and which role is active
 * (`PUT /sessions/current/active-role`). Suggestions produced here are hints for
 * the role picker; the backend still validates every selection.
 */

import { RoleId } from '../rbac';
import { ROLE_IDS } from '@/types/session';

interface RoleUsageStat {
  totalSessions: number;
  totalMinutes: number;
  lastUsed: Date | null;
  preferredTimeSlots: string[];
}

/** Empty usage stats for every canonical backend role. UX only, never authority. */
function emptyRoleUsageStats(): Record<RoleId, RoleUsageStat> {
  return ROLE_IDS.reduce((accumulator, role) => {
    accumulator[role] = {
      totalSessions: 0,
      totalMinutes: 0,
      lastUsed: null,
      preferredTimeSlots: [],
    };
    return accumulator;
  }, {} as Record<RoleId, RoleUsageStat>);
}

export interface RolePreference {
  userId: string;
  primaryRole: RoleId; // User's main role
  lastUsedRole: RoleId; // Last role used (session-only)
  roleUsageStats: Record<RoleId, {
    totalSessions: number;
    totalMinutes: number;
    lastUsed: Date | null;
    preferredTimeSlots: string[]; // e.g., ['09:00-12:00', '14:00-17:00']
  }>;
  preferences: {
    rememberLastRole: boolean; // Remember last role (session-only for security)
    showRoleSuggestions: boolean; // Show smart suggestions
    requireConfirmation: boolean; // Require confirmation for role switch
    autoLogoutOnRoleSwitch: boolean; // End session when switching roles
  };
}

/**
 * Role Preferences Service
 */
class RolePreferencesService {
  private storageKey = 'role_preferences';
  
  /**
   * Get user's role preferences
   */
  getPreferences(userId: string): RolePreference | null {
    try {
      const stored = localStorage.getItem(`${this.storageKey}_${userId}`);
      if (!stored) return null;
      
      const prefs = JSON.parse(stored);
      
      // Parse dates
      Object.keys(prefs.roleUsageStats).forEach(role => {
        if (prefs.roleUsageStats[role].lastUsed) {
          prefs.roleUsageStats[role].lastUsed = new Date(prefs.roleUsageStats[role].lastUsed);
        }
      });
      
      return prefs;
    } catch (error) {
      console.error('Failed to load role preferences:', error);
      return null;
    }
  }
  
  /**
   * Set user's primary role
   */
  setPrimaryRole(userId: string, roleId: RoleId): void {
    const prefs = this.getPreferences(userId) || this.createDefaultPreferences(userId, roleId);
    prefs.primaryRole = roleId;
    this.savePreferences(prefs);
  }
  
  /**
   * Update last used role (session-only for security)
   */
  updateLastUsedRole(userId: string, roleId: RoleId): void {
    // Store in sessionStorage (cleared on browser close)
    sessionStorage.setItem(`last_role_${userId}`, roleId);
  }
  
  /**
   * Get last used role (session-only)
   */
  getLastUsedRole(userId: string): RoleId | null {
    return sessionStorage.getItem(`last_role_${userId}`) as RoleId | null;
  }
  
  /**
   * Track role usage
   */
  trackRoleUsage(userId: string, roleId: RoleId, durationMinutes: number): void {
    const prefs = this.getPreferences(userId);
    if (!prefs) return;
    
    const stats = prefs.roleUsageStats[roleId];
    if (stats) {
      stats.totalSessions += 1;
      stats.totalMinutes += durationMinutes;
      stats.lastUsed = new Date();
      
      // Track time slot
      const hour = new Date().getHours();
      const timeSlot = `${hour.toString().padStart(2, '0')}:00-${(hour + 1).toString().padStart(2, '0')}:00`;
      if (!stats.preferredTimeSlots.includes(timeSlot)) {
        stats.preferredTimeSlots.push(timeSlot);
      }
    }
    
    this.savePreferences(prefs);
  }
  
  /**
   * Get smart role suggestion based on context
   */
  getSuggestedRole(userId: string, availableRoles: RoleId[]): {
    suggestedRole: RoleId;
    reason: string;
    confidence: number; // 0-1
  } | null {
    const prefs = this.getPreferences(userId);
    if (!prefs || !prefs.preferences.showRoleSuggestions) {
      return null;
    }
    
    // Strategy 1: Last used role (session-only)
    const lastUsed = this.getLastUsedRole(userId);
    if (lastUsed && availableRoles.includes(lastUsed)) {
      return {
        suggestedRole: lastUsed,
        reason: 'You used this role in your last session',
        confidence: 0.9,
      };
    }
    
    // Strategy 2: Primary role
    if (availableRoles.includes(prefs.primaryRole)) {
      return {
        suggestedRole: prefs.primaryRole,
        reason: 'This is your primary role',
        confidence: 0.8,
      };
    }
    
    // Strategy 3: Most used role
    const mostUsed = this.getMostUsedRole(prefs, availableRoles);
    if (mostUsed) {
      return {
        suggestedRole: mostUsed,
        reason: 'This is your most frequently used role',
        confidence: 0.7,
      };
    }
    
    // Strategy 4: Time-based suggestion
    const timeBased = this.getTimeBasedSuggestion(prefs, availableRoles);
    if (timeBased) {
      return {
        suggestedRole: timeBased,
        reason: 'You usually use this role at this time',
        confidence: 0.6,
      };
    }
    
    return null;
  }
  
  /**
   * Update user preferences
   */
  updatePreferences(
    userId: string,
    updates: Partial<RolePreference['preferences']>
  ): void {
    const prefs = this.getPreferences(userId);
    if (!prefs) return;
    
    prefs.preferences = {
      ...prefs.preferences,
      ...updates,
    };
    
    this.savePreferences(prefs);
  }
  
  /**
   * Get role usage statistics
   */
  getRoleStats(userId: string): Record<RoleId, {
    totalSessions: number;
    totalHours: number;
    lastUsed: Date | null;
    usagePercentage: number;
  }> | null {
    const prefs = this.getPreferences(userId);
    if (!prefs) return null;
    
    const totalMinutes = Object.values(prefs.roleUsageStats)
      .reduce((sum, stat) => sum + stat.totalMinutes, 0);
    
    const stats: any = {};
    
    Object.entries(prefs.roleUsageStats).forEach(([role, stat]) => {
      stats[role] = {
        totalSessions: stat.totalSessions,
        totalHours: Math.round(stat.totalMinutes / 60 * 10) / 10,
        lastUsed: stat.lastUsed,
        usagePercentage: totalMinutes > 0 
          ? Math.round((stat.totalMinutes / totalMinutes) * 100)
          : 0,
      };
    });
    
    return stats;
  }
  
  // Private methods
  
  private createDefaultPreferences(userId: string, primaryRole: RoleId): RolePreference {
    return {
      userId,
      primaryRole,
      lastUsedRole: primaryRole,
      roleUsageStats: emptyRoleUsageStats(),
      preferences: {
        rememberLastRole: true,
        showRoleSuggestions: true,
        requireConfirmation: true,
        autoLogoutOnRoleSwitch: false,
      },
    };
  }
  
  private savePreferences(prefs: RolePreference): void {
    try {
      localStorage.setItem(
        `${this.storageKey}_${prefs.userId}`,
        JSON.stringify(prefs)
      );
    } catch (error) {
      console.error('Failed to save role preferences:', error);
    }
  }
  
  private getMostUsedRole(prefs: RolePreference, availableRoles: RoleId[]): RoleId | null {
    let maxMinutes = 0;
    let mostUsed: RoleId | null = null;
    
    availableRoles.forEach(role => {
      const stats = prefs.roleUsageStats[role];
      if (stats && stats.totalMinutes > maxMinutes) {
        maxMinutes = stats.totalMinutes;
        mostUsed = role;
      }
    });
    
    return mostUsed;
  }
  
  private getTimeBasedSuggestion(prefs: RolePreference, availableRoles: RoleId[]): RoleId | null {
    const currentHour = new Date().getHours();
    const currentSlot = `${currentHour.toString().padStart(2, '0')}:00-${(currentHour + 1).toString().padStart(2, '0')}:00`;
    
    for (const role of availableRoles) {
      const stats = prefs.roleUsageStats[role];
      if (stats && stats.preferredTimeSlots.includes(currentSlot)) {
        return role;
      }
    }
    
    return null;
  }
}

// Export singleton instance
export const rolePreferences = new RolePreferencesService();
