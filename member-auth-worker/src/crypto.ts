import { SignJWT, importPKCS8 } from 'jose'

const textEncoder = new TextEncoder()

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64ToBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(normalized)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

export function randomBytes(length: number) {
  const result = new Uint8Array(length)
  crypto.getRandomValues(result)
  return result
}

/** Rejection sampling avoids modulo bias while preserving leading zeroes. */
export function generatePin() {
  while (true) {
    const bytes = randomBytes(4)
    const value = new DataView(bytes.buffer).getUint32(0, false)
    if (value >= 4_294_960_000) continue
    return String(value % 10000).padStart(4, '0')
  }
}

export function generateSalt() {
  return randomBytes(16)
}

export async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(value)))
}

export async function derivePinHash(pin: string, salt: Uint8Array, pepper: string, iterations: number) {
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(`${pin}:${pepper}`), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as unknown as ArrayBuffer, iterations, hash: 'SHA-256' }, key, 256))
}

export function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false
  let result = 0
  for (let index = 0; index < left.length; index += 1) result |= left[index] ^ right[index]
  return result === 0
}

export function encodeBytes(value: Uint8Array) {
  return bytesToBase64Url(value)
}

export function decodeBytes(value: string) {
  return base64ToBytes(value)
}

export async function signFirebaseCustomToken(input: {
  uid: string
  projectId: string
  serviceAccountEmail: string
  privateKeyId: string
  privateKeyPem: string
  ttlSeconds: number
  claims: Record<string, unknown>
}) {
  const key = await importPKCS8(input.privateKeyPem, 'RS256')
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ ...input.claims, uid: input.uid })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: input.privateKeyId })
    .setIssuer(input.serviceAccountEmail)
    .setSubject(input.serviceAccountEmail)
    .setAudience('https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit')
    .setIssuedAt(now)
    .setExpirationTime(now + Math.min(input.ttlSeconds, 3600))
    .setJti(`${input.uid}:${now}:${bytesToBase64Url(randomBytes(8))}`)
    .sign(key)
}
