import { get, ref, runTransaction, update, type Database } from "firebase/database";

export type StoredMember = Record<string, unknown> & { id: string; version: number };

export const MEMBERS_PATH = "appData/membersById";
export const MEMBER_TOMBSTONES_PATH = "appData/deletedMemberIds";

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isValidMemberId(id: unknown): id is string {
  return typeof id === "string" && id.trim().length > 0 && !/[.#$\[\]/]/.test(id);
}

export function keyedMembers(value: unknown): Record<string, StoredMember> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, member]) =>
    isValidMemberId(id) && member && typeof member === "object" && (member as { id?: unknown }).id === id,
  )) as Record<string, StoredMember>;
}

export function membersFromData(appData: unknown, tombstones?: unknown) {
  const value = appData && typeof appData === "object" ? appData as { membersById?: unknown; members?: unknown } : {};
  if (tombstones === undefined) tombstones = (value as { deletedMemberIds?: unknown }).deletedMemberIds;
  const keyed = keyedMembers(value.membersById);
  const deleted = tombstones && typeof tombstones === "object" ? new Set(Object.keys(tombstones)) : new Set<string>();
  if (Object.keys(keyed).length) return Object.values(keyed).filter(member => !deleted.has(member.id));
  if (!Array.isArray(value.members)) return [];
  return value.members.filter((member): member is Record<string, unknown> =>
    Boolean(member && typeof member === "object" && isValidMemberId((member as { id?: unknown }).id) && !deleted.has((member as { id: string }).id)),
  );
}

function expectedVersion(previous: unknown) {
  if (!previous || typeof previous !== "object") return 0;
  const version = (previous as { version?: unknown }).version;
  return typeof version === "number" && Number.isInteger(version) && version > 0 ? version : 1;
}

function cleanMember(member: Record<string, unknown>, version: number): StoredMember {
  if (!isValidMemberId(member.id)) throw new Error("MEMBER_ID_REQUIRED");
  return { ...member, id: member.id, version } as StoredMember;
}

/**
 * Build the exact record used by an atomic RTDB multi-location update.
 * The version is derived from the authoritative baseline; a stale baseline
 * is rejected by the RTDB rule instead of being silently overwritten.
 */
export function prepareMemberRecord(member: Record<string, unknown>, previous: unknown) {
  if (!isValidMemberId(member.id)) throw new Error("MEMBER_ID_REQUIRED");
  const expected = expectedVersion(previous);
  return cleanMember(member, expected === 0 ? 1 : expected + 1);
}

export async function upsertMemberRecord(database: Database, member: Record<string, unknown>, previous: unknown) {
  if (!isValidMemberId(member.id)) throw new Error("MEMBER_ID_REQUIRED");
  const expected = expectedVersion(previous);
  const memberRef = ref(database, `${MEMBERS_PATH}/${member.id}`);
  // Prime the SDK cache so a transaction does not mistake an uncached path
  // for a server-side null and silently abort a valid versioned update.
  await get(memberRef);
  const result = await runTransaction(memberRef, current => {
    if (current === null) {
      // The Web SDK may invoke the callback with its initial local null before
      // the server value is returned. Returning the proposed version lets the
      // server compare-and-rerun against an existing record; tombstone Rules
      // still make a post-delete resurrection impossible.
      return prepareMemberRecord(member, previous);
    }
    if (!current || typeof current !== "object" || (current as { id?: unknown }).id !== member.id) return;
    const currentVersion = typeof (current as { version?: unknown }).version === "number"
      ? (current as { version: number }).version
      : 1;
    if (currentVersion !== expected) return;
    const next = cleanMember(member, same(current, member) ? currentVersion : currentVersion + 1);
    return same(current, next) ? current : next;
  });
  if (!result.committed) throw new Error("MEMBER_CONFLICT");
  return result.snapshot.val() as StoredMember;
}

export async function deleteMemberRecord(database: Database, memberId: string, knownMember?: unknown) {
  if (!isValidMemberId(memberId)) throw new Error("MEMBER_ID_REQUIRED");
  const tombstoneRef = ref(database, `${MEMBER_TOMBSTONES_PATH}/${memberId}`);
  const existingTombstone = await get(tombstoneRef);
  if (!existingTombstone.exists()) {
    await update(ref(database), {
      [`${MEMBER_TOMBSTONES_PATH}/${memberId}`]: {
        deletedAt: new Date().toISOString(),
        version: knownMember && typeof knownMember === "object" && typeof (knownMember as { version?: unknown }).version === "number"
          ? (knownMember as { version: number }).version
          : 1,
      },
    });
  }
  const result = await runTransaction(ref(database, `${MEMBERS_PATH}/${memberId}`), current => {
    if (current === null) return null;
    if (current && typeof current === "object" && (current as { id?: unknown }).id === memberId) return null;
    return current;
  });
  if (!result.committed && result.snapshot.exists()) throw new Error("MEMBER_DELETE_CONFLICT");
}
