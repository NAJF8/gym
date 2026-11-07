/**
 * Pure access/route helpers. UI visibility only: Firebase RTDB rules and the
 * Worker remain the real authorization layer.
 */
export type AdminRole = 'SUPER_ADMIN' | 'MANAGER' | 'COACH'

/** True only for /admin, /admin/ and /admin/index.html (case-insensitive, optional trailing slashes). */
export function isAdminPath(pathname: string): boolean {
  const segments = String(pathname ?? '').toLowerCase().split('/').filter(Boolean)
  if (segments.length === 1) return segments[0] === 'admin'
  if (segments.length === 2) return segments[0] === 'admin' && segments[1] === 'index.html'
  return false
}

/** Site settings are visible and editable only to roles the RTDB rules allow to write them. */
export function canEditSiteSettings(role: AdminRole | string | null | undefined): boolean {
  return role === 'SUPER_ADMIN' || role === 'MANAGER'
}
export const canViewSiteSettings = canEditSiteSettings
