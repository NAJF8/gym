import { get, onValue, ref, runTransaction, update, type Unsubscribe } from "firebase/database";
import { firebaseDatabase } from "./firebase";
import { safeVideoUrl } from "./videoUrl";
import { keyedMembers, membersFromData, MEMBER_TOMBSTONES_PATH, MEMBERS_PATH, deleteMemberRecord, prepareMemberRecord } from "./memberStorage";

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

export type SyncPayload<TSettings, TExercise, TMember, TCourse, TCategory = unknown> = {
  schemaVersion: 1;
  settings: TSettings;
  exercises: TExercise[];
  members: TMember[];
  courses: TCourse[];
  categories?: TCategory[];
  migratedAt?: string;
};

export function dedupeById<T extends { id: string }>(items: unknown): T[] {
  const safe = (Array.isArray(items) ? items : []).filter(
    (item): item is T =>
      Boolean(item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string"),
  );
  return [...new Map(safe.map((item) => [item.id, item])).values()];
}

/** RTDB turns sparse legacy arrays into objects keyed by their numeric index. */
export function collectionItems<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") return Object.values(value as Record<string, T>);
  return [];
}

function collectionEntries(value: unknown): Array<[string, unknown]> {
  if (Array.isArray(value)) return value.map((item, index) => [String(index), item]);
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>);
  return [];
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

/** Preserve one independent, bounded note per training day in public read-only projections. */
function normalizeDayNotes(value: unknown, count: number) {
  return Array.from({ length: count }, (_, index) =>
    Array.isArray(value) && typeof value[index] === "string" ? value[index].slice(0, 2000) : "",
  );
}

