export type InvitationRole = "COACH" | "MANAGER";
export type InvitationRow = {
  invitation_id: string;
  email: string;
  display_name: string;
  role: InvitationRole;
  status: "PENDING" | "CLAIMED" | "APPLIED" | "REVOKED" | "EXPIRED" | "REJECTED";
  expires_at: number;
  created_at: number;
  created_by_uid: string;
  claimed_uid: string | null;
  claimed_at: number | null;
  applied_uid: string | null;
  applied_at: number | null;
};

type Statement = { bind: (...values: unknown[]) => Statement };
type Db = { prepare: (sql: string) => Statement; batch: (statements: Statement[]) => Promise<Array<{ meta?: { changes?: number }; results?: unknown[] }>> };

export function normalizeInvitationEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function validInvitationRole(value: unknown): value is InvitationRole {
  return value === "COACH" || value === "MANAGER";
}

export async function createInvitation(db: Db, input: { invitationId: string; email: string; displayName: string; role: InvitationRole; actorUid: string; now: number; expiresAt: number }) {
  await db.batch([
    db.prepare("UPDATE admin_invitations SET status = 'REVOKED', updated_at = ? WHERE email = ? AND status IN ('PENDING', 'CLAIMED')").bind(input.now, input.email),
    db.prepare("INSERT INTO admin_invitations (invitation_id, email, display_name, role, status, expires_at, created_at, created_by_uid, claimed_uid, claimed_at, applied_uid, applied_at, updated_at) VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, NULL, NULL, NULL, NULL, ?)").bind(input.invitationId, input.email, input.displayName, input.role, input.expiresAt, input.now, input.actorUid, input.now),
    db.prepare("INSERT INTO admin_audit_logs (audit_id, action, invitation_id, actor_uid, target_uid, email, role, details, created_at) VALUES (?, 'INVITE_CREATED', ?, ?, NULL, ?, ?, ?, ?)").bind(crypto.randomUUID(), input.invitationId, input.actorUid, input.email, input.role, JSON.stringify({ displayName: input.displayName }), input.now),
  ]);
}

export async function claimLatestInvitation(db: Db, email: string, uid: string, now: number) {
  const result = await db.batch([
    db.prepare("UPDATE admin_invitations SET status = 'CLAIMED', claimed_uid = ?, claimed_at = ?, updated_at = ? WHERE email = ? AND status = 'PENDING' AND expires_at > ?").bind(uid, now, now, email, now),
    db.prepare("SELECT * FROM admin_invitations WHERE email = ? ORDER BY created_at DESC LIMIT 1").bind(email),
  ]);
  const row = (result[1]?.results?.[0] || null) as InvitationRow | null;
  if (!row || !(["CLAIMED", "PENDING"].includes(row.status))) return null;
  if (row.status === "PENDING") return row.expires_at <= now ? row : null;
  if (row.claimed_uid !== uid) return null;
  return row;
}

export async function expireInvitation(db: Db, row: InvitationRow, now: number) {
  await db.batch([
    db.prepare("UPDATE admin_invitations SET status = 'EXPIRED', updated_at = ? WHERE invitation_id = ? AND status IN ('PENDING', 'CLAIMED')").bind(now, row.invitation_id),
    db.prepare("INSERT INTO admin_audit_logs (audit_id, action, invitation_id, actor_uid, target_uid, email, role, details, created_at) VALUES (?, 'INVITE_REJECTED', ?, NULL, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), row.invitation_id, row.claimed_uid, row.email, row.role, "expired-or-invalid", now),
  ]);
}

export async function applyInvitation(db: Db, row: InvitationRow, uid: string, now: number) {
  const result = await db.batch([
    db.prepare("UPDATE admin_invitations SET status = 'APPLIED', applied_uid = ?, applied_at = ?, updated_at = ? WHERE invitation_id = ? AND status = 'CLAIMED' AND claimed_uid = ?").bind(uid, now, now, row.invitation_id, uid),
    db.prepare("INSERT INTO admin_audit_logs (audit_id, action, invitation_id, actor_uid, target_uid, email, role, details, created_at) SELECT ?, 'INVITE_APPLIED', ?, ?, ?, ?, ?, NULL, ? WHERE NOT EXISTS (SELECT 1 FROM admin_audit_logs WHERE invitation_id = ? AND action = 'INVITE_APPLIED')").bind(crypto.randomUUID(), row.invitation_id, uid, uid, row.email, row.role, now, row.invitation_id),
  ]);
  return (result[0]?.meta?.changes || 0) === 1;
}
