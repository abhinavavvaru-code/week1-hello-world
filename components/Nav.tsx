import Link from 'next/link'
import { getAuth, getIdentity } from '@/lib/auth'
import NavLinks from './NavLinks'
import MemberMenu from './MemberMenu'

export default async function Nav() {
  const { supabase, user } = await getAuth()
  let identity = null
  if (user) {
    const { data: profile } = await supabase.from('profiles')
      .select('first_name, last_name, avatar_url').eq('id', user.id).maybeSingle()
    identity = getIdentity(user, profile)
  }
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      {user && (
        <header className="nav">
          <div className="shell nav-inner">
            <Link href="/" className="wordmark" aria-label="Punchline home"><span className="brand-symbol" aria-hidden="true">p<span>.</span></span>Punchline</Link>
            <NavLinks />
            <span className="nav-kicker">A STUDY IN FUNNY</span>
          </div>
        </header>
      )}
      <MemberMenu identity={identity} />
    </>
  )
}
