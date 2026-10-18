import fs from "node:fs";

const INVALID_ID = /[.#$\[\]/]/;

export function migrateMembers(input) {
  const members = Array.isArray(input?.members) ? input.members : [];
  const membersById = {};
  const errors = [];
  for (const [index, member] of members.entries()) {
    const id = member && typeof member === "object" ? member.id : undefined;
    if (typeof id !== "string" || !id.trim() || INVALID_ID.test(id)) {
      errors.push({ index, code: "MEMBER_ID_REQUIRED_OR_INVALID", id: id ?? null });
      continue;
    }
    if (membersById[id]) {
      errors.push({ index, code: "MEMBER_ID_DUPLICATE", id });
      continue;
    }
    membersById[id] = { ...member, id, version: Number.isInteger(member.version) && member.version > 0 ? member.version : 1 };
  }
  const sourceIds = members.filter(member => member && typeof member.id === "string").map(member => member.id);
  const targetIds = Object.keys(membersById);
  return {
    ok: errors.length === 0 && sourceIds.length === targetIds.length,
    errors,
    sourceCount: members.length,
    targetCount: targetIds.length,
    sourceIds,
    targetIds,
    membersById,
    verification: errors.length === 0 && members.length === targetIds.length && sourceIds.every(id => targetIds.includes(id))
      ? "PASS"
      : "FAIL",
  };
}

if (import.meta.url === `file://${process.argv[1].replaceAll("\\", "/")}`) {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath) throw new Error("Usage: node scripts/migrate-members-keyed.mjs input.json [output.json]");
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const result = migrateMembers(input);
  console.log(JSON.stringify({ ...result, membersById: undefined }, null, 2));
  if (!result.ok) process.exitCode = 2;
  if (outputPath && result.ok) fs.writeFileSync(outputPath, `${JSON.stringify({ membersById: result.membersById }, null, 2)}\n`, "utf8");
}
