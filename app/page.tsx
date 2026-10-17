import Link from 'next/link'
import { createHash } from 'node:crypto'
import { getAuth } from '@/lib/auth'
import { loadCaptions } from '@/lib/caption-data'
import CaptionGallery from '@/components/CaptionGallery'
import RetryButton from '@/components/RetryButton'

export const dynamic = 'force-dynamic'

export default async function Home({ searchParams }: { searchParams: Promise<{ generation?: string; author?: string; caption?: string }> }) {
  const { supabase, user } = await getAuth()
  const { captions, error } = await loadCaptions(supabase)
  const { generation, author, caption } = await searchParams
  const focusCaption = typeof caption === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(caption) ? caption : ''
  const authorId = typeof author === 'string' ? author : ''
  const publicAuthor = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authorId)
    ? `creator-${createHash('sha256').update(authorId.toLowerCase(), 'utf8').digest('hex')}`
    : /^creator-[0-9a-f]{64}$/i.test(authorId) ? authorId.toLowerCase() : ''
  let newCaptionIds: string[] = []
  if (user && typeof generation === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(generation)) {
    const { data: mine } = await supabase.from('caption_generations').select('id')
      .eq('id', generation).eq('user_id', user.id).eq('status', 'succeeded').maybeSingle()
    if (mine) {
      const { data: saved } = await supabase.from('captions').select('id').eq('generation_id', mine.id)
      newCaptionIds = (saved ?? []).map((caption) => caption.id)
    }
  }
  return (
    <main id="main-content" className="shell page-shell explore-page">
      <section className="page-heading feed-heading">
        <div>
          <p className="eyebrow"><span className="live-dot" /> THE HUMOR PROJECT</p>
          <h1>Find your <span>funny.</span></h1>
          <p className="lede">{user ? 'Your photos. Short punchlines. A community with opinions.' : 'A picture. A punchline. Your call. Browse freely and sign in to join the fun.'}</p>
        </div>
        <div className="feed-links"><Link className="btn btn-primary" href="/create">Create a post <span aria-hidden="true">↗</span></Link></div>
      </section>
      <div id="gallery" className="gallery-anchor" />
      {error ? (
        <div className="empty-state" role="alert">
          <h2>The captions couldn&apos;t load.</h2>
          <p>Please try again in a moment.</p>
          <RetryButton />
        </div>
      ) : <>
        {newCaptionIds.length === 3 && <p className="generation-saved" role="status">Three fresh captions, saved and ready for your verdict.</p>}
        <CaptionGallery key={`${user?.id || 'public'}-${generation || 'all'}-${publicAuthor}-${focusCaption}`} initialCaptionId={focusCaption} initialCaptions={captions} newCaptionIds={newCaptionIds} userId={user?.id || ''} initialAuthor={publicAuthor} />
      </>}
      <footer className="page-footer">AI captions. Human taste.<span>Made for the Humor Project.</span></footer>
    </main>
  )
}
