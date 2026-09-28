'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function SignOutButton() {
  const router = useRouter()

  const signOut = async () => {
    await createClient().auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <button type="button" onClick={signOut} className="btn btn-quiet btn-sm">
      Sign out
    </button>
  )
}
