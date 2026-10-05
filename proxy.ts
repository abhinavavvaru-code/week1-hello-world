import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
          Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value))
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname
  const isPublic = path === '/login' || path.startsWith('/auth/')
  if (!user && path.startsWith('/api/')) {
    const denied = NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })
    response.cookies.getAll().forEach((cookie) => denied.cookies.set(cookie))
    denied.headers.set('Cache-Control', 'private, no-store')
    return denied
  }
  const target = !user && !isPublic ? '/login' : user && path === '/login' ? '/' : null

  if (target) {
    const redirect = NextResponse.redirect(new URL(target, request.url))
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie))
    redirect.headers.set('Cache-Control', 'private, no-store')
    return redirect
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
