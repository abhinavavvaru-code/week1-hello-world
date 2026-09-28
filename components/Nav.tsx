import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import NavLinks from './NavLinks'
import SignOutButton from './SignOutButton'

export default async function Nav() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let name = ''
  let avatarUrl: string | null = null

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('first_name, avatar_url')
      .eq('id', user.id)
      .single()

    name = profile?.first_name || user.email || ''
    avatarUrl = profile?.avatar_url || user.user_metadata?.avatar_url || null
  }

  return (
    <header className="nav">
      <div className="shell nav-inner">
        <Link href="/" className="wordmark">
          <MicIcon />
          Punchline
        </Link>

        <NavLinks signedIn={!!user} />

        <div className="nav-auth">
          {user ? (
            <>
              <Link href="/profile" className="nav-user">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="" className="avatar" referrerPolicy="no-referrer" />
                ) : (
                  <span className="avatar avatar-fallback" aria-hidden="true">
                    {name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="nav-name">{name}</span>
              </Link>
              <SignOutButton />
            </>
          ) : (
            <Link href="/login" className="btn btn-primary btn-sm">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}

function MicIcon() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="8.5" y="2" width="7" height="12" rx="3.5" fill="currentColor" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
      <path d="M8.5 22h7" />
    </svg>
  )
}
