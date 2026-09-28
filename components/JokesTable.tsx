'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export type Joke = {
  id: number
  content: string
  laughs: number
  groans: number
  myVote: number // 1 = laughed, -1 = groaned, 0 = no vote
}

export default function JokesTable({
  initialJokes,
  userId,
}: {
  initialJokes: Joke[]
  userId: string | null
}) {
  const [jokes, setJokes] = useState(initialJokes)
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [bumpedId, setBumpedId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const router = useRouter()

  const vote = async (joke: Joke, value: 1 | -1) => {
    if (!userId) {
      router.push('/login')
      return
    }

    // Clicking the same button again takes the vote back
    const next = joke.myVote === value ? 0 : value

    // Update the UI right away, then save
    setJokes((all) => all.map((j) => (j.id === joke.id ? applyVote(j, next) : j)))
    setBumpedId(joke.id)
    setPendingId(joke.id)
    setError('')

    const supabase = createClient()
    const { error } =
      next === 0
        ? await supabase
            .from('votes')
            .delete()
            .eq('user_id', userId)
            .eq('message_id', joke.id)
        : await supabase
            .from('votes')
            .upsert(
              { user_id: userId, message_id: joke.id, value: next },
              { onConflict: 'user_id,message_id' }
            )

    if (error) {
      setJokes((all) => all.map((j) => (j.id === joke.id ? joke : j)))
      setError(`Your vote didn't save: ${error.message}`)
    }
    setPendingId(null)
  }

  if (jokes.length === 0) {
    return <div className="table-wrap empty">No jokes yet.</div>
  }

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col" className="col-rank">Rank</th>
              <th scope="col">Joke</th>
              <th scope="col" className="col-score">Score</th>
              <th scope="col" className="col-vote">
                <span className="sr-only">Vote</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {jokes.map((joke, i) => {
              const score = joke.laughs - joke.groans
              const bump = bumpedId === joke.id ? 'bump' : undefined

              return (
                <tr key={joke.id}>
                  <td className="col-rank">{i + 1}</td>
                  <td className="col-joke">{joke.content}</td>
                  <td className={score < 0 ? 'col-score negative' : 'col-score'}>
                    <span key={score} className={bump}>
                      {score > 0 ? `+${score}` : score}
                    </span>
                  </td>
                  <td className="col-vote">
                    <div className="vote-group">
                      <button
                        type="button"
                        className="vote vote-laugh"
                        aria-pressed={joke.myVote === 1}
                        disabled={pendingId === joke.id}
                        onClick={() => vote(joke, 1)}
                      >
                        Laugh <span>{joke.laughs}</span>
                      </button>
                      <button
                        type="button"
                        className="vote vote-groan"
                        aria-pressed={joke.myVote === -1}
                        disabled={pendingId === joke.id}
                        onClick={() => vote(joke, -1)}
                      >
                        Groan <span>{joke.groans}</span>
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {error && (
        <p className="status status-error" role="alert" style={{ marginTop: '1rem' }}>
          {error}
        </p>
      )}
    </>
  )
}

function applyVote(joke: Joke, next: number): Joke {
  let { laughs, groans } = joke
  if (joke.myVote === 1) laughs -= 1
  if (joke.myVote === -1) groans -= 1
  if (next === 1) laughs += 1
  if (next === -1) groans += 1
  return { ...joke, laughs, groans, myVote: next }
}
