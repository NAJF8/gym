export function normalizeIraqiPhone(input: string): string {
  let value = input.trim().replace(/[\s()-]/g, '')
  if (value.startsWith('00')) value = `+${value.slice(2)}`
  if (value.startsWith('+964')) value = value.slice(4)
  if (value.startsWith('964')) value = value.slice(3)
  if (value.startsWith('7')) value = `0${value}`
  if (!/^07\d{9}$/.test(value)) throw new Error('أدخل رقم هاتف عراقي صحيحاً مثل 07701234567')
  return `+964${value.slice(1)}`
}

export function formatIraqiPhone(input: string) {
  try {
    const normalized = normalizeIraqiPhone(input)
    return `0${normalized.slice(4)}`
  } catch {
    return input
  }
}

export function validateMemberPin(pin: string) {
  return /^\d{4}$/.test(pin)
}

export function generateSecurePin() {
  if (!globalThis.crypto?.getRandomValues) throw new Error('مولد عشوائي آمن غير متاح')
  const bytes = new Uint32Array(1)
  crypto.getRandomValues(bytes)
  return String(bytes[0] % 10000).padStart(4, '0')
}

export const memberPinApiUrl = String(import.meta.env.VITE_MEMBER_PIN_API_URL || '').trim().replace(/\/$/, '')

