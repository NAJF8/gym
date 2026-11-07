import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.ts";
import { encryptPin, hashPin, PBKDF2_ITERATIONS } from "../worker/src/crypto.ts";

import { createTestEnv } from "./helpers/worker-env.mjs";

test("Full E2E: Captain PIN Eye reveal, Copy, Reset, Audit Log, and Member Login / Session / Lockout / Isolation", async () => {
  const ctx = createTestEnv({
    "m-001": {
      id: "m-001",
      membershipId: "M-1001",
      name: "أحمد علي",
      phoneE164: "+9647701234567",
      phoneDisplay: "07701234567",
      height: "178",
      weight: "76",
      createdAt: "2026-10-22",
      expiresAt: "2026-11-22",
      courseName: "كورس تضخيم شامل",
      notes: "الالتزام بالإحماء",
      active: true,
      days: [[{ id: "bench-press", name: "بنش برس", muscle: "تمارين الصدر", sets: 4, reps: "10", rest: "90 ثانية", weight: "60 كغم", notes: "تحكم كامل" }]],
    },
    "m-002": {
      id: "m-002",
      membershipId: "M-1002",
      name: "حسين كريم",
      phoneE164: "+9647809876543",
      phoneDisplay: "07809876543",
      height: "182",
      weight: "84",
      createdAt: "2026-10-22",
      active: true,
      days: [[{ id: "squat", name: "سكوات", muscle: "تمارين الأرجل", sets: 4, reps: "8", rest: "120 ثانية" }]],
    },
  });

  // 1. Unauthorized user cannot reveal PIN
  const unauthReveal = await ctx.callWorker("/v1/admin/member-pin-reveal", { memberId: "m-001" });
  assert.equal(unauthReveal.status, 401);

  // 2. Authorized Captain reveals PIN for m-001 (auto-issues on first reveal if not yet issued)
  const firstRevealRes = await ctx.callWorker("/v1/admin/member-pin-reveal", { memberId: "m-001" }, "valid-captain-token");
  assert.equal(firstRevealRes.status, 200);
  const firstRevealBody = await firstRevealRes.json();
  assert.match(firstRevealBody.pin, /^\d{4}$/);
  assert.equal(firstRevealBody.memberId, "m-001");
  assert.equal(firstRevealBody.membershipId, "M-1001");
  assert.equal(firstRevealBody.phoneE164, "+9647701234567");
  const pinA = firstRevealBody.pin;

  // 3. Subsequent Captain Eye click reveals the EXACT same 4-digit PIN (decrypted from AES-256-GCM pin_cipher)
  const secondRevealRes = await ctx.callWorker("/v1/admin/member-pin-reveal", { memberId: "m-001" }, "valid-captain-token");
  assert.equal(secondRevealRes.status, 200);
  const secondRevealBody = await secondRevealRes.json();
  assert.equal(secondRevealBody.pin, pinA);
  assert.equal(secondRevealBody.source, "revealed");

  // 4. Member A logs in using local Iraqi format (07701234567), international (+9647701234567), and bidi-wrapped format
  for (const phoneInput of ["07701234567", "+9647701234567", "\u200e0770 123 4567\u202c"]) {
    const loginRes = await ctx.callWorker("/v1/member/login", { phone: phoneInput, pin: pinA });
    assert.equal(loginRes.status, 200);
    const loginBody = await loginRes.json();
    assert.equal(loginBody.member.id, "m-001");
    assert.equal(loginBody.member.name, "أحمد علي");
    assert.equal(loginBody.member.courseName, "كورس تضخيم شامل");
    assert.equal(loginBody.member.expiresAt, "2026-11-22");
    assert.equal(loginBody.member.notes, "الالتزام بالإحماء");
    assert.ok(loginBody.sessionToken);

    // Verify /v1/member/me session persistence
    const meRes = await ctx.callWorker("/v1/member/me", {}, loginBody.sessionToken);
    assert.equal(meRes.status, 200);
    const meBody = await meRes.json();
    assert.equal(meBody.member.id, "m-001");
  }

  // 5. Issue PIN for Member B and verify strict isolation between Member A and Member B sessions
  const issueBRes = await ctx.callWorker("/v1/admin/member-pin", { memberId: "m-002", phone: "07809876543", reset: false, customPin: "4826" }, "valid-captain-token");
  assert.equal(issueBRes.status, 200);
  const issueBBody = await issueBRes.json();
  assert.equal(issueBBody.pin, "4826");
  assert.equal(issueBBody.memberId, "m-002");
  assert.equal(issueBBody.membershipId, "M-1002");

  const loginARes = await ctx.callWorker("/v1/member/login", { phone: "07701234567", pin: pinA });
  const { sessionToken: tokenA } = await loginARes.json();
  const loginBRes = await ctx.callWorker("/v1/member/login", { phone: "07809876543", pin: "4826" });
  const { sessionToken: tokenB } = await loginBRes.json();

  const meA = await (await ctx.callWorker("/v1/member/me", {}, tokenA)).json();
  const meB = await (await ctx.callWorker("/v1/member/me", {}, tokenB)).json();
  assert.equal(meA.member.id, "m-001");
  assert.equal(meB.member.id, "m-002");
  assert.notEqual(meA.member.id, meB.member.id);

  // 6. Logout revokes session token
  const logoutARes = await ctx.callWorker("/v1/member/logout", {}, tokenA);
  assert.equal(logoutARes.status, 200);
  const meAfterLogout = await ctx.callWorker("/v1/member/me", {}, tokenA);
  assert.equal(meAfterLogout.status, 401);

  // 7. Wrong PIN and unregistered phone return identical generic 401 message
  const wrongPinVal = pinA === "9999" ? "0000" : "9999";
  const wrongPinRes = await ctx.callWorker("/v1/member/login", { phone: "07701234567", pin: wrongPinVal });
  const unknownPhoneRes = await ctx.callWorker("/v1/member/login", { phone: "07901112233", pin: "1234" });
  assert.equal(wrongPinRes.status, 401);
  assert.equal(unknownPhoneRes.status, 401);
  assert.deepEqual(await wrongPinRes.json(), await unknownPhoneRes.json());

  // 8. Five wrong attempts lock the account (429), and after 15m lock expiry, the bucket resets properly!
  for (let i = 0; i < 4; i += 1) {
    await ctx.callWorker("/v1/member/login", { phone: "07701234567", pin: wrongPinVal });
  }
  const lockedAttempt = await ctx.callWorker("/v1/member/login", { phone: "07701234567", pin: pinA });
  assert.equal(lockedAttempt.status, 429);

  // Advance 16 minutes past lock expiry
  ctx.advanceTime(16 * 60_000);
  // One wrong attempt after expiry should NOT re-lock the account; valid PIN should succeed immediately after!
  const singleWrongAfterExpiry = await ctx.callWorker("/v1/member/login", { phone: "07701234567", pin: wrongPinVal });
  assert.equal(singleWrongAfterExpiry.status, 401);
  const validAfterExpiry = await ctx.callWorker("/v1/member/login", { phone: "07701234567", pin: pinA });
  assert.equal(validAfterExpiry.status, 200);

  // 9. Inactive member cannot log in (403 MEMBER_INACTIVE)
  ctx.membersById.set("m-001", { ...ctx.membersById.get("m-001"), active: false });
  const inactiveLogin = await ctx.callWorker("/v1/member/login", { phone: "07701234567", pin: pinA });
  assert.equal(inactiveLogin.status, 403);
  ctx.membersById.set("m-001", { ...ctx.membersById.get("m-001"), active: true });

  // 10. Captain resets PIN -> old PIN stops working, new PIN works & is revealed by Eye endpoint
  const resetRes = await ctx.callWorker("/v1/admin/member-pin", { memberId: "m-001", phone: "07701234567", reset: true, customPin: "7391" }, "valid-captain-token");
  assert.equal(resetRes.status, 200);
  const resetBody = await resetRes.json();
  assert.equal(resetBody.pin, "7391");

  const revealAfterReset = await (await ctx.callWorker("/v1/admin/member-pin-reveal", { memberId: "m-001" }, "valid-captain-token")).json();
  assert.equal(revealAfterReset.pin, "7391");

  const loginWithNewPin = await ctx.callWorker("/v1/member/login", { phone: "07701234567", pin: "7391" });
  assert.equal(loginWithNewPin.status, 200);

  // 11. Deleted member (revoked + tombstoned) cannot log in
  const revokeRes = await ctx.callWorker("/v1/admin/member-revoke", { memberId: "m-002" }, "valid-captain-token");
  assert.equal(revokeRes.status, 200);
  ctx.deletedMemberIds.set("m-002", { deletedAt: "2026-10-22T14:00:00Z", version: 1 });
  ctx.membersById.delete("m-002");

  const deletedLogin = await ctx.callWorker("/v1/member/login", { phone: "07809876543", pin: "4826" });
  assert.equal(deletedLogin.status, 401);
  assert.equal(ctx.credentials.has("m-002"), false);

  // 12. Audit logs recorded PIN_ISSUED, PIN_REVEALED, PIN_RESET, PIN_REVOKED
  const auditRes = await ctx.callWorker("/v1/admin/pin-audit-logs", {}, "valid-captain-token");
  assert.equal(auditRes.status, 200);
  const auditBody = await auditRes.json();
  const actions = new Set(auditBody.logs.map((l) => l.action));
  assert.ok(actions.has("PIN_ISSUED"));
  assert.ok(actions.has("PIN_REVEALED"));
  assert.ok(actions.has("PIN_RESET"));
  assert.ok(actions.has("PIN_REVOKED"));
});
