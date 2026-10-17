/** Restrict user-controlled print images to inert image URLs. */
export function safeImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\u0000-\u0020\u007f]/.test(value)) return null
  if (/^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=]+$/i.test(value)) return value
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port) return url.href
  } catch { /* invalid image URL */ }
  return null
}
