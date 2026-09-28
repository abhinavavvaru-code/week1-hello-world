import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type VoteRow = {
  value: number
  messages: { id: number; content: string } | null
}

export default async function Dashboard() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, last_name')
    .eq('id', user.id)
    .single()

  // New users without a name get sent to finish their profile first
  if (!profile?.first_name || !profile?.last_name) redirect('/profile')

  const { data } = await supabase
    .from('votes')
    .select('value, messages(id, content)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  const votes = (data ?? []) as unknown as VoteRow[]
  const laughed = votes.filter((v) => v.value === 1)
  const groaned = votes.filter((v) => v.value === -1)

  return (
    <main className="shell">
      <h1 className="page-title">Hey, {profile.first_name}.</h1>
      <p className="lede">
        You&apos;ve laughed at {laughed.length} and groaned at {groaned.length}. Only you
        can see this page.
      </p>

      <div className="split">
        <VoteList
          title="Made you laugh"
          rows={laughed}
          empty={
            <>
              Nothing yet. <Link href="/">Find something funny</Link>.
            </>
          }
        />
        <VoteList title="Made you groan" rows={groaned} empty="No groans yet." />
      </div>
    </main>
  )
}

function VoteList({
  title,
  rows,
  empty,
}: {
  title: string
  rows: VoteRow[]
  empty: React.ReactNode
}) {
  return (
    <section className="panel">
      <h2 className="panel-title">{title}</h2>
      {rows.length === 0 ? (
        <p className="hint">{empty}</p>
      ) : (
        <ul className="vote-list">
          {rows.map((row) =>
            row.messages ? <li key={row.messages.id}>{row.messages.content}</li> : null
          )}
        </ul>
      )}
    </section>
  )
}
