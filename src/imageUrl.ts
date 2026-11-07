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

/** Escape every HTML-significant character (text nodes and quoted attributes). */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"'`]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c] || c)
}

/**
 * Validate an image reference for the print HTML. Allows only what
 * `safeImageUrl` accepts (https / raster data URIs) or a same-site absolute
 * path ("/assets/x.png"). Everything else returns null.
 */
export function printImageSrc(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const safe = safeImageUrl(value)
  if (safe) return safe
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('..') && /^\/[A-Za-z0-9._~!$&()*+,;=:@%/-]*$/.test(value)) return value
  return null
}

/** Build an <img> tag with a validated and escaped src; empty string when the source is unsafe. */
export function printImageTag(src: unknown, alt: string): string {
  const safe = printImageSrc(src)
  return safe ? `<img src="${escapeHtml(safe)}" alt="${escapeHtml(alt)}">` : ''
}
