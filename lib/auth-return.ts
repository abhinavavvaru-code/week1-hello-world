export const AUTH_RETURN_COOKIE = 'punchline-auth-return'
export const AUTH_RETURN_COOKIE_PATH = '/auth/callback'
const allowedPaths = new Set(['/', '/explore', '/create', '/my-posts', '/dashboard', '/profile'])
const fallback = '/explore'

// Use the same narrow local-route contract at every boundary, including the
// callback cookie: none of these values may become an external redirect.
export function safeAuthReturn(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || value !== value.trim()
    || !value.startsWith('/') || value.startsWith('//')) return fallback
  const pathname = value.split(/[?#]/, 1)[0]
  if (!allowedPaths.has(pathname)) return fallback
  let decoded = value
  try {
    for (let pass = 0; pass < 4; pass++) {
      if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith('//')) return fallback
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    }
    if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith('//')) return fallback
    const url = new URL(value, 'https://punchline.invalid')
    if (url.origin !== 'https://punchline.invalid' || !allowedPaths.has(url.pathname)) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch { return fallback }
}

export function authReturnFromCookie(value: unknown): string {
  if (typeof value !== 'string') return fallback
  try { return safeAuthReturn(decodeURIComponent(value)) }
  catch { return fallback }
}
