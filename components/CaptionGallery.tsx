'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { captionFlavor, captionVisual, type Caption } from '@/lib/captions'
import { CAPTION_STYLES, CAPTION_TOPICS, topicLabels, type CaptionTopic } from '@/lib/generation-options'
import { filterCaptions, type GalleryFilter } from '@/lib/gallery-filter'
import { downloadMeme, downloadText } from '@/lib/caption-export'

const signInHref = '/login?next=%2Fexplore'

export default function CaptionGallery({ initialCaptions, mode = 'browse', newCaptionIds = [], userId = '', initialAuthor = '', initialCaptionId = '' }: {
  initialCaptions: Caption[]
  mode?: 'browse' | 'history'
  newCaptionIds?: string[]
  userId?: string
  initialAuthor?: string
  initialCaptionId?: string
}) {
  const [captions, setCaptions] = useState(initialCaptions)
  const [serverCaptions, setServerCaptions] = useState(initialCaptions)
  const [expectedVotes, setExpectedVotes] = useState<Record<string, number>>({})
  const [filter, setFilter] = useState<GalleryFilter>(newCaptionIds.length && !initialCaptionId ? 'new' : 'all')
  const [sort, setSort] = useState('latest')
  const [query, setQuery] = useState('')
  const [topic, setTopic] = useState('')
  const [style, setStyle] = useState('')
  const [author, setAuthor] = useState(initialAuthor)
  const [selecting, setSelecting] = useState(false)
  const [view, setView] = useState<'grid' | 'focus'>('grid')
  const [focus, setFocus] = useState(0)
  const [showHelp, setShowHelp] = useState(true)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const focusIndex = [...initialCaptions].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .findIndex((caption) => caption.id === initialCaptionId)
  const [limit, setLimit] = useState(Math.max(12, Math.ceil((focusIndex + 1) / 12) * 12))
  const [notice, setNotice] = useState('')
  const [exporting, setExporting] = useState<string | null>(null)
  const exportLock = useRef(false)
  const [pendingIds, setPendingIds] = useState<string[]>([])
  const pending = useRef(new Set<string>())
  const [error, setError] = useState('')
  const [signInCaptionId, setSignInCaptionId] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [voteToast, setVoteToast] = useState<{ id: string; value: number } | null>(null)
  const router = useRouter()

  useEffect(() => {
    if (!voteToast) return
    const timer = setTimeout(() => setVoteToast(null), 1500)
    return () => clearTimeout(timer)
  }, [voteToast])

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
      return { ...applyVote(fresh, expected), votedAt: captions.find((item) => item.id === fresh.id)?.votedAt ?? fresh.votedAt }
    }))
    setExpectedVotes(waiting)
  }

  const history = mode === 'history'
  const signedIn = Boolean(userId)
  const myVotes = captions.filter((caption) => caption.myVote !== 0)
  const unratedCount = captions.filter((caption) => caption.myVote === 0).length
  const visible = filterCaptions(captions, { filter, sort, query, topic, style, author, userId, newCaptionIds, history })
  const authors = [...new Map(captions.map((caption) => [caption.authorKey || caption.authorId, {
    name: caption.authorName || 'Member', mine: signedIn && caption.authorId === userId,
  }])).entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))
  const flavors = [...new Set([...CAPTION_STYLES, ...captions.map((caption) => caption.style)])]
  const flavorCounts = new Map(flavors.map((flavor) => [flavor, captions.filter((caption) => caption.style === flavor).length]))
  const selectedCaptions = captions.filter((caption) => selectedIds.includes(caption.id))
  const focusedIndex = Math.min(focus, Math.max(0, visible.length - 1))
  const displayed = view === 'focus' ? visible.slice(focusedIndex, focusedIndex + 1) : visible.slice(0, limit)

  function resetFilters() {
    setFilter('all'); setQuery(''); setTopic(''); setStyle(''); setAuthor(''); setLimit(12)
  }

  async function exportMeme(caption: Caption) {
    if (exportLock.current) return
    exportLock.current = true
    setExporting(caption.id); setError('')
    try { await downloadMeme(caption); setNotice('Meme downloaded. Ready for the group chat.') }
    catch { setError('The meme could not download. Please try again.') }
    finally { exportLock.current = false; setExporting(null) }
  }

  async function copySelected() {
    setError('')
    try {
      await navigator.clipboard.writeText(selectedCaptions.map((caption) => caption.content).join('\n'))
      setNotice(`${selectedCaptions.length} captions copied.`)
    } catch { setError('Copy is unavailable. Download your selected captions instead.') }
  }

  async function vote(caption: Caption, direction: 1 | -1) {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(`/explore?caption=${caption.id}#caption-${caption.id}`)}`)
      return
    }
    if (pending.current.has(caption.id)) return
    const value = caption.myVote === direction ? 0 : direction
    pending.current.add(caption.id)
    setPendingIds((ids) => [...ids, caption.id])
    const previousExpected = expectedVotes[caption.id]
    setExpectedVotes((all) => ({ ...all, [caption.id]: value }))
    setCaptions((all) => all.map((item) => item.id === caption.id ? applyVote(item, value) : item))
    setError(''); setSignInCaptionId(null)
    let sessionExpired = false
    try {
      const response = await fetch('/api/votes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captionId: caption.id, value }),
      })
      sessionExpired = response.status === 401
      const saved = await response.json()
      if (!response.ok || ![0, 1, -1].includes(saved.value)) throw new Error('Vote failed')
      setExpectedVotes((all) => ({ ...all, [caption.id]: saved.value }))
      setCaptions((all) => all.map((item) => item.id === caption.id
        ? { ...applyVote(item, saved.value),
          ...(Number.isInteger(saved.laughs) && Number.isInteger(saved.groans) ? { laughs: saved.laughs, groans: saved.groans } : {}),
          votedAt: saved.value === 0 ? null : saved.updated_at || saved.created_at } : item))
      setVoteToast({ id: caption.id, value: saved.value })
    } catch {
      setCaptions((all) => all.map((item) => item.id === caption.id
        ? {
          ...applyVote(item, caption.myVote), votedAt: caption.votedAt,
          weekUpvotes: Math.max(0, item.weekUpvotes - Number(item.myVote === 1 && inCurrentPeriod(item.votedAt, 'week')) + Number(caption.myVote === 1 && inCurrentPeriod(caption.votedAt, 'week'))),
          monthUpvotes: Math.max(0, item.monthUpvotes - Number(item.myVote === 1 && inCurrentPeriod(item.votedAt, 'month')) + Number(caption.myVote === 1 && inCurrentPeriod(caption.votedAt, 'month'))),
        } : item))
      setExpectedVotes((all) => {
        const previous = { ...all }
        if (previousExpected === undefined) delete previous[caption.id]
        else previous[caption.id] = previousExpected
        return previous
      })
      if (sessionExpired) setSignInCaptionId(caption.id)
      else setError('Your vote didn’t save. Please try again.')
    } finally {
      pending.current.delete(caption.id)
      setPendingIds((ids) => ids.filter((id) => id !== caption.id))
      if (pending.current.size === 0) router.refresh()
    }
  }

  function keyboardVote(event: KeyboardEvent<HTMLElement>) {
    if (view !== 'focus' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, button, a, summary')) return
    const caption = visible[focusedIndex]
    if (!caption) return
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      void vote(caption, event.key === 'ArrowUp' ? 1 : -1)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      setFocus(Math.max(0, Math.min(visible.length - 1, focusedIndex + (event.key === 'ArrowRight' ? 1 : -1))))
    }
  }

  async function copyCaption(caption: Caption) {
    setError('')
    try { await navigator.clipboard.writeText(caption.content); setCopied(caption.id) }
    catch { setError('Copy isn’t available here. Select the caption text to copy it.') }
  }

  const tabs: [GalleryFilter, string][] = history
    ? [['all', 'All votes'], ['up', 'Upvoted'], ['down', 'Downvoted']]
    : [...(newCaptionIds.length ? [['new', 'Your new captions'] as [GalleryFilter, string]] : []), ['all', 'Community'],
      ...(signedIn ? [['unrated', `Not yet rated by you (${unratedCount})`], ['mine', 'Mine']] as [GalleryFilter, string][] : [])]

  return (
    <section className={`explore-gallery ${view === 'focus' ? 'gallery-focus' : ''}`} aria-label={history ? 'Your caption votes' : 'Caption collection'}>
      {showHelp && <aside className="gallery-help" aria-label="Voting tips">
        <p>{signedIn ? 'Click an arrow to vote. Click it again to undo, or choose the other arrow to switch.' : 'Browse freely. Sign in to upvote, downvote, or create your own captions.'}</p>
        <button type="button" onClick={() => setShowHelp(false)} aria-label="Close voting tips">Close <span aria-hidden="true">×</span></button>
      </aside>}
      {history && <div className="vote-stats">
        <div><span className="stat-number">{myVotes.length}</span><span className="stat-label">Total votes</span></div>
        <div><span className="stat-number accent">{myVotes.filter((caption) => caption.myVote === 1).length}</span><span className="stat-label">Made you laugh</span></div>
        <div><span className="stat-number">{myVotes.filter((caption) => caption.myVote === -1).length}</span><span className="stat-label">Not your thing</span></div>
      </div>}
      <div className="collection-toolbar">
        <label className="collection-show"><span className="sr-only">Show captions</span><select value={filter}
          onChange={(event) => { setFilter(event.target.value as GalleryFilter); setFocus(0); setLimit(12) }}>
          {tabs.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="sort-control"><span className="sr-only">Sort captions</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="latest">{history ? 'Recently rated' : 'Latest first'}</option>
            <option value="week">Most upvoted this week</option><option value="month">Most upvoted this month</option><option value="top">Most upvoted all time</option>
          </select>
        </label>
        <div className="gallery-view-options" aria-label="Gallery layout">
          <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>Gallery</button>
          <button type="button" aria-pressed={view === 'focus'} onClick={() => { setView('focus'); setFocus(0) }}>One at a time</button>
        </div>
      </div>
      <div className="gallery-primary-filters">
        <label className="gallery-search"><span>Search the gallery</span><input type="search" value={query} placeholder="Find a caption, creator, or theme…"
          onChange={(event) => { setQuery(event.target.value); setLimit(12) }} /></label>
        <label className="gallery-flavor"><span>Humor flavor</span><select value={style} onChange={(event) => { setStyle(event.target.value); setLimit(12) }}>
          <option value="">All humor flavors</option>{flavors.map((flavor) => <option key={flavor} value={flavor} disabled={!flavorCounts.get(flavor)}>
            {captionFlavor(flavor)} ({flavorCounts.get(flavor) || 0})
          </option>)}
        </select></label>
        <details className="gallery-advanced"><summary>More filters{topic || author ? ' · active' : ''}</summary>
          <div className="gallery-advanced-fields">
            <label><span>Theme</span><select value={topic} onChange={(event) => { setTopic(event.target.value); setLimit(12) }}>
              <option value="">Every theme</option>{CAPTION_TOPICS.map((item) => <option key={item} value={item}>{topicLabels[item]}</option>)}
            </select></label>
            <label><span>Creator</span><select value={author} onChange={(event) => { setAuthor(event.target.value); setLimit(12) }}>
              <option value="">Everyone</option>{authors.map(([key, creator]) => <option key={key} value={key}>{creator.name}{creator.mine ? ' (you)' : ''}</option>)}
            </select></label>
          </div>
        </details>
      </div>
      <div className="gallery-context">
        <p aria-live="polite">{visible.length} {history ? 'votes' : 'captions'}{!signedIn && <> · <Link href={signInHref}>Sign in to rate or create</Link></>}</p>
        {(query || topic || style || author) && <button type="button" className="clear-filters" onClick={resetFilters}>Clear filters</button>}
        <details className="gallery-tools"><summary>Save &amp; share</summary><button type="button" onClick={() => setSelecting(!selecting)}>{selecting ? 'Stop selecting' : 'Select multiple captions'}</button></details>
      </div>
      {selectedCaptions.length > 0 && <div className="selection-toolbar"><strong>{selectedCaptions.length} selected</strong>
        <button type="button" className="btn btn-ghost" onClick={copySelected}>Copy selected</button>
        <button type="button" className="btn btn-ghost" onClick={() => { downloadText(selectedCaptions); setNotice('Selected captions downloaded.') }}>Download text</button>
        <button type="button" className="text-link" onClick={() => setSelectedIds([])}>Clear selection</button>
      </div>}
      {sort === 'week' || sort === 'month' ? <p className="ranking-note">Upvotes cast this {sort === 'week' ? 'week (Monday–Sunday)' : 'calendar month'}, in New York time. Card scores show all-time totals.</p> : null}
      {signInCaptionId && <p className="gallery-auth-prompt" role="status"><Link className="btn btn-primary btn-sm" href={`/login?next=${encodeURIComponent(`/explore?caption=${signInCaptionId}#caption-${signInCaptionId}`)}`}>Sign in to vote</Link><span>Browse as much as you like. Sign in to save your verdict.</span></p>}
      {notice && <p className="status" role="status">{notice}</p>}
      {error && <p className="status status-error" role="alert">{error}</p>}
      {voteToast && <p className="vote-toast" role="status">{voteToast.value === 0 ? 'Vote removed' : voteToast.value === 1 ? 'Upvote saved' : 'Downvote saved'} <span aria-hidden="true">✓</span></p>}
      {visible.length === 0 ? <div className="empty-state">
        <span className="empty-face" aria-hidden="true">☺</span>
        <h2>{history && myVotes.length === 0 ? 'Your first laugh is waiting.' : filter === 'unrated' ? 'You’ve rated them all.' : 'No captions match just yet.'}</h2>
        <p>{captions.length === 0 ? 'Fresh punchlines will appear here as the community creates them.' : 'Try another humor flavor or clear your filters to see the whole gallery.'}</p>
        {query || topic || style || author || filter !== 'all' ? <button type="button" className="btn btn-primary" onClick={resetFilters}>View all captions</button>
          : <Link className="btn btn-primary" href="/create">Create the first captions <span aria-hidden="true">↗</span></Link>}
      </div> : <div className="caption-grid" onKeyDown={keyboardVote}>
        {displayed.map((caption, index) => {
          const visual = captionVisual(caption)
          const busy = pendingIds.includes(caption.id)
          const rated = signedIn && caption.myVote !== 0
          const creatorKey = caption.authorKey || caption.authorId
          return <article key={caption.id} className="caption-card" aria-labelledby={`caption-${caption.id}`} tabIndex={view === 'focus' ? 0 : undefined}>
            <div className="caption-image">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={visual.src || '/captions/earth.svg'} alt={visual.alt} width="720" height="480" loading={index < 3 ? 'eager' : 'lazy'} />
              {selecting && <label className="caption-select"><input type="checkbox" checked={selectedIds.includes(caption.id)} aria-label={`Select caption: ${caption.content}`}
                onChange={(event) => setSelectedIds((all) => event.target.checked ? [...new Set([...all, caption.id])] : all.filter((id) => id !== caption.id))} /><span>Select</span></label>}
            </div>
            <div className="caption-body">
              <h2 id={`caption-${caption.id}`} className="caption-text">{caption.content}</h2>
              <p className="caption-author">By <button type="button" onClick={() => { setAuthor(creatorKey); setFilter('all'); setLimit(12) }}>{caption.authorName || 'Member'}{signedIn && caption.authorId === userId ? ' · you' : ''}</button>
                <span>{topicLabels[caption.topic as CaptionTopic] || visual.category} · {captionFlavor(caption.style)}</span></p>
              <div className="caption-actions">
                <div className="vote-group">
                  <span className="vote-control"><button className="vote-button" type="button" aria-label={`Upvote: ${caption.content}`} title={!signedIn ? 'Sign in to vote' : busy ? 'Saving your vote' : caption.myVote === 1 ? 'Click to undo your upvote' : 'Upvote'}
                    aria-pressed={caption.myVote === 1} aria-busy={busy} disabled={busy} onClick={() => vote(caption, 1)}><ArrowIcon /><strong>{caption.laughs}</strong></button>
                    {!signedIn && <span className="vote-signin-hint" aria-hidden="true">Sign in to vote ↗</span>}</span>
                  <span className="vote-control"><button className="vote-button vote-down" type="button" aria-label={`Downvote: ${caption.content}`} title={!signedIn ? 'Sign in to vote' : busy ? 'Saving your vote' : caption.myVote === -1 ? 'Click to undo your downvote' : 'Downvote'}
                    aria-pressed={caption.myVote === -1} aria-busy={busy} disabled={busy} onClick={() => vote(caption, -1)}><ArrowIcon /><strong>{caption.groans}</strong></button>
                    {!signedIn && <span className="vote-signin-hint" aria-hidden="true">Sign in to vote ↗</span>}</span>
                </div>
                <span className="caption-score" title="All-time upvotes minus downvotes">Score <strong>{caption.laughs - caption.groans > 0 ? '+' : ''}{caption.laughs - caption.groans}</strong></span>
                <span className="sr-only">{busy ? 'Saving your vote' : rated ? `Your ${caption.myVote === 1 ? 'upvote' : 'downvote'} is saved` : ''}</span>
                <details className="caption-tools"><summary aria-label={`Save or share: ${caption.content}`} title="Save or share caption">•••</summary>
                  <div><button type="button" onClick={() => copyCaption(caption)} aria-label={`Copy caption: ${caption.content}`}>{copied === caption.id ? 'Copied ✓' : 'Copy caption'}</button>
                    <button type="button" disabled={exporting !== null} onClick={() => exportMeme(caption)}>{exporting === caption.id ? 'Creating…' : 'Download meme ↗'}</button></div>
                </details>
              </div>
            </div>
          </article>
        })}
      </div>}
      {view === 'focus' && visible.length > 0 && <nav className="focus-pagination" aria-label="Caption navigation">
        <button type="button" className="btn btn-ghost" disabled={focusedIndex === 0} onClick={() => setFocus(focusedIndex - 1)}>← Previous</button>
        <span>{focusedIndex + 1} of {visible.length}<small>Focus the card: ↑ / ↓ vote · ← / → browse</small></span>
        <button type="button" className="btn btn-ghost" disabled={focusedIndex === visible.length - 1} onClick={() => setFocus(focusedIndex + 1)}>Next →</button>
      </nav>}
      {view === 'grid' && visible.length > limit && <div className="gallery-more"><button type="button" className="btn btn-ghost" onClick={() => setLimit((all) => all + 12)}>Load more captions ({visible.length - limit} remaining)</button></div>}
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
    weekUpvotes: Math.max(0, caption.weekUpvotes - Number(caption.myVote === 1 && inCurrentPeriod(caption.votedAt, 'week')) + Number(next === 1)),
    monthUpvotes: Math.max(0, caption.monthUpvotes - Number(caption.myVote === 1 && inCurrentPeriod(caption.votedAt, 'month')) + Number(next === 1)),
    myVote: next,
    votedAt: next ? new Date().toISOString() : null,
  }
}

function inCurrentPeriod(timestamp: string | null, period: 'week' | 'month') {
  if (!timestamp) return false
  const dateKey = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  const today = dateKey(new Date())
  const voted = dateKey(new Date(timestamp))
  if (period === 'month') return voted.slice(0, 7) === today.slice(0, 7)
  const start = new Date(`${today}T12:00:00Z`)
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7))
  return voted >= start.toISOString().slice(0, 10) && voted <= today
}
