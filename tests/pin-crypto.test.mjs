import test from "node:test";
import assert from "node:assert/strict";
import { constantTimeEqual, decryptPin, derivePin, encryptPin, hashPin, isPin, normalizePhone, PIN_HASH_ALGORITHM, randomPin } from "../worker/src/crypto.ts";

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

test("new PIN credentials are bound to a worker-held secret and versioned", async () => {
  const secret = "staging-pin-secret";
  const credential = await hashPin("0427", secret);
  const salt = Uint8Array.from(atob(credential.salt), char => char.charCodeAt(0));
  const expected = Uint8Array.from(atob(credential.hash), char => char.charCodeAt(0));
  assert.equal(PIN_HASH_ALGORITHM, "PBKDF2-SHA256-HMAC");
  assert.equal(constantTimeEqual(await derivePin("0427", salt, secret), expected), true);
  assert.equal(constantTimeEqual(await derivePin("0427", salt, "wrong-secret"), expected), false);
  assert.equal(constantTimeEqual(await derivePin("0427", salt), expected), false);
});

test("PIN AES-GCM encryption and decryption binds memberId as AAD", async () => {
  const secret = "test-worker-pin-pepper-secret";
  const cipher = await encryptPin("4829", secret, "member-101");
  assert.equal(cipher.includes("4829"), false);
  assert.match(cipher, /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  const decrypted = await decryptPin(cipher, secret, "member-101");
  assert.equal(decrypted, "4829");
  await assert.rejects(() => decryptPin(cipher, secret, "member-other"));
  await assert.rejects(() => decryptPin(cipher, "wrong-secret", "member-101"));
});

test("phone and PIN input validation is strict", () => {
  assert.equal(normalizePhone("+964 782 123 4567"), "+9647821234567");
  assert.equal(normalizePhone("+964 0782 123 4567"), "+9647821234567");
  assert.equal(normalizePhone("\u200E07821234567\u200F"), "+9647821234567");
  assert.equal(normalizePhone("07821234567"), "+9647821234567");
  assert.equal(normalizePhone("٠٧٨٢١٢٣٤٥٦٧"), "+9647821234567");
  assert.equal(normalizePhone("009647821234567"), "+9647821234567");
  assert.equal(isPin("0004"), true);
  assert.equal(isPin("123"), false);
  assert.throws(() => normalizePhone("not-a-phone"));
});
