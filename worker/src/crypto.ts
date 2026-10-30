// Cloudflare Workers WebCrypto currently caps PBKDF2 iterations at 100,000.
// Staging credentials already use this value; keep the algorithm and salt format unchanged.
const PBKDF2_ITERATIONS = 100_000;
const HASH_BYTES = 32;
const PIN_HASH_DOMAIN = "alasas-pin-hash-v2:";
const PIN_HASH_ALGORITHM = "PBKDF2-SHA256-HMAC";

export function normalizePhone(value: unknown) {
  let phone = typeof value === "string"
    ? value
        .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x660))
        .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x6f0))
        .replace(/[\s().\-\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    : "";
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  if (/^\+96407\d{9}$/.test(phone)) phone = `+964${phone.slice(5)}`;
  else if (/^96407\d{9}$/.test(phone)) phone = `+964${phone.slice(4)}`;
  else if (/^07\d{9}$/.test(phone)) phone = `+964${phone.slice(1)}`;
  else if (/^7\d{9}$/.test(phone)) phone = `+964${phone}`;
  else if (/^9647\d{9}$/.test(phone)) phone = `+${phone}`;
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

async function pinInput(pin: string, pepper?: string) {
  if (!pepper) return new TextEncoder().encode(pin);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${PIN_HASH_DOMAIN}${pin}`),
  ));
}

export async function derivePin(pin: string, salt: Uint8Array, pepper?: string) {
  const material = await crypto.subtle.importKey("raw", await pinInput(pin, pepper), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, material, HASH_BYTES * 8);
  return new Uint8Array(bits);
}

export async function hashPin(pin: string, pepper?: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: bytesToBase64(salt), hash: bytesToBase64(await derivePin(pin, salt, pepper)) };
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a[index] ^ b[index];
  return result === 0;
}

async function importPinCipherKey(secret: string) {
  const clean = typeof secret === "string" ? secret.trim() : "";
  if (!clean) throw new Error("PIN_CIPHER_KEY_MISSING");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`alasas-pin-aes-gcm-v1:${clean}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptPin(pin: string, secret: string, memberId: string) {
  if (!isPin(pin)) throw new Error("PIN_INVALID");
  const key = await importPinCipherKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`member:${memberId}`);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    new TextEncoder().encode(pin),
  );
  return `v1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptPin(envelope: string, secret: string, memberId: string) {
  if (typeof envelope !== "string" || !envelope.startsWith("v1:")) throw new Error("PIN_CIPHER_INVALID");
  const parts = envelope.split(":");
  if (parts.length !== 3 || !parts[1] || !parts[2]) throw new Error("PIN_CIPHER_INVALID");
  const key = await importPinCipherKey(secret);
  const iv = base64ToBytes(parts[1]);
  const ciphertext = base64ToBytes(parts[2]);
  const aad = new TextEncoder().encode(`member:${memberId}`);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    ciphertext,
  );
  const decoded = new TextDecoder().decode(plaintext);
  if (!isPin(decoded)) throw new Error("PIN_CIPHER_INVALID");
  return decoded;
}

export { PBKDF2_ITERATIONS, PIN_HASH_ALGORITHM };