export function backupLocalSnapshot<T>(payload: T) {
  const key = `alasas-local-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  // Migration backups are session-scoped and intentionally contain only the
  // redacted payload assembled by the caller. Do not leave member data in a
  // persistent browser store.
  sessionStorage.setItem(key, JSON.stringify(payload));
  return key;
}

export function watchAdminData<T>(
  callback: (value: T | null) => void,
): Unsubscribe | (() => undefined) {
  if (!firebaseDatabase) return () => undefined;
  let appData: T | null = null;
  let appLoaded = false;
  const publish = () => {
    if (!appLoaded) return;
    const value = appData as (T & { members?: unknown }) | null;
    if (value) callback({ ...value, members: membersFromData(value) } as T);
    else callback(appData);
  };
  const stopApp = onValue(ref(firebaseDatabase, "appData"), (snapshot) => {
    appData = snapshot.exists() ? snapshot.val() as T : null;
    appLoaded = true;
    publish();
  });
  return () => { stopApp(); };
}

export async function readAdminData<T>() {
  if (!firebaseDatabase) return null;
  try {
    const snapshot = await get(ref(firebaseDatabase, "appData"));
    const value = snapshot.exists() ? snapshot.val() as T & { members?: unknown } : null;
    if (!value) return null;
    value.members = membersFromData(value);
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
    const snapshot = await get(ref(firebaseDatabase, "appData"));
    const appData = snapshot.val() as { membersById?: unknown; members?: unknown } | null;
    const members = membersFromData(appData);
    const member = members.find((item) => item && typeof item === "object" && (item as { id?: unknown }).id === memberId) as Record<string, unknown> | undefined;
    const tombstoneSnapshot = await get(ref(firebaseDatabase, `${MEMBER_TOMBSTONES_PATH}/${memberId}`));
    if (!member && !tombstoneSnapshot.exists()) throw new FirebaseSyncError("verify", "MEMBER_NOT_FOUND", "المشترك غير موجود في Firebase");
    const uid = typeof member?.authUid === "string" ? member.authUid : "";
    await deleteMemberRecord(firebaseDatabase, memberId, member);
    if (uid) await update(ref(firebaseDatabase), { [`membersByUid/${uid}`]: null });

    // The keyed record transaction above targets only this member and leaves
    // unrelated records untouched.

    const phone = typeof member?.phoneE164 === "string" ? member.phoneE164 : typeof member?.phone === "string" ? member.phone : "";
    if (phone) await runTransaction(ref(firebaseDatabase, `memberPhoneIndex/${phoneIndexKey(phone)}`), (current) => current === memberId ? null : current);

    const [membersCheck, profileCheck] = await Promise.all([
      get(ref(firebaseDatabase, MEMBERS_PATH)),
      uid ? get(ref(firebaseDatabase, `membersByUid/${uid}`)) : Promise.resolve(null),
    ]);
    const persistedMembers = membersCheck.val();
    const stillPresent = Boolean(keyedMembers(persistedMembers)[memberId]);
    if (stillPresent || profileCheck?.exists()) throw new FirebaseSyncError("verify", "DELETE_MISMATCH", "لم يتأكد حذف المشترك من Firebase RTDB");
    return { member: member || null, memberId };
  } catch (error) {
    if (error instanceof FirebaseSyncError) throw error;
    throw new FirebaseSyncError("update", firebaseErrorCode(error), "تعذر حذف المشترك من Firebase RTDB");
  }
}

export async function readAdminMember<T>(memberId: string) {
  if (!firebaseDatabase) return null;
  try {
    const snapshot = await get(ref(firebaseDatabase, `${MEMBERS_PATH}/${memberId}`));
    return snapshot.exists() ? snapshot.val() as T : null;
  } catch (error) {
    throw new FirebaseSyncError("read", firebaseErrorCode(error), "تعذر قراءة سجل المشترك من Firebase RTDB");
  }
}

/** Read-only health check for records left behind by an interrupted delete. */
export async function readAdminDeletionConflicts() {
  if (!firebaseDatabase) return [] as Array<{ id: string; member: Record<string, unknown>; deletedAt: string }>;
  const [membersSnapshot, tombstonesSnapshot] = await Promise.all([
    get(ref(firebaseDatabase, MEMBERS_PATH)),
    get(ref(firebaseDatabase, MEMBER_TOMBSTONES_PATH)),
  ]);
  const members = membersSnapshot.val();
  const tombstones = tombstonesSnapshot.val() as Record<string, { deletedAt?: unknown }> | null;
  if (!tombstones || typeof tombstones !== "object") return [];
  return Object.values(keyedMembers(members)).flatMap((member) => {
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
    role?: "SUPER_ADMIN" | "MANAGER" | "COACH";
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
    categories?: unknown;
    migratedAt?: unknown;
  };
  const previous = (options.previous && typeof options.previous === "object"
    ? options.previous
    : null) as {
    schemaVersion?: unknown;
    settings?: unknown;
    exercises?: unknown;
    members?: unknown;
    courses?: unknown;
    categories?: unknown;
    migratedAt?: unknown;
  } | null;
  const updates: Record<string, unknown> = {};
  const same = (left: unknown, right: unknown) =>
    JSON.stringify(stripUndefined(left)) === JSON.stringify(stripUndefined(right));
  const arrayUpdates = (key: "exercises" | "members" | "courses" | "categories") => {
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
  arrayUpdates("categories");

  const nextMembers = Array.isArray(appData.members) ? appData.members as Array<Record<string, unknown>> : [];
  const oldMembers = Array.isArray(previous?.members) ? previous.members as Array<Record<string, unknown>> : [];
  const memberMap = (members: Array<Record<string, unknown>>) => {
    const map = new Map<string, Record<string, unknown>>();
    for (const member of members) {
      if (!member || typeof member.id !== "string" || !member.id.trim()) throw new Error("MEMBER_ID_REQUIRED");
      if (map.has(member.id)) throw new Error("MEMBER_ID_DUPLICATE");
      map.set(member.id, member);
    }
    return map;
  };
  const nextMemberMap = memberMap(nextMembers);
  const oldMemberMap = memberMap(oldMembers);
  const memberOperations: Array<{ type: "upsert" | "delete"; id: string; member?: Record<string, unknown>; previous?: Record<string, unknown> }> = [];
  for (const [id, member] of nextMemberMap) {
    const old = oldMemberMap.get(id);
    if (!old || !same(member, old)) memberOperations.push({ type: "upsert", id, member: stripUndefined(member), previous: old });
  }
  for (const [id, old] of oldMemberMap) {
    if (!nextMemberMap.has(id)) memberOperations.push({ type: "delete", id, previous: old });
  }

  if (options.role === "SUPER_ADMIN") {
    for (const key of ["schemaVersion", "settings"] as const) {
      if (appData[key] !== undefined && !same(appData[key], previous?.[key]))
        updates[`appData/${key}`] = stripUndefined(appData[key]);
    }
    const nextSettings = appData.settings && typeof appData.settings === "object"
      ? appData.settings as Record<string, unknown>
      : null;
    const previousSettings = previous?.settings && typeof previous.settings === "object"
      ? previous.settings as Record<string, unknown>
      : null;
    if (typeof nextSettings?.showBarcodes === "boolean" && nextSettings.showBarcodes !== previousSettings?.showBarcodes)
      updates["publicSettings/showBarcodes"] = nextSettings.showBarcodes;
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
    const description = typeof exercise.description === "string" ? exercise.description.trim().slice(0, 1000) : "";
    const image = typeof exercise.image === "string" ? exercise.image.trim().slice(0, 512) : "";
    const list = (value: unknown, limit = 20) => Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map(item => item.trim().slice(0, 240)).slice(0, limit)
      : [];
    const videoReviewStatus = exercise.videoReviewStatus === "verified" && !!video
      ? "verified"
      : !!video
        ? "needs_review"
        : "none";
    return stripUndefined({
      id: exercise.id,
      name: exercise.name,
      english: exercise.english || "",
      muscle: exercise.muscle,
      sets: exercise.sets,
      reps: exercise.reps,
      rest: exercise.rest,
      video: video || "",
      videoReviewStatus,
      ...(description ? { description } : {}),
      ...(image ? { image } : {}),
      ...(list(exercise.secondaryMuscles, 12).length ? { secondaryMuscles: list(exercise.secondaryMuscles, 12) } : {}),
      ...(list(exercise.equipment, 12).length ? { equipment: list(exercise.equipment, 12) } : {}),
      ...(list(exercise.steps).length ? { steps: list(exercise.steps) } : {}),
      ...(list(exercise.safetyNotes).length ? { safetyNotes: list(exercise.safetyNotes) } : {}),
      ...(list(exercise.commonMistakes).length ? { commonMistakes: list(exercise.commonMistakes) } : {}),
      ...(exercise.anatomyView === "front" || exercise.anatomyView === "back" ? { anatomyView: exercise.anatomyView } : {}),
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
    for (const field of ["id", "name", "english", "muscle", "sets", "reps", "rest", "video", "videoReviewStatus", "description", "image", "secondaryMuscles", "equipment", "steps", "safetyNotes", "commonMistakes", "anatomyView"])
      updates[`publicExercises/${id}/${field}`] = next ? (projection?.[field] ?? null) : null;
  }

  const nextCourses = Array.isArray(appData.courses)
    ? (appData.courses as Array<Record<string, unknown>>)
    : [];
  const oldCourses = Array.isArray(previous?.courses)
    ? (previous.courses as Array<Record<string, unknown>>)
    : [];
  const toPublicCourse = (course: Record<string, unknown>) =>
    stripUndefined({
      id: String(course.id || ""),
      name: String(course.name || "كورس تدريبي"),
      notes: typeof course.notes === "string" ? course.notes.slice(0, 1000) : "",
      dayNotes: normalizeDayNotes(course.dayNotes, Array.isArray(course.days) ? course.days.length : 0),
      days: Array.isArray(course.days) ? course.days : [],
    });
  const nextPublicCourses = new Map<string, Record<string, unknown>>();
  for (const c of nextCourses) {
    if (c && typeof c.id === "string" && c.id) nextPublicCourses.set(c.id, toPublicCourse(c));
  }
  const oldPublicCourses = new Map<string, Record<string, unknown>>();
  for (const c of oldCourses) {
    if (c && typeof c.id === "string" && c.id) oldPublicCourses.set(c.id, toPublicCourse(c));
  }
  const publicCourseIds = new Set([...nextPublicCourses.keys(), ...oldPublicCourses.keys()]);
  for (const cid of publicCourseIds) {
    const next = nextPublicCourses.get(cid);
    const old = oldPublicCourses.get(cid);
    if (same(next, old)) continue;
    updates[`publicCourses/${cid}`] = next || null;
  }

  const profile = (member: Record<string, unknown>) =>
    stripUndefined({
      id: member.id,
      membershipId: member.membershipId || member.id,
      name: member.name,
      height: member.height || "",
      weight: member.weight || "",
      createdAt: member.createdAt || "",
      ...(typeof member.expiresAt === "string" && member.expiresAt ? { expiresAt: member.expiresAt } : {}),
      ...(typeof member.courseName === "string" && member.courseName ? { courseName: member.courseName } : {}),
      ...(typeof member.notes === "string" && member.notes ? { notes: member.notes.slice(0, 1000) } : {}),
      dayNotes: normalizeDayNotes(member.dayNotes, Array.isArray(member.days) ? member.days.length : 0),
      days: member.days || [],
      active: member.active !== false,
    });
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
    // Keep all member mutations and their public projections in one RTDB
    // multi-location update. Rules validate each member's CAS version, while
    // RTDB commits the complete update atomically: a later failure cannot leave
    // a member record half-saved beside stale settings or projections.
    for (const operation of memberOperations) {
      if (operation.type === "upsert") {
        updates[`${MEMBERS_PATH}/${operation.id}`] = prepareMemberRecord(operation.member!, operation.previous);
        continue;
      }
      updates[`${MEMBER_TOMBSTONES_PATH}/${operation.id}`] = {
        deletedAt: new Date().toISOString(),
        version: typeof operation.previous?.version === "number" ? operation.previous.version : 1,
      };
      updates[`${MEMBERS_PATH}/${operation.id}`] = null;
      const authUid = typeof operation.previous?.authUid === "string" ? operation.previous.authUid : "";
      if (authUid) updates[`membersByUid/${authUid}`] = null;
    }
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

export function watchPublicCourse<T>(
  courseId: string,
  callback: (value: T | null) => void,
): Unsubscribe | (() => undefined) {
  if (!firebaseDatabase) {
    callback(null);
    return () => undefined;
  }
  return onValue(
    ref(firebaseDatabase, `publicCourses/${courseId}`),
    (snapshot) => {
      callback(snapshot.exists() ? (snapshot.val() as T) : null);
    },
  );
}

/** Public, read-only projection used by the member portal for display flags. */
export function watchPublicSettings<T>(
  callback: (value: T | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe | (() => undefined) {
  if (!firebaseDatabase) {
    callback(null);
    return () => undefined;
  }
  return onValue(
    ref(firebaseDatabase, "publicSettings"),
    (snapshot) => {
      callback(snapshot.exists() ? (snapshot.val() as T) : null);
    },
    (error) => {
      if (onError) onError(error as Error);
      else callback(null);
    },
  );
}

/** Scoped settings write for authorized gym managers. Never writes the settings parent node. */
export async function saveManagerPrintSettings(values: {
  logo: string; printCoachPhotoUrl: string; printHallPhotoUrl: string;
  printFooterNote: string; phone: string; instagram: string;
}) {
  if (!firebaseDatabase) throw new Error("Firebase RTDB غير مهيأ");
  const changes: Record<string, string> = {};
  for (const key of ["logo","printCoachPhotoUrl","printHallPhotoUrl","printFooterNote","phone","instagram"] as const) {
    const value = values[key].trim();
    const max = key === "printFooterNote" ? 500 : key === "phone" ? 64 : 512;
    if (value.length > max) throw new Error("القيمة طويلة جداً: " + key);
    if (["logo","printCoachPhotoUrl","printHallPhotoUrl"].includes(key) &&
       value && !(value.startsWith("/") && !value.startsWith("//") && !value.includes("..")) &&
       !/^https:\/\//i.test(value)) throw new Error("رابط الصورة يجب أن يبدأ بـ HTTPS أو /assets/");
    changes[key] = value;
  }
  await update(ref(firebaseDatabase,"appData/settings"),changes);
  const verified = (await get(ref(firebaseDatabase,"appData/settings"))).val() as Record<string, unknown> | null;
  if (!verified || Object.keys(changes).some(key => verified[key] !== changes[key]))
    throw new Error("تعذر تأكيد حفظ إعدادات الطباعة");
}
