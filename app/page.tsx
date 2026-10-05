import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { loadCaptions } from '@/lib/caption-data'
import CaptionGallery from '@/components/CaptionGallery'
import RetryButton from '@/components/RetryButton'

export const dynamic = 'force-dynamic'

export default async function Home({ searchParams }: { searchParams: Promise<{ generation?: string }> }) {
  const { supabase, user } = await requireUser()
  const { captions, error } = await loadCaptions(supabase)
  const { generation } = await searchParams
  let newCaptionIds: string[] = []
  if (typeof generation === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(generation)) {
    const { data: mine } = await supabase.from('caption_generations').select('id')
      .eq('id', generation).eq('user_id', user.id).eq('status', 'succeeded').maybeSingle()
    if (mine) {
      const { data: saved } = await supabase.from('captions').select('id').eq('generation_id', mine.id)
      newCaptionIds = (saved ?? []).map((caption) => caption.id)
    }
  }
  return (
    <main id="main-content" className="shell page-shell">
      <section className="page-heading feed-heading">
        <div>
          <p className="eyebrow"><span className="live-dot" /> THE HUMOR PROJECT</p>
          <h1>Find your <span>funny.</span></h1>
          <p className="lede">AI writes the punchlines. You decide what lands.</p>
        </div>
        <Link className="btn btn-primary" href="/create">Make some funny <span aria-hidden="true">↗</span></Link>
      </section>
      {error ? (
        <div className="empty-state" role="alert">
          <h2>The captions couldn&apos;t load.</h2>
          <p>Please try again in a moment.</p>
          <RetryButton />
        </div>
      ) : <>
        {newCaptionIds.length === 3 && <p className="generation-saved" role="status">Three fresh captions, saved and ready for your verdict.</p>}
        <CaptionGallery initialCaptions={captions} newCaptionIds={newCaptionIds} />
      </>}
      <footer className="page-footer">AI captions. Human taste.<span>Made for the Humor Project.</span></footer>
    </main>
  )
}
