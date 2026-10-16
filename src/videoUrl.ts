const APPROVED_VIDEO_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'youtu.be', 'vimeo.com', 'www.vimeo.com'])

/** Return a canonical HTTPS video URL, or null for an absent/unsafe value. */
export function safeVideoUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !value.startsWith('https://') || value !== value.trim() || value.includes('%') || /[\u0000-\u0020\u007f]/.test(value)) return null
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !APPROVED_VIDEO_HOSTS.has(hostname)) return null
    return url.href
  } catch {
    return null
  }
}

export function isSafeVideoUrl(value: unknown) {
  return value === undefined || value === null || value === '' || safeVideoUrl(value) !== null
}
