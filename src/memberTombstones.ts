export function filterDeletedMembers<T>(members: T[], tombstones: Record<string, unknown>) {
  return members.filter((item) => !item || typeof item !== "object" || !(String((item as { id?: unknown }).id || "") in tombstones));
}

export function deletedMemberInPayload(members: unknown[], tombstones: Record<string, unknown>) {
  return members.find((member) => Boolean(member && typeof member === "object" && typeof (member as { id?: unknown }).id === "string" && (member as { id: string }).id in tombstones));
}
