// Cloudflare Workers WebCrypto currently caps PBKDF2 iterations at 100,000.
// Staging credentials already use this value; keep the algorithm and salt format unchanged.
const PBKDF2_ITERATIONS = 100_000;
const HASH_BYTES = 32;

export function normalizePhone(value: unknown) {
  const phone = typeof value === "string" ? value.replace(/[\s()-]/g, "") : "";
  if (!/^\+?[1-9]\d{7,14}$/.test(phone)) throw new Error("رقم هاتف غير صالح");
  return phone;
}

export function isPin(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}$/.test(value);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export function randomPin() {
  const values = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / 10000) * 10000;
  do crypto.getRandomValues(values); while (values[0] >= limit);
  return String(values[0] % 10000).padStart(4, "0");
}

export async function derivePin(pin: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, material, HASH_BYTES * 8);
  return new Uint8Array(bits);
}

export async function hashPin(pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: bytesToBase64(salt), hash: bytesToBase64(await derivePin(pin, salt)) };
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a[index] ^ b[index];
  return result === 0;
}

export { PBKDF2_ITERATIONS };
