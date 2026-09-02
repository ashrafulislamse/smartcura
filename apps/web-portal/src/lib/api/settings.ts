import type { NotificationPreference, NotificationPreferenceList, Profile, UpdateMyProfileRequest } from '@/types/contracts';
import { apiRequest } from './client';

export function getMyProfile(signal?: AbortSignal): Promise<Profile> {
  return apiRequest<Profile>({ method: 'GET', path: '/profiles/me', signal });
}

export function updateMyProfile(body: UpdateMyProfileRequest): Promise<Profile> {
  return apiRequest<Profile>({ method: 'PATCH', path: '/profiles/me', body, csrf: true });
}

export function listNotificationPreferences(signal?: AbortSignal): Promise<NotificationPreferenceList> {
  return apiRequest<NotificationPreferenceList>({ method: 'GET', path: '/notifications/preferences/me', signal });
}

export function updateNotificationPreference(body: NotificationPreference): Promise<NotificationPreference> {
  return apiRequest<NotificationPreference>({ method: 'PUT', path: '/notifications/preferences/me', body, csrf: true });
}
