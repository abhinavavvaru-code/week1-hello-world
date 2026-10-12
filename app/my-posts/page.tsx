import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { loadCaptions } from '@/lib/caption-data'
import CaptionGallery from '@/components/CaptionGallery'
import RetryButton from '@/components/RetryButton'
export const dynamic = 'force-dynamic'
export default async function MyPosts() {
  const {supabase,user}=await requireUser()
  const {captions,error}=await loadCaptions(supabase)
  const mine=captions.filter((caption)=>caption.authorId===user.id)
  return <main id="main-content" className="shell page-shell">
    <section className="page-heading feed-heading"><div><p className="eyebrow">YOUR CREATIVE CORNER</p><h1>My <span>posts.</span></h1><p className="lede">Every punchline you made, across every picture.</p></div><Link href="/create" className="btn btn-primary">Create another post ↗</Link></section>
    {error ? <div className="empty-state" role="alert"><h2>Your posts couldn&apos;t load.</h2><RetryButton /></div> : <CaptionGallery initialCaptions={mine} userId={user.id} />}
    <footer className="page-footer">Made by you. Rated by the community.<span>Pick your favorites and take them with you.</span></footer>
  </main>
}
