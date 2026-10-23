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

/** Return a YouTube video id only when the stored URL identifies one video. */
export function youtubeVideoId(value: unknown): string | null {
  const canonical = safeVideoUrl(value)
  if (!canonical) return null
  try {
    const url = new URL(canonical)
    const host = url.hostname.toLowerCase()
    let id = ''
    if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0]
    else if (url.pathname === '/watch') id = url.searchParams.get('v') || ''
    else if (/^\/(embed|shorts)\//.test(url.pathname)) id = url.pathname.split('/')[2] || ''
    return /^[A-Za-z0-9_-]{3,64}$/.test(id) ? id : null
  } catch {
    return null
  }
}

export function youtubeEmbedUrl(value: unknown): string | null {
  const id = youtubeVideoId(value)
  return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0&modestbranding=1` : null
}
