'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function SignOutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const signOut = async () => {
    setBusy(true)
    setError('')
    try {
      const { error } = await createClient().auth.signOut()
      if (error) throw error
      router.replace('/login')
      router.refresh()
    } catch {
      setError('We couldn’t sign you out. Please try again.')
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" onClick={signOut} className="btn btn-primary signout-button" disabled={busy} aria-busy={busy}>
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
      {error && <p className="status status-error" role="alert">{error}</p>}
    </>
  )
}
