import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ProfileForm from './ProfileForm'

export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, last_name, avatar_url')
    .eq('id', user.id)
    .single()

  return (
    <main className="shell">
      <ProfileForm userId={user.id} email={user.email ?? ''} profile={profile} />
    </main>
  )
}
