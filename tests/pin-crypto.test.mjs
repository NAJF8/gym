import test from "node:test";
import assert from "node:assert/strict";
import { constantTimeEqual, derivePin, hashPin, isPin, normalizePhone, randomPin } from "../worker/src/crypto.ts";

test("PIN generation is exactly four decimal digits", () => {
  for (let index = 0; index < 100; index += 1) assert.match(randomPin(), /^\d{4}$/);
});

test("PIN derivation verifies without storing the raw PIN", async () => {
  const credential = await hashPin("0427");
  assert.equal(credential.hash.includes("0427"), false);
  const derived = await derivePin("0427", Uint8Array.from(atob(credential.salt), char => char.charCodeAt(0)));
  const expected = Uint8Array.from(atob(credential.hash), char => char.charCodeAt(0));
  assert.equal(constantTimeEqual(derived, expected), true);
  assert.equal(constantTimeEqual(await derivePin("0428", Uint8Array.from(atob(credential.salt), char => char.charCodeAt(0))), expected), false);
});

test("phone and PIN input validation is strict", () => {
  assert.equal(normalizePhone("+964 782 123 4567"), "+9647821234567");
  assert.equal(isPin("0004"), true);
  assert.equal(isPin("123"), false);
  assert.throws(() => normalizePhone("not-a-phone"));
});
