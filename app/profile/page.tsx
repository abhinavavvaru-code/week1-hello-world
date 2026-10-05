import { getIdentity, requireUser } from '@/lib/auth'
import ProfileForm from './ProfileForm'

export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const { supabase, user } = await requireUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, last_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle()

  const identity = getIdentity(user, profile)

  return (
    <main id="main-content" className="shell">
      <ProfileForm userId={user.id} email={identity.email} profile={{
        first_name: identity.firstName,
        last_name: identity.lastName,
        avatar_url: identity.avatarUrl,
      }} />
    </main>
  )
}
