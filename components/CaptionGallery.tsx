'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { captionVisual, type Caption } from '@/lib/captions'

import { CAPTION_STYLES, CAPTION_TOPICS, topicLabels, type CaptionTopic } from '@/lib/generation-options'
import { filterCaptions, type GalleryFilter } from '@/lib/gallery-filter'
import { downloadMeme, downloadText } from '@/lib/caption-export'
type Filter = GalleryFilter

export default function CaptionGallery({ initialCaptions, mode = 'browse', newCaptionIds = [], userId = '', initialAuthor = '' }: {
  initialCaptions: Caption[]
  mode?: 'browse' | 'history'
  newCaptionIds?: string[]
  userId?: string
  initialAuthor?: string
}) {
  const [captions, setCaptions] = useState(initialCaptions)
  const [serverCaptions, setServerCaptions] = useState(initialCaptions)
  const [expectedVotes, setExpectedVotes] = useState<Record<string, number>>({})
  const [filter, setFilter] = useState<Filter>(newCaptionIds.length ? 'new' : 'all')
  const [sort, setSort] = useState('latest')
  const [query, setQuery] = useState('')
  const [topic, setTopic] = useState('')
  const [style, setStyle] = useState('')
  const [author, setAuthor] = useState(initialAuthor)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [limit, setLimit] = useState(12)
  const [notice, setNotice] = useState('')
  const [exporting, setExporting] = useState<string | null>(null)
  const exportLock=useRef(false)
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
  const visible = filterCaptions(captions,{filter,sort,query,topic,style,author,userId,newCaptionIds,history})
  const authors = [...new Map(captions.map((caption)=>[caption.authorId,caption.authorName])).entries()].sort((a,b)=>a[1].localeCompare(b[1]))
  const selectedCaptions=captions.filter((caption)=>selectedIds.includes(caption.id))
  function resetFilters() {setFilter('all');setQuery('');setTopic('');setStyle('');setAuthor('');setLimit(12)}
  async function exportMeme(caption: Caption) {
    if (exportLock.current) return
    exportLock.current=true
    setExporting(caption.id);setError('')
    try {await downloadMeme(caption);setNotice('Meme downloaded. Ready for the group chat.')}
    catch {setError('The meme could not download. Reload the gallery and try again.')}
    finally {exportLock.current=false;setExporting(null)}
  }
  async function copySelected() {
    try {await navigator.clipboard.writeText(selectedCaptions.map((caption)=>caption.content).join('\n'));setNotice(`${selectedCaptions.length} captions copied.`)}
    catch {setError('Copy is unavailable. Download your selected captions instead.')}
  }

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
          {(history ? [['all', 'All votes'], ['up', 'Upvoted'], ['down', 'Downvoted']] : [...(newCaptionIds.length ? [['new', 'Your new captions']] : []), ['all', 'Community'], ['unrated', 'Not rated'], ...(userId ? [['mine', 'Mine']] : [])]).map(([value, label]) => (
            <button key={value} type="button" className="filter-button" aria-pressed={filter === value} onClick={() => setFilter(value as Filter)}>{label}</button>
          ))}
        </div>
        <div className="collection-meta">
          <span aria-live="polite">{visible.length} {history ? 'votes' : 'captions'}</span>
          <label className="sort-control"><span className="sr-only">Sort captions</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="latest">{history ? 'Recently rated' : 'Latest first'}</option>
              <option value="week">Most upvoted this week</option><option value="month">Most upvoted this month</option><option value="top">Most upvoted all time</option>
            </select>
          </label>
        </div>
      </div>
      <div className="gallery-filters">
        <label className="gallery-search"><span>Find a caption or creator</span><input type="search" value={query} placeholder="Search captions, names, or themes…" onChange={(event)=>{setQuery(event.target.value);setLimit(12)}} /></label>
        <details className="gallery-advanced"><summary>Theme, tone &amp; creator{topic || style || author ? ' · filtered' : ''}</summary><div className="gallery-advanced-fields">
        <label><span>Theme</span><select value={topic} onChange={(event)=>{setTopic(event.target.value);setLimit(12)}}><option value="">Every theme</option>{CAPTION_TOPICS.map((item)=><option key={item} value={item}>{topicLabels[item]}</option>)}</select></label>
        <label><span>Tone</span><select value={style} onChange={(event)=>{setStyle(event.target.value);setLimit(12)}}><option value="">Every tone</option>{CAPTION_STYLES.map((item)=><option key={item} value={item}>{item[0].toUpperCase()+item.slice(1)}</option>)}</select></label>
        <label><span>Creator</span><select value={author} onChange={(event)=>{setAuthor(event.target.value);setLimit(12)}}><option value="">Everyone</option>{authors.map(([id,name])=><option key={id} value={id}>{name}{id===userId ? ' (you)' : ''}</option>)}</select></label>
        </div></details>
      </div>
      {(query || topic || style || author) && <button type="button" className="text-link clear-filters" onClick={resetFilters}>Clear filters</button>}
      {selectedCaptions.length>0 && <div className="selection-toolbar"><strong>{selectedCaptions.length} selected</strong><button className="btn btn-ghost" onClick={copySelected}>Copy selected</button><button className="btn btn-ghost" onClick={()=>{downloadText(selectedCaptions);setNotice('Selected captions downloaded.')}}>Download text</button><button className="text-link" onClick={()=>setSelectedIds([])}>Clear selection</button></div>}
      {notice && <p className="status" role="status">{notice}</p>}
      {sort==='week' || sort==='month' ? <p className="ranking-note">Ranked by upvotes cast this {sort==='week' ? 'week (Monday–Sunday)' : 'calendar month'}, in New York time. Card scores show all-time totals.</p> : null}
      <p className="collection-help">{history ? 'Your saved verdicts. One rating per caption keeps the scores fair.' : 'Upvote if it lands. Downvote if it doesn’t. One verdict per caption.'}</p>
      {error && <p className="status status-error" role="alert">{error} <Link href="/login">Sign in</Link></p>}
      {visible.length === 0 ? (
        <div className="empty-state">
          <span className="empty-face" aria-hidden="true">☺</span>
          <h2>{history && myVotes.length === 0 ? 'Your first laugh is waiting.' : filter === 'unrated' ? 'You’ve seen them all.' : 'Nothing here just yet.'}</h2>
          <p>{history && myVotes.length === 0 ? 'Explore the captions and give a few your verdict. They’ll show up here.' : captions.length === 0 ? 'Upload a photo or pick an illustration, then create three short punchlines.' : 'Try another filter or make something new in the caption lab.'}</p>
          {history ? <Link className="btn btn-primary" href="/">Explore captions <span aria-hidden="true">↗</span></Link> : filter !== 'all' ? <button className="btn btn-primary" onClick={resetFilters}>View all captions</button> : <Link className="btn btn-primary" href="/create">Create the first captions <span aria-hidden="true">↗</span></Link>}
        </div>
      ) : (
        <div className="caption-grid">
          {visible.slice(0,limit).map((caption, index) => {
            const visual = captionVisual(caption)
            const busy = pendingIds.includes(caption.id)
            return (
              <article key={caption.id} className="caption-card" aria-labelledby={`caption-${caption.id}`}>
                <div className="caption-image">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={visual.src || '/captions/earth.svg'} alt={visual.alt} width="720" height="480" loading={index < 3 ? 'eager' : 'lazy'} />
                  <span className="image-index">AI caption</span>
                  <label className="caption-select"><input type="checkbox" checked={selectedIds.includes(caption.id)} aria-label={`Select caption: ${caption.content}`} onChange={(event)=>setSelectedIds((all)=>event.target.checked ? [...all,caption.id] : all.filter((id)=>id!==caption.id))} /><span>Select</span></label>
                </div>
                <div className="caption-body">
                  <div className="caption-meta">
                    <p className="caption-category">{topicLabels[caption.topic as CaptionTopic] || visual.category} · {caption.style}</p>
                    <button type="button" className="caption-copy" onClick={() => copyCaption(caption)} aria-label={`Copy caption: ${caption.content}`} aria-live="polite">{copied === caption.id ? 'Copied ✓' : 'Copy'}</button>
                  </div>
                  <p className="caption-author">By <button type="button" onClick={()=>{setAuthor(caption.authorId);setFilter('all');setLimit(12)}}>{caption.authorName || 'Member'}{caption.authorId===userId ? ' · you' : ''}</button><span>{new Date(caption.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'America/New_York'})}</span></p>
                  <h2 id={`caption-${caption.id}`} className="caption-text">{caption.content}</h2>
                  <div className="caption-score"><span>Score <strong>{caption.laughs-caption.groans>0 ? '+' : ''}{caption.laughs-caption.groans}</strong></span><button className="text-link" disabled={exporting!==null} onClick={()=>exportMeme(caption)}>{exporting===caption.id ? 'Creating…' : 'Download meme ↗'}</button></div>
                  <div className="caption-actions">
                    <div className="vote-group">
                      <button className="vote-button" type="button" aria-label={`Upvote: ${caption.content}`} aria-pressed={caption.myVote === 1} disabled={busy || caption.myVote !== 0} onClick={() => vote(caption, 1)}>
                        <ArrowIcon /><span>Upvote</span><strong>{caption.laughs}</strong>
                      </button>
                      <button className="vote-button vote-down" type="button" aria-label={`Downvote: ${caption.content}`} aria-pressed={caption.myVote === -1} disabled={busy || caption.myVote !== 0} onClick={() => vote(caption, -1)}>
                        <ArrowIcon /><span>Downvote</span><strong>{caption.groans}</strong>
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
      {visible.length>limit && <div className="gallery-more"><button className="btn btn-ghost" onClick={()=>setLimit((all)=>all+12)}>Load more captions ({visible.length-limit} remaining)</button></div>}
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
    weekUpvotes: caption.weekUpvotes - Number(caption.myVote === 1) + Number(next === 1),
    monthUpvotes: caption.monthUpvotes - Number(caption.myVote === 1) + Number(next === 1),
    myVote: next,
    votedAt: next ? caption.votedAt ?? new Date().toISOString() : null,
  }
}
