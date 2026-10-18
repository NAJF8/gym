export type LibraryExercise = {
  id: string; name: string; english?: string; muscle: string;
  sets: number | string; reps: string; rest: string; video?: string;
};

/** Adds only missing items; existing course-linked records are never changed. */
export function mergeExerciseLibrary<T extends LibraryExercise>(existing: T[], suggestions: T[]) {
  const ids = new Set(existing.map((item) => item.id));
  const names = new Set(existing.map((item) => `${item.muscle}:${(item.english || item.name).trim().toLocaleLowerCase()}`));
  const additions = suggestions.filter((item) => {
    const key = `${item.muscle}:${(item.english || item.name).trim().toLocaleLowerCase()}`;
    if (ids.has(item.id) || names.has(key)) return false;
    ids.add(item.id); names.add(key); return true;
  });
  return { exercises: additions.length ? [...existing, ...additions] : existing, added: additions.length };
}
