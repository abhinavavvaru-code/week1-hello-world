'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Profile = {
  first_name: string | null
  last_name: string | null
  avatar_url: string | null
} | null

export default function ProfileForm({
  userId,
  email,
  profile,
}: {
  userId: string
  email: string
  profile: Profile
}) {
  const [firstName, setFirstName] = useState(profile?.first_name ?? '')
  const [lastName, setLastName] = useState(profile?.last_name ?? '')
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? '')
  const [status, setStatus] = useState({ text: '', error: false })
  const [busy, setBusy] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const missingGoogleName = !profile?.first_name && !profile?.last_name
  const initial = (firstName || email).charAt(0).toUpperCase()

  const uploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setStatus({ text: 'Choose a JPG, PNG, WebP, or GIF photo.', error: true })
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setStatus({ text: 'Pick an image under 5 MB.', error: true })
      return
    }

    setBusy(true)
    setStatus({ text: 'Uploading photo…', error: false })

    // The image goes to Storage; only its URL goes in the database
    const safeName = file.name.replace(/[^a-zA-Z0-9.]/g, '-')
    const path = `${userId}/${Date.now()}-${safeName}`
    try {
      const { error } = await supabase.storage.from('avatars').upload(path, file)
      if (error) throw error
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      setAvatarUrl(data.publicUrl)
      setStatus({ text: 'Photo uploaded. Save your profile to keep it.', error: false })
    } catch {
      setStatus({ text: 'Your photo could not be uploaded. Please try again.', error: true })
    } finally {
      setBusy(false)
    }
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setStatus({ text: 'Saving…', error: false })

    try {
      const { error } = await supabase.from('profiles').upsert({
        id: userId,
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        avatar_url: avatarUrl || null,
      })
      if (error) throw error
      setStatus({ text: 'Profile saved.', error: false })
      router.refresh()
    } catch {
      setStatus({ text: 'Your profile could not be saved. Please try again.', error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel narrow">
      <h1 className="page-title">Your profile</h1>
      <p className="lede">
        Signed in as {email}. Your Google details are filled in automatically; edit them whenever you like.
      </p>
      {missingGoogleName && <p className="hint">Google didn&apos;t provide your name. You can add your first and last name below.</p>}

      <form onSubmit={save} className="stack">
        <div className="photo-row">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="Your profile photo" className="avatar avatar-lg" referrerPolicy="no-referrer" />
          ) : (
            <span className="avatar avatar-lg avatar-fallback" aria-hidden="true">
              {initial}
            </span>
          )}
          <label className="btn btn-sm file-btn">
            {avatarUrl ? 'Change photo' : 'Upload photo'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="sr-only"
              onChange={uploadPhoto}
              disabled={busy}
            />
          </label>
        </div>

        <div className="field">
          <label htmlFor="first-name">First name</label>
          <input
            id="first-name"
            className="input"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
            disabled={busy}
          />
        </div>

        <div className="field">
          <label htmlFor="last-name">Last name</label>
          <input
            id="last-name"
            className="input"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
            disabled={busy}
          />
        </div>

        <div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Please wait…' : 'Save profile'}
          </button>
        </div>

        <p className={status.error ? 'status status-error' : 'status'} role="status">
          {status.text}
        </p>
      </form>
    </div>
  )
}
