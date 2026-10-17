import { get, onValue, ref, update, type Unsubscribe } from "firebase/database";
import { firebaseDatabase } from "./firebase";
import { safeVideoUrl } from "./videoUrl";

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

export function dedupeById<T extends { id: string }>(items: T[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
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
  return onValue(ref(firebaseDatabase, "appData"), (snapshot) => {
    callback(snapshot.exists() ? (snapshot.val() as T) : null);
  });
}

export async function readAdminData<T>() {
  if (!firebaseDatabase) return null;
  try {
    const snapshot = await get(ref(firebaseDatabase, "appData"));
    return snapshot.exists() ? (snapshot.val() as T) : null;
  } catch (error) {
    throw new FirebaseSyncError("read", firebaseErrorCode(error), "تعذر قراءة Firebase RTDB");
  }
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
  arrayUpdates("members");
  arrayUpdates("courses");

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
      photo: member.photo || "",
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
