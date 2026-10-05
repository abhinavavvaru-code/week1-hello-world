'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { captionVisual, type Caption } from '@/lib/captions'

type Filter = 'all' | 'unrated' | 'up' | 'down' | 'new'

export default function CaptionGallery({ initialCaptions, mode = 'browse', newCaptionIds = [] }: {
  initialCaptions: Caption[]
  mode?: 'browse' | 'history'
  newCaptionIds?: string[]
}) {
  const [captions, setCaptions] = useState(initialCaptions)
  const [serverCaptions, setServerCaptions] = useState(initialCaptions)
  const [expectedVotes, setExpectedVotes] = useState<Record<string, number>>({})
  const [filter, setFilter] = useState<Filter>(newCaptionIds.length ? 'new' : 'all')
  const [sort, setSort] = useState('latest')
  const [pendingIds, setPendingIds] = useState<string[]>([])
  const pending = useRef(new Set<string>())
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const router = useRouter()
  if (serverCaptions !== initialCaptions) {
    setServerCaptions(initialCaptions)
    const waiting = { ...expectedVotes }
    setCaptions(initialCaptions.map((fresh) => {
      const expected = waiting[fresh.id]
      if (expected === undefined) return fresh
      if (fresh.myVote === expected && !pendingIds.includes(fresh.id)) {
        delete waiting[fresh.id]
        return fresh
      }
      // An older refresh must not erase a vote that just finished saving.
      return { ...applyVote(fresh, expected), votedAt: expected === 0 ? null : captions.find((item) => item.id === fresh.id)?.votedAt ?? fresh.votedAt }
    }))
    setExpectedVotes(waiting)
  }
  const history = mode === 'history'
  const myVotes = captions.filter((caption) => caption.myVote !== 0)
  const source = history ? myVotes : captions
  const visible = source.filter((caption) => filter === 'all'
    || (filter === 'unrated' && caption.myVote === 0)
    || (filter === 'new' && newCaptionIds.includes(caption.id))
    || (filter === 'up' && caption.myVote === 1)
    || (filter === 'down' && caption.myVote === -1))
    .sort((a, b) => sort === 'top'
      ? (b.laughs - b.groans) - (a.laughs - a.groans) || b.id.localeCompare(a.id)
      : history ? (b.votedAt ?? '').localeCompare(a.votedAt ?? '') || b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))

  async function vote(caption: Caption, value: 1 | -1) {
    if (pending.current.has(caption.id) || caption.myVote !== 0) return
    pending.current.add(caption.id)
    setPendingIds((ids) => [...ids, caption.id])
    const next = value
    const previousExpected = expectedVotes[caption.id]
    setExpectedVotes((all) => ({ ...all, [caption.id]: next }))
    setCaptions((all) => all.map((item) => item.id === caption.id ? applyVote(item, next) : item))
    setError('')
    try {
      const response = await fetch('/api/votes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captionId: caption.id, value }),
      })
      const saved = await response.json()
      if (!response.ok || (saved.value !== 1 && saved.value !== -1)) throw new Error('Vote failed')
      setExpectedVotes((all) => ({ ...all, [caption.id]: saved.value }))
      setCaptions((all) => all.map((item) => item.id === caption.id
        ? { ...applyVote(item, saved.value), votedAt: saved.created_at } : item))
    } catch {
      setCaptions((all) => all.map((item) => item.id === caption.id ? caption : item))
      setExpectedVotes((all) => {
        const previous = { ...all }
        if (previousExpected === undefined) delete previous[caption.id]
        else previous[caption.id] = previousExpected
        return previous
      })
      setError('Your vote didn’t save. Please try again. If your session expired, sign in again.')
    } finally {
      pending.current.delete(caption.id)
      setPendingIds((ids) => ids.filter((id) => id !== caption.id))
      if (pending.current.size === 0) router.refresh()
    }
  }

  async function copyCaption(caption: Caption) {
    try {
      await navigator.clipboard.writeText(caption.content)
      setCopied(caption.id)
    } catch {
      setError('Copy isn’t available here. You can select the caption text to copy it.')
    }
  }

  return (
    <section aria-label={history ? 'Your caption votes' : 'Caption collection'}>
      {history && (
        <div className="vote-stats">
          <div><span className="stat-number">{myVotes.length}</span><span className="stat-label">Total votes</span></div>
          <div><span className="stat-number accent">{myVotes.filter((caption) => caption.myVote === 1).length}</span><span className="stat-label">Made you laugh</span></div>
          <div><span className="stat-number">{myVotes.filter((caption) => caption.myVote === -1).length}</span><span className="stat-label">Not your thing</span></div>
        </div>
      )}
      <div className="collection-toolbar">
        <div className="filter-group" aria-label="Filter captions">
          {(history ? [['all', 'All votes'], ['up', 'Upvoted'], ['down', 'Downvoted']] : [...(newCaptionIds.length ? [['new', 'Your new captions']] : []), ['all', 'All captions'], ['unrated', 'Not rated']]).map(([value, label]) => (
            <button key={value} type="button" className="filter-button" aria-pressed={filter === value} onClick={() => setFilter(value as Filter)}>{label}</button>
          ))}
        </div>
        <div className="collection-meta">
          <span aria-live="polite">{visible.length} {history ? 'votes' : 'captions'}</span>
          <label className="sort-control"><span className="sr-only">Sort captions</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="latest">{history ? 'Recently rated' : 'Latest first'}</option>
              <option value="top">Top rated</option>
            </select>
          </label>
        </div>
      </div>
      <p className="collection-help">{history ? 'Your saved verdicts. One rating per caption keeps the scores fair.' : 'Upvote if it lands. Downvote if it doesn’t. One verdict per caption.'}</p>
      {error && <p className="status status-error" role="alert">{error} <Link href="/login">Sign in</Link></p>}
      {visible.length === 0 ? (
        <div className="empty-state">
          <span className="empty-face" aria-hidden="true">☺</span>
          <h2>{history && myVotes.length === 0 ? 'Your first laugh is waiting.' : filter === 'unrated' ? 'You’ve seen them all.' : 'Nothing here just yet.'}</h2>
          <p>{history && myVotes.length === 0 ? 'Explore the captions and give a few your verdict. They’ll show up here.' : captions.length === 0 ? 'Pick an illustration, add your scene, and let AI write three punchlines.' : 'Try another filter or make something new in the caption lab.'}</p>
          {history ? <Link className="btn btn-primary" href="/">Explore captions <span aria-hidden="true">↗</span></Link> : filter !== 'all' ? <button className="btn btn-primary" onClick={() => setFilter('all')}>View all captions</button> : <Link className="btn btn-primary" href="/create">Create the first captions <span aria-hidden="true">↗</span></Link>}
        </div>
      ) : (
        <div className="caption-grid">
          {visible.map((caption, index) => {
            const visual = captionVisual(caption)
            const busy = pendingIds.includes(caption.id)
            return (
              <article key={caption.id} className="caption-card" aria-labelledby={`caption-${caption.id}`}>
                <div className="caption-image">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={visual.src || '/captions/earth.svg'} alt={visual.alt} width="720" height="480" loading={index < 3 ? 'eager' : 'lazy'} />
                  <span className="image-index">AI caption</span>
                </div>
                <div className="caption-body">
                  <div className="caption-meta">
                    <p className="caption-category">{visual.category} · {caption.style}</p>
                    <button type="button" className="caption-copy" onClick={() => copyCaption(caption)} aria-label={`Copy caption: ${caption.content}`} aria-live="polite">{copied === caption.id ? 'Copied ✓' : 'Copy'}</button>
                  </div>
                  <h2 id={`caption-${caption.id}`} className="caption-text">{caption.content}</h2>
                  <div className="caption-actions">
                    <div className="vote-group">
                      <button className="vote-button" type="button" aria-label={`Upvote: ${caption.content}`} aria-pressed={caption.myVote === 1} disabled={busy || caption.myVote !== 0} onClick={() => vote(caption, 1)}>
                        <ArrowIcon /><span>{caption.laughs}</span>
                      </button>
                      <button className="vote-button vote-down" type="button" aria-label={`Downvote: ${caption.content}`} aria-pressed={caption.myVote === -1} disabled={busy || caption.myVote !== 0} onClick={() => vote(caption, -1)}>
                        <ArrowIcon /><span>{caption.groans}</span>
                      </button>
                    </div>
                    <span className={`vote-note${caption.myVote ? ' voted' : ''}`} aria-live="polite">{busy ? 'Saving…' : caption.myVote === 1 ? 'Upvote saved' : caption.myVote === -1 ? 'Downvote saved' : 'Your verdict?'}</span>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ArrowIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 12 6-6 6 6M12 6v13" /></svg>
}

function applyVote(caption: Caption, next: number): Caption {
  return {
    ...caption,
    laughs: caption.laughs - Number(caption.myVote === 1) + Number(next === 1),
    groans: caption.groans - Number(caption.myVote === -1) + Number(next === -1),
    myVote: next,
    votedAt: next ? caption.votedAt ?? new Date().toISOString() : null,
  }
}
