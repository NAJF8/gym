import { get, onValue, ref, update, type Unsubscribe } from "firebase/database";
import { firebaseDatabase } from "./firebase";
import { safeVideoUrl } from "./videoUrl";

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
  const snapshot = await get(ref(firebaseDatabase, "appData"));
  return snapshot.exists() ? (snapshot.val() as T) : null;
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

export async function writeAdminData<T>(payload: T) {
  if (!firebaseDatabase) throw new Error("Firebase RTDB غير مهيأ");
  const publicExercises = Array.isArray(
    (payload as { exercises?: unknown }).exercises,
  )
    ? stripUndefined(Object.fromEntries(
        (
          payload as { exercises: Array<Record<string, unknown>> }
        ).exercises.map((exercise) => {
          const video = safeVideoUrl(exercise.video);
          if (exercise.video !== undefined && exercise.video !== "" && !video)
            throw new Error("رابط فيديو غير آمن أو غير معتمد");
          return [
            exercise.id,
            {
              id: exercise.id,
              name: exercise.name,
              english: exercise.english || "",
              muscle: exercise.muscle,
              sets: exercise.sets,
              reps: exercise.reps,
              rest: exercise.rest,
              video: video || "",
            },
          ];
        }),
      ))
    : undefined;
  const members = Array.isArray((payload as { members?: unknown }).members)
    ? (payload as { members: Array<Record<string, unknown>> }).members
    : [];
  const nextMemberProfiles = Object.fromEntries(
    members
      .filter(
        (member) =>
          typeof member.authUid === "string" && member.authUid.length >= 20,
      )
      .map((member) => [
        member.authUid as string,
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
        }),
      ]),
  );
  const memberUpdates = Object.fromEntries([
    ...Object.entries(nextMemberProfiles).map(([uid, profile]) => [
      `membersByUid/${uid}`,
      profile,
    ]),
  ]);
  const appData = payload as {
    schemaVersion?: unknown;
    settings?: unknown;
    exercises?: unknown;
    members?: unknown;
    courses?: unknown;
    migratedAt?: unknown;
  };
  const safePayload = stripUndefined({
    schemaVersion: appData.schemaVersion,
    settings: appData.settings,
    exercises: appData.exercises,
    members: appData.members,
    courses: appData.courses,
    ...(appData.migratedAt ? { migratedAt: appData.migratedAt } : {}),
  });
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(safePayload as Record<string, unknown>)) {
    if (value !== undefined) updates[`appData/${key}`] = value;
  }
  await update(ref(firebaseDatabase), {
    ...updates,
    ...(publicExercises ? { publicExercises } : {}),
    ...memberUpdates,
  });
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
