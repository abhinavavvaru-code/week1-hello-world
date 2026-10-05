import { requireUser } from '@/lib/auth'
import { loadCaptions } from '@/lib/caption-data'
import CaptionGallery from '@/components/CaptionGallery'
import RetryButton from '@/components/RetryButton'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const { supabase, user } = await requireUser()
  const { captions, error } = await loadCaptions(supabase, user.id)
  return (
    <main id="main-content" className="shell page-shell">
      <section className="page-heading">
        <p className="eyebrow"><span className="live-dot" /> THE HUMOR PROJECT</p>
        <h1>Find your <span>funny.</span></h1>
        <p className="lede">A picture. A punchline. Your call.</p>
      </section>
      {error ? (
        <div className="empty-state" role="alert">
          <h2>The jokes are taking a break.</h2>
          <p>We couldn&apos;t load the captions. Please try again in a moment.</p>
          <RetryButton />
        </div>
      ) : <CaptionGallery initialCaptions={captions} userId={user.id} />}
      <footer className="page-footer">A small study in what makes us laugh.<span>Made for the Humor Project.</span></footer>
    </main>
  )
}
