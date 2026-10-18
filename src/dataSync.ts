import { get, onValue, ref, runTransaction, update, type Unsubscribe } from "firebase/database";
import { firebaseDatabase } from "./firebase";
import { safeVideoUrl } from "./videoUrl";
import { deletedMemberInPayload, filterDeletedMembers } from "./memberTombstones";

export type FirebaseSyncPhase = "update" | "read" | "verify";

export class FirebaseSyncError extends Error {
  phase: FirebaseSyncPhase;
  code: string;

  constructor(phase: FirebaseSyncPhase, code: string, message: string) {
    super(message);
    this.name = "FirebaseSyncError";
    this.phase = phase;
    this.code = code;
  }
}

function firebaseErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
  }
  return "UNKNOWN";
}

export function firebaseSyncError(
  phase: FirebaseSyncPhase,
  code: string,
  message: string,
) {
  return new FirebaseSyncError(phase, code || "UNKNOWN", message);
}

export type SyncPayload<TSettings, TExercise, TMember, TCourse> = {
  schemaVersion: 1;
  settings: TSettings;
  exercises: TExercise[];
  members: TMember[];
  courses: TCourse[];
  migratedAt?: string;
};

export function dedupeById<T extends { id: string }>(items: unknown): T[] {
  const safe = (Array.isArray(items) ? items : []).filter(
    (item): item is T =>
      Boolean(item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string"),
  );
  return [...new Map(safe.map((item) => [item.id, item])).values()];
}

/** RTDB rejects undefined anywhere in an update payload. */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value))
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefined(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefined(item)]),
    ) as T;
  }
  return value;
}

