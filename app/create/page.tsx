import Link from 'next/link'
import type { Metadata } from 'next'
import { requireUser } from '@/lib/auth'
import CaptionLab from '@/components/CaptionLab'
import { CAPTION_TOPICS, type CaptionTopic } from '@/lib/generation-options'
import './create.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Caption Lab · Punchline',
  description: 'Create AI captions for a picture and let the community find the funny.',
}

const briefs = [
  'The dorm group chat tries to agree on one plan for the weekend.',
  'A student goes to the library to study and somehow opens twenty unrelated tabs.',
  'Someone discovers that a quick coffee run in New York is its own side quest.',
  'A roommate says they will be ready in five minutes. It has been twenty.',
  'A student checks their budget after a very ambitious weekend in the city.',
  'The group finally goes outside after a week of living between the dorms and the library.',
  'A student plans an early night, then remembers the internet exists.',
]

export default async function CreatePage({ searchParams }: {
  searchParams: Promise<{ topic?: string | string[] }>
}) {
  const { supabase } = await requireUser()
  const { data: allowance } = await supabase.rpc('get_generation_allowance')
  const { data: activeImages } = await supabase.from('caption_images').select('id')
    .eq('is_active', true).is('archived_at', null).is('owner_id', null)
  const { topic } = await searchParams
  const initialTopic = typeof topic === 'string' && CAPTION_TOPICS.includes(topic as CaptionTopic) ? topic as CaptionTopic : 'campus'
  const today = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date())
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(today)
  return (
    <main id="main-content" className="shell page-shell create-page">
      <section className="page-heading lab-heading">
        <div>
          <p className="eyebrow"><span className="live-dot" /> CAPTION LAB</p>
          <h1>Make something <span>funny.</span></h1>
          <p className="lede">Your photo. Your angle. Three short AI punchlines.</p>
        </div>
        <Link className="text-link" href="/">Explore captions <span aria-hidden="true">↗</span></Link>
      </section>
      <CaptionLab key={initialTopic} dailyBrief={briefs[Math.max(0, day)]} initialTopic={initialTopic} availableImageIds={(activeImages ?? []).map((image) => image.id)} initialRemaining={typeof allowance === 'number' ? allowance : null} />
      <footer className="page-footer">A little campus life. A little internet brain.<span>Made for the Humor Project.</span></footer>
    </main>
  )
}
