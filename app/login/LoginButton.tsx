'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginButton() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const signIn = async () => {
    setBusy(true)
    setError('')
    try {
      const { error } = await createClient().auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      })
      if (error) throw error
    } catch {
      setError('Google sign-in is unavailable right now. Please try again.')
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="google-button" onClick={signIn} disabled={busy} aria-busy={busy}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z" />
          <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.06v2.59A10 10 0 0 0 12 22Z" />
          <path fill="#FBBC05" d="M6.41 13.92a6 6 0 0 1 0-3.84V7.49H3.06a10 10 0 0 0 0 9.02l3.35-2.59Z" />
          <path fill="#EA4335" d="M12 5.96c1.47 0 2.79.5 3.82 1.49l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.49l3.35 2.59A5.98 5.98 0 0 1 12 5.96Z" />
        </svg>
        {busy ? 'Connecting to Google…' : 'Continue with Google'}
      </button>
      {error && <p className="status status-error" role="alert">{error}</p>}
    </>
  )
}
