import { createClient } from '@/lib/supabase/server'
import { getIdentity, type ProfileFields } from '@/lib/auth'
import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  if (!code || searchParams.has('error')) return authRedirect(origin, '/login?error=auth')

  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error || !data.user) return authRedirect(origin, '/login?error=auth')

    // Profile details enhance the UI; a profile write must never prevent sign-in.
    try {
      await fillMissingGoogleDetails(supabase, data.user)
    } catch {
      console.warn('Signed in successfully, but profile details could not be synchronized.')
    }
    return authRedirect(origin, '/')
  } catch {
    return authRedirect(origin, '/login?error=auth')
  }
}

function authRedirect(origin: string, path: string) {
  const response = NextResponse.redirect(new URL(path, origin))
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

async function fillMissingGoogleDetails(supabase: SupabaseClient, user: User) {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('first_name, last_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle()
  if (error) return

  const google = getIdentity(user)
  const defaults: ProfileFields = {
    first_name: google.firstName || null,
    last_name: google.lastName || null,
    avatar_url: google.avatarUrl,
  }

  if (!profile) {
    // A trigger usually creates this row. Ignore a duplicate if it arrives now.
    await supabase.from('profiles').upsert({ id: user.id, ...defaults }, {
      onConflict: 'id',
      ignoreDuplicates: true,
    })
    return
  }

  for (const field of ['first_name', 'last_name', 'avatar_url'] as const) {
    const current = profile[field]
    if ((typeof current === 'string' && current.trim()) || !defaults[field]) continue

    // Match the missing value we read so a concurrent custom edit wins.
    const update = supabase.from('profiles').update({ [field]: defaults[field] }).eq('id', user.id)
    if (current === null) await update.is(field, null)
    else await update.eq(field, current)
  }
}
