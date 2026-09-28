'use client'

import { createClient } from '@/lib/supabase/client'

export default function Login() {
  const signIn = async () => {
    await createClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  }

  return (
    <main className="shell">
      <div className="panel narrow centered">
        <h1 className="page-title">Sign in to vote</h1>
        <p className="lede">
          Use your Google account. Your first sign-in creates your profile.
        </p>
        <button type="button" className="btn btn-primary" onClick={signIn}>
          Continue with Google
        </button>
      </div>
    </main>
  )
}
