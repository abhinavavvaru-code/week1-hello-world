import { createClient } from '@/lib/supabase/server'
import JokesTable, { type Joke } from '@/components/JokesTable'

export const dynamic = 'force-dynamic'

type Row = {
  id: number
  content: string
  votes: { user_id: string; value: number }[] | null
}

export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('messages')
    .select('id, content, votes(user_id, value)')

  const rows = (data ?? []) as unknown as Row[]

  const jokes: Joke[] = rows
    .map((row) => {
      const votes = row.votes ?? []
      return {
        id: row.id,
        content: row.content,
        laughs: votes.filter((v) => v.value === 1).length,
        groans: votes.filter((v) => v.value === -1).length,
        myVote: votes.find((v) => v.user_id === user?.id)?.value ?? 0,
      }
    })
    .sort((a, b) => b.laughs - b.groans - (a.laughs - a.groans) || a.id - b.id)

  const top = jokes[0]

  return (
    <main className="shell">
      <h1 className="sr-only">Jokes</h1>

      {top && (
        <section className="headliner" aria-label="Top joke">
          <p className="headliner-label">Top joke right now</p>
          <p className="headliner-joke">{top.content}</p>
          <p className="headliner-score">
            {plural(top.laughs, 'laugh')}, {plural(top.groans, 'groan')}
          </p>
        </section>
      )}

      <section aria-labelledby="all-jokes">
        <div className="section-head">
          <h2 id="all-jokes">All jokes</h2>
          <p className="hint">
            Ranked by laughs minus groans.{' '}
            {user ? 'Click a vote again to take it back.' : 'Sign in to vote.'}
          </p>
        </div>

        {error ? (
          <p className="status status-error">Couldn&apos;t load jokes: {error.message}</p>
        ) : (
          <JokesTable initialJokes={jokes} userId={user?.id ?? null} />
        )}
      </section>
    </main>
  )
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
