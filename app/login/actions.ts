'use server'

import { cookies } from 'next/headers'
import { AUTH_RETURN_COOKIE, AUTH_RETURN_COOKIE_PATH, safeAuthReturn } from '@/lib/auth-return'

export async function rememberAuthReturn(returnTo: unknown) {
  const cookieStore = await cookies()
  cookieStore.set(AUTH_RETURN_COOKIE, encodeURIComponent(safeAuthReturn(returnTo)), {
    path: AUTH_RETURN_COOKIE_PATH,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
  })
}