export function backupLocalSnapshot<T>(payload: T) {
  const key = `alasas-local-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  localStorage.setItem(key, JSON.stringify(payload));
  return key;
}

export function watchAdminData<T>(
  callback: (value: T | null) => void,
): Unsubscribe | (() => undefined) {
  if (!firebaseDatabase) return () => undefined;
  let appData: T | null = null;
  let deleted: Record<string, unknown> = {};
  let appLoaded = false;
  const publish = () => {
    if (!appLoaded) return;
    const value = appData as (T & { members?: unknown }) | null;
    if (value && Array.isArray(value.members))
      callback({ ...value, members: filterDeletedMembers(value.members, deleted) } as T);
    else callback(appData);
  };
  const stopApp = onValue(ref(firebaseDatabase, "appData"), (snapshot) => {
    appData = snapshot.exists() ? snapshot.val() as T : null;
    appLoaded = true;
    publish();
  });
  const stopDeleted = onValue(ref(firebaseDatabase, "deletedMemberIds"), (snapshot) => {
    deleted = snapshot.exists() ? snapshot.val() as Record<string, unknown> : {};
    publish();
  });
  return () => { stopApp(); stopDeleted(); };
}

export async function readAdminData<T>() {
  if (!firebaseDatabase) return null;
  try {
    const snapshot = await get(ref(firebaseDatabase, "appData"));
    const value = snapshot.exists() ? snapshot.val() as T & { members?: unknown } : null;
    if (!value) return null;
    const deletedSnapshot = await get(ref(firebaseDatabase, "deletedMemberIds"));
    const deleted = deletedSnapshot.exists() ? deletedSnapshot.val() as Record<string, unknown> : {};
    if (Array.isArray(value.members)) value.members = filterDeletedMembers(value.members, deleted);
    return value as T;
  } catch (error) {
    throw new FirebaseSyncError("read", firebaseErrorCode(error), "تعذر قراءة Firebase RTDB");
  }
}

/** Delete a member only after the authoritative RTDB update is acknowledged and read back. */
export async function deleteAdminMember(memberId: string) {
  if (!firebaseDatabase) throw new FirebaseSyncError("update", "NOT_CONFIGURED", "Firebase RTDB غير مهيأ");
  if (!memberId) throw new FirebaseSyncError("update", "MEMBER_REQUIRED", "معرّف المشترك مطلوب");
  try {
    const root = ref(firebaseDatabase);
    const snapshot = await get(ref(firebaseDatabase, "appData"));
    const appData = snapshot.val() as { members?: unknown } | null;
    const members = Array.isArray(appData?.members) ? appData.members : [];
    const member = members.find((item) => item && typeof item === "object" && (item as { id?: unknown }).id === memberId) as Record<string, unknown> | undefined;
    const tombstoneSnapshot = await get(ref(firebaseDatabase, `deletedMemberIds/${memberId}`));
    if (!member && !tombstoneSnapshot.exists()) throw new FirebaseSyncError("verify", "MEMBER_NOT_FOUND", "المشترك غير موجود في Firebase");
    const deletedAt = new Date().toISOString();
    const updates: Record<string, unknown> = {
      [`deletedMemberIds/${memberId}`]: { deletedAt },
    };
    const uid = typeof member?.authUid === "string" ? member.authUid : "";
    if (uid) updates[`membersByUid/${uid}`] = null;
    await update(root, updates);

    // Serialize removal at the member's array index. A transaction on the
    // whole legacy array validates unrelated tombstoned members and can fail
    // during concurrent deletes; an index transaction preserves every other
    // member and cannot resurrect this ID after the tombstone is written.
    if (member) {
      const memberIndex = members.findIndex((item) => item && typeof item === "object" && (item as { id?: unknown }).id === memberId);
      if (memberIndex >= 0) {
        const removal = await runTransaction(ref(firebaseDatabase, `appData/members/${memberIndex}`), (current) => {
          if (current == null) return null;
          if (current && typeof current === "object" && (current as { id?: unknown }).id === memberId) return null;
          return;
        });
        if (!removal.committed) throw new FirebaseSyncError("verify", "DELETE_MISMATCH", "لم يتأكد حذف المشترك من Firebase RTDB");
      }
    }

    const phone = typeof member?.phoneE164 === "string" ? member.phoneE164 : typeof member?.phone === "string" ? member.phone : "";
    if (phone) await runTransaction(ref(firebaseDatabase, `memberPhoneIndex/${phoneIndexKey(phone)}`), (current) => current === memberId ? null : current);

    const [membersCheck, profileCheck] = await Promise.all([
      get(ref(firebaseDatabase, "appData/members")),
      uid ? get(ref(firebaseDatabase, `membersByUid/${uid}`)) : Promise.resolve(null),
    ]);
    const persistedMembers = membersCheck.val();
    const stillPresent = Array.isArray(persistedMembers)
      ? persistedMembers.some((item) => item && typeof item === "object" && (item as { id?: unknown }).id === memberId)
      : Boolean(persistedMembers && typeof persistedMembers === "object" && Object.values(persistedMembers).some((item) => item && typeof item === "object" && (item as { id?: unknown }).id === memberId));
    if (stillPresent || profileCheck?.exists()) throw new FirebaseSyncError("verify", "DELETE_MISMATCH", "لم يتأكد حذف المشترك من Firebase RTDB");
    return { member: member || null, memberId };
  } catch (error) {
    if (error instanceof FirebaseSyncError) throw error;
    throw new FirebaseSyncError("update", firebaseErrorCode(error), "تعذر حذف المشترك من Firebase RTDB");
  }
}

export async function readAdminMember<T>(memberId: string) {
  const data = await readAdminData<{ members?: unknown }>();
  const members = Array.isArray(data?.members) ? data.members : [];
  return (members.find((item) => item && typeof item === "object" && (item as { id?: unknown }).id === memberId) as T | undefined) ?? null;
}

/** Read-only health check for records left behind by an interrupted delete. */
export async function readAdminDeletionConflicts() {
  if (!firebaseDatabase) return [] as Array<{ id: string; member: Record<string, unknown>; deletedAt: string }>;
  const [membersSnapshot, tombstonesSnapshot] = await Promise.all([
    get(ref(firebaseDatabase, "appData/members")),
    get(ref(firebaseDatabase, "deletedMemberIds")),
  ]);
  const members = membersSnapshot.val();
  const tombstones = tombstonesSnapshot.val() as Record<string, { deletedAt?: unknown }> | null;
  if (!Array.isArray(members) || !tombstones || typeof tombstones !== "object") return [];
  return members.flatMap((member) => {
    if (!member || typeof member !== "object" || typeof (member as { id?: unknown }).id !== "string") return [];
    const id = (member as { id: string }).id;
    const tombstone = tombstones[id];
    if (!tombstone) return [];
    return [{ id, member: member as Record<string, unknown>, deletedAt: String(tombstone.deletedAt || "") }];
  });
}

export async function readAdminExercises<T>() {
  if (!firebaseDatabase) return null;
  try {
    const snapshot = await get(ref(firebaseDatabase, "appData/exercises"));
    return snapshot.exists() ? (snapshot.val() as T) : null;
  } catch (error) {
    throw new FirebaseSyncError("read", firebaseErrorCode(error), "تعذر قراءة تمارين Firebase RTDB");
  }
}

export async function readMemberProfile<T>(uid: string) {
  if (!firebaseDatabase) return null;
  const snapshot = await get(ref(firebaseDatabase, `membersByUid/${uid}`));
  return snapshot.exists() ? (snapshot.val() as T) : null;
}

function phoneIndexKey(phone: string) {
  return encodeURIComponent(phone);
}

/** Atomically claims a phone number for a member. The index is only a lock/uniqueness aid. */
export async function reserveMemberPhone(phone: string, memberId: string) {
  if (!firebaseDatabase) throw new Error("Firebase RTDB غير مهيأ");
  try {
    const result = await runTransaction(
      ref(firebaseDatabase, `memberPhoneIndex/${phoneIndexKey(phone)}`),
      (current) => current === null || current === memberId ? memberId : undefined,
    );
    if (!result.committed || result.snapshot.val() !== memberId)
      throw firebaseSyncError("update", "PHONE_CONFLICT", "رقم الهاتف مستخدم لمشترك آخر");
  } catch (error) {
    if (error instanceof FirebaseSyncError) throw error;
    throw new FirebaseSyncError("update", firebaseErrorCode(error), "تعذر حجز رقم الهاتف في Firebase RTDB");
  }
}

export async function releaseMemberPhone(phone: string, memberId: string) {
  if (!firebaseDatabase) return;
  try {
    await runTransaction(
      ref(firebaseDatabase, `memberPhoneIndex/${phoneIndexKey(phone)}`),
      (current) => current === memberId ? null : current,
    );
  } catch (error) {
    throw new FirebaseSyncError("update", firebaseErrorCode(error), "تعذر تحرير حجز رقم الهاتف القديم");
  }
}

export function watchMemberProfile<T>(
  uid: string,
  callback: (value: T | null) => void,
): Unsubscribe | (() => undefined) {
  if (!firebaseDatabase) return () => undefined;
  return onValue(ref(firebaseDatabase, `membersByUid/${uid}`), (snapshot) => {
    callback(snapshot.exists() ? (snapshot.val() as T) : null);
  });
}

export async function writeAdminData<T>(
  payload: T,
  options: {
    role?: "SUPER_ADMIN" | "MANAGER";
    previous?: unknown;
  } = {},
) {
  if (!firebaseDatabase) throw new Error("Firebase RTDB غير مهيأ");
  const appData = payload as {
    schemaVersion?: unknown;
    settings?: unknown;
    exercises?: unknown;
    members?: unknown;
    courses?: unknown;
    migratedAt?: unknown;
  };
  if (Array.isArray(appData.members)) {
    const tombstones = await get(ref(firebaseDatabase, "deletedMemberIds"));
    const deleted = tombstones.exists() ? tombstones.val() as Record<string, unknown> : {};
    const resurrection = deletedMemberInPayload(appData.members as unknown[], deleted);
    if (resurrection) throw firebaseSyncError("update", "MEMBER_DELETED", "لا يمكن إعادة إنشاء عضوية محذوفة؛ أنشئ عضوية جديدة بمعرّف مختلف");
  }
  const previous = (options.previous && typeof options.previous === "object"
    ? options.previous
    : null) as {
    schemaVersion?: unknown;
    settings?: unknown;
    exercises?: unknown;
    members?: unknown;
    courses?: unknown;
    migratedAt?: unknown;
  } | null;
  const updates: Record<string, unknown> = {};
  const same = (left: unknown, right: unknown) =>
    JSON.stringify(stripUndefined(left)) === JSON.stringify(stripUndefined(right));
  const arrayUpdates = (key: "exercises" | "members" | "courses") => {
    const next = appData[key];
    if (!Array.isArray(next)) return;
    const old = previous?.[key];
    if (!Array.isArray(old)) {
      updates[`appData/${key}`] = stripUndefined(next);
      return;
    }

    // Keep the existing array shape. Targeted writes are safe for edits and
    // append-only additions; deletions or reordering require one domain-level
    // replacement so RTDB does not leave sparse numeric arrays behind.
    const stablePrefix = old.every(
      (item, index) =>
        item && next[index] &&
        (item as { id?: unknown }).id === (next[index] as { id?: unknown }).id,
    );
    if (!stablePrefix || next.length < old.length) {
      if (!same(next, old)) updates[`appData/${key}`] = stripUndefined(next);
      return;
    }
    next.forEach((item, index) => {
      if (!same(item, old[index]))
        updates[`appData/${key}/${index}`] = stripUndefined(item);
    });
  };
  arrayUpdates("exercises");
  arrayUpdates("courses");

  // Members are stored as a legacy array, but member writes must remain
  // index-targeted. Replacing appData/members from a stale snapshot can
  // resurrect a concurrently deleted member or discard another admin's write.
  if (Array.isArray(appData.members)) {
    const currentSnapshot = await get(ref(firebaseDatabase, "appData/members"));
    const currentMembers = currentSnapshot.val();
    const currentIndexes = new Map<string, number>();
    if (Array.isArray(currentMembers)) {
      currentMembers.forEach((member, index) => {
        if (member && typeof member === "object" && typeof (member as { id?: unknown }).id === "string")
          currentIndexes.set((member as { id: string }).id, index);
      });
    }
    const nextMembers = appData.members as Array<Record<string, unknown>>;
    for (const member of nextMembers) {
      if (!member || typeof member.id !== "string") continue;
      const index = currentIndexes.get(member.id);
      const path = index === undefined
        ? `appData/members/${Array.isArray(currentMembers) ? currentMembers.length : 0}`
        : `appData/members/${index}`;
      const current = index === undefined ? undefined : currentMembers[index];
      if (!same(member, current)) updates[path] = stripUndefined(member);
    }
  }

  if (options.role === "SUPER_ADMIN") {
    for (const key of ["schemaVersion", "settings"] as const) {
      if (appData[key] !== undefined && !same(appData[key], previous?.[key]))
        updates[`appData/${key}`] = stripUndefined(appData[key]);
    }
    if (appData.migratedAt !== undefined)
      updates["appData/migratedAt"] = appData.migratedAt;
  }

  const toPublicExercise = (
    exercise: Record<string, unknown>,
  ): Record<string, unknown> => {
    if (
      typeof exercise.id !== "string" ||
      typeof exercise.name !== "string" ||
      typeof exercise.muscle !== "string" ||
      typeof exercise.sets !== "number" ||
      !Number.isFinite(exercise.sets) ||
      typeof exercise.reps !== "string" ||
      typeof exercise.rest !== "string"
    )
      throw new Error("بيانات التمرين غير صالحة: sets رقم و reps/rest نصوص مطلوبة");
    if (
      exercise.english !== undefined &&
      exercise.english !== "" &&
      typeof exercise.english !== "string"
    )
      throw new Error("الاسم الإنجليزي للتمرين يجب أن يكون نصاً");
    const video = safeVideoUrl(exercise.video);
    if (exercise.video !== undefined && exercise.video !== "" && !video)
      throw new Error("رابط فيديو غير آمن أو غير معتمد");
    return stripUndefined({
      id: exercise.id,
      name: exercise.name,
      english: exercise.english || "",
      muscle: exercise.muscle,
      sets: exercise.sets,
      reps: exercise.reps,
      rest: exercise.rest,
      video: video || "",
    }) as Record<string, unknown>;
  };
  const nextExercises = Array.isArray(appData.exercises)
    ? (appData.exercises as Array<Record<string, unknown>>)
    : [];
  const oldExercises = Array.isArray(previous?.exercises)
    ? (previous.exercises as Array<Record<string, unknown>>)
    : [];
  const nextPublic = new Map(
    nextExercises.map((exercise) => [String(exercise.id), toPublicExercise(exercise)]),
  );
  const oldPublic = new Map(
    oldExercises.map((exercise) => [String(exercise.id), toPublicExercise(exercise)]),
  );
  const publicIds = new Set([...nextPublic.keys(), ...oldPublic.keys()]);
  for (const id of publicIds) {
    const next = nextPublic.get(id);
    const old = oldPublic.get(id);
    if (same(next, old)) continue;
    const projection = next || old;
    for (const field of ["id", "name", "english", "muscle", "sets", "reps", "rest", "video"])
      updates[`publicExercises/${id}/${field}`] = next ? projection?.[field] : null;
  }

  const profile = (member: Record<string, unknown>) =>
    stripUndefined({
      id: member.id,
      membershipId: member.membershipId || member.id,
      name: member.name,
      height: member.height || "",
      weight: member.weight || "",
      createdAt: member.createdAt || "",
      days: member.days || [],
      active: member.active !== false,
    });
  const nextMembers = Array.isArray(appData.members)
    ? (appData.members as Array<Record<string, unknown>>)
    : [];
  const oldMembers = Array.isArray(previous?.members)
    ? (previous.members as Array<Record<string, unknown>>)
    : [];
  const oldProfiles = new Map(
    oldMembers
      .filter((member) => typeof member.authUid === "string" && member.authUid.length >= 20)
      .map((member) => [member.authUid as string, profile(member)]),
  );
  for (const member of nextMembers) {
    if (typeof member.authUid !== "string" || member.authUid.length < 20) continue;
    const next = profile(member);
    if (!same(next, oldProfiles.get(member.authUid)))
      updates[`membersByUid/${member.authUid}`] = next;
  }

  try {
    await update(ref(firebaseDatabase), { ...updates });
  } catch (error) {
    throw new FirebaseSyncError("update", firebaseErrorCode(error), "تعذر تحديث Firebase RTDB");
  }
}

export function watchPublicExercise<T>(
  exerciseId: string,
  callback: (value: T | null) => void,
): Unsubscribe | (() => undefined) {
  if (!firebaseDatabase) {
    callback(null);
    return () => undefined;
  }
  return onValue(
    ref(firebaseDatabase, `publicExercises/${exerciseId}`),
    (snapshot) => {
      callback(snapshot.exists() ? (snapshot.val() as T) : null);
    },
  );
}
