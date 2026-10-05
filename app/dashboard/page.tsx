import Link from 'next/link'
import { requireUser, getIdentity } from '@/lib/auth'
import { loadCaptions } from '@/lib/caption-data'
import CaptionGallery from '@/components/CaptionGallery'
import RetryButton from '@/components/RetryButton'

export const dynamic = 'force-dynamic'

export default async function Dashboard() {
  const { supabase, user } = await requireUser()
  const { captions, error } = await loadCaptions(supabase)
  const { data: profile } = await supabase.from('profiles')
    .select('first_name, last_name, avatar_url').eq('id', user.id).maybeSingle()
  const identity = getIdentity(user, profile)
  return (
    <main id="main-content" className="shell page-shell">
      <section className="page-heading history-heading">
        <p className="eyebrow">YOUR SENSE OF HUMOR</p>
        <h1>My <span>votes.</span></h1>
        <p className="lede">Hey, {identity.firstName || identity.name}. Here&apos;s what got a reaction.</p>
        <Link className="text-link" href="/">Back to captions <span aria-hidden="true">↗</span></Link>
      </section>
      {error ? (
        <div className="empty-state" role="alert">
          <h2>Your votes couldn&apos;t load.</h2>
          <p>Please try again in a moment.</p>
          <RetryButton />
        </div>
      ) : <CaptionGallery initialCaptions={captions} mode="history" />}
      <footer className="page-footer">Your votes, all in one place.<span>Only visible to you.</span></footer>
    </main>
  )
}
