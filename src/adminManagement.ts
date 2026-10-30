import { firebaseAuth } from './firebase'

// Release builds must provide the endpoint explicitly. Falling back to a
// production or staging Worker here can send an otherwise-correct Firebase
// session to the wrong environment and surface as a browser-level CORS error.
const endpoint = String(import.meta.env.VITE_PIN_SERVICE_ENDPOINT || '').trim().replace(/\/+$/, '')

async function request<T>(path: string, method = 'POST', body?: unknown): Promise<T> {
  if (!firebaseAuth?.currentUser) throw new Error('تسجيل دخول المدير مطلوب')
  if (!endpoint) throw new Error('خدمة إدارة المدراء غير مهيأة لهذا الإصدار؛ تحقق من إعدادات البيئة.')
  const token = await firebaseAuth.currentUser.getIdToken()
  let response: Response
  try {
    response = await fetch(`${endpoint}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch (error) {
    if (error instanceof TypeError) throw new Error('تعذر الوصول إلى خدمة إدارة المدراء؛ تحقق من عنوان Worker وCORS ثم أعد المحاولة.')
    throw error
  }
  const result = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(result.error || 'تعذر تنفيذ العملية')
  return result as T
}

export type ManagedAdmin = { uid?: string; invitationId?: string; email: string; displayName?: string; role: 'MANAGER' | 'SUPER_ADMIN' | 'COACH'; active: boolean; status: 'ACTIVE' | 'DISABLED' | 'PENDING'; createdAt?: string; lastLoginAt?: string; updatedAt?: string; updatedBy?: string }
export const listManagedAdmins = () => request<{ admins: ManagedAdmin[] }>('/v1/admin/management/list')
export const inviteAdmin = (displayName: string, email: string, role: 'COACH' | 'MANAGER') => request<{ invitationId: string }>('/v1/admin/management/invite', 'POST', { displayName, email, role })
export const cancelAdminInvitation = (invitationId: string, email: string, role: 'COACH' | 'MANAGER') => request<{ ok: true; invitationId: string; status: 'REVOKED'; idempotent: boolean }>('/v1/admin/management/cancel', 'POST', { invitationId, email, role })
export const acceptAdminInvitation = () => request<{ role: ManagedAdmin['role']; linked: boolean }>('/v1/admin/management/accept')
export const updateManagedAdmin = (uid: string, action: 'role' | 'active' | 'remove' | 'displayName', role?: 'COACH' | 'MANAGER', active?: boolean, displayName?: string) => request<{ ok: true }>('/v1/admin/management/update', 'POST', { uid, action, role, active, displayName })
export const updateOwnDisplayName = (displayName: string) => request<{ ok: true; displayName: string }>('/v1/admin/profile', 'POST', { action: 'update', displayName })
export const touchAdminLogin = () => request<{ ok: true; lastLoginAt: string }>('/v1/admin/profile', 'POST', { action: 'login' })
