import { firebaseAuth } from './firebase'

const endpoint = String(import.meta.env.VITE_PIN_SERVICE_ENDPOINT || (import.meta.env.PROD ? 'https://alasas-fit-member-auth.coffee101.workers.dev' : '')).replace(/\/+$/, '')

async function request<T>(path: string, method = 'POST', body?: unknown): Promise<T> {
  if (!firebaseAuth?.currentUser) throw new Error('تسجيل دخول المدير مطلوب')
  const token = await firebaseAuth.currentUser.getIdToken()
  const response = await fetch(`${endpoint}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) })
  const result = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(result.error || 'تعذر تنفيذ العملية')
  return result as T
}

export type ManagedAdmin = { uid?: string; email: string; displayName?: string; role: 'MANAGER' | 'SUPER_ADMIN'; active: boolean; status: 'ACTIVE' | 'DISABLED' | 'PENDING'; createdAt?: string; lastLoginAt?: string }
export const listManagedAdmins = () => request<{ admins: ManagedAdmin[] }>('/v1/admin/management/list')
export const inviteAdmin = (email: string, role: ManagedAdmin['role']) => request<{ invitationId: string }>('/v1/admin/management/invite', 'POST', { email, role })
export const acceptAdminInvitation = () => request<{ role: ManagedAdmin['role']; linked: boolean }>('/v1/admin/management/accept')
export const updateManagedAdmin = (uid: string, action: 'role' | 'active' | 'remove', role?: ManagedAdmin['role'], active?: boolean) => request<{ ok: true }>('/v1/admin/management/update', 'POST', { uid, action, role, active })
