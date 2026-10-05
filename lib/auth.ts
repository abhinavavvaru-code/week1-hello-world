import 'server-only'

import { cache } from 'react'
import { redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

export type ProfileFields = {
  first_name: string | null
  last_name: string | null
  avatar_url: string | null
}

export type Identity = {
  firstName: string
  lastName: string
  name: string
  avatarUrl: string | null
  email: string
}

export const getAuth = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
})

export const requireUser = cache(async () => {
  const { supabase, user } = await getAuth()
  if (!user) redirect('/login')
  return { supabase, user }
})

export function getIdentity(user: User, profile?: Partial<ProfileFields> | null): Identity {
  const metadata = user.user_metadata ?? {}
  const fullName = text(metadata.full_name) || text(metadata.name)
  const nameParts = fullName.split(/\s+/).filter(Boolean)
  const firstName = text(profile?.first_name) || text(metadata.given_name) || nameParts[0] || ''
  const lastName = text(profile?.last_name) || text(metadata.family_name) || nameParts.slice(1).join(' ')
  const email = user.email ?? ''

  return {
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(' ') || fullName || email.split('@')[0] || 'Member',
    avatarUrl: text(profile?.avatar_url) || text(metadata.avatar_url) || text(metadata.picture) || null,
    email,
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
