'use client'

import Link from 'next/link'
import { useId, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

const images = [
  { id: 'udp', label: 'Left on read', alt: 'A paper airplane carrying a message into the unknown', prompt: 'A message vanishes into the void of the dorm group chat.' },
  { id: 'dark-mode', label: 'One more tab', alt: 'A laptop glowing in the dark, attracting a few curious bugs', prompt: 'It is late at night in the dorms, and the laptop is still glowing.' },
  { id: 'gravity', label: 'Light reading', alt: 'An open book floating above a desk', prompt: 'An open book floats above a desk during a long library study session.' },
  { id: 'interest', label: 'Student budget', alt: 'A piggy bank beside a falling interest chart', prompt: 'A piggy bank watches a falling interest chart after a weekend in New York.' },
  { id: 'binary', label: 'Roommate logic', alt: 'Two friendly robots, one and zero', prompt: 'Two robot roommates, one and zero, have very different ideas about the weekend.' },
  { id: 'earth', label: 'Outside era', alt: 'A happy planet Earth enjoying the sunshine', prompt: 'A happy planet enjoys the sunshine while a student finally goes outside in New York.' },
] as const

const styles = [
  { id: 'dry', label: 'Dry', description: 'Understated. Unbothered.' },
  { id: 'chaotic', label: 'Chaotic', description: 'A little too online.' },
  { id: 'wholesome', label: 'Wholesome', description: 'Good vibes, good joke.' },
] as const

type GenerationResponse = {
  generationId?: string
  captionIds?: string[]
  remaining?: number
  error?: string
  code?: string
}

export default function CaptionLab({ initialRemaining = null, dailyBrief }: {
  initialRemaining?: number | null
  dailyBrief: string
}) {
  const [imageId, setImageId] = useState<string>('dark-mode')
  const [style, setStyle] = useState<string>('dry')
  const [prompt, setPrompt] = useState<string>(images[1].prompt)
  const [remaining, setRemaining] = useState(initialRemaining)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [needsLogin, setNeedsLogin] = useState(false)
  const requestId = useRef<string | null>(null)
  const inFlight = useRef(false)
  const router = useRouter()
  const formId = useId()
  const selected = images.find((image) => image.id === imageId) ?? images[1]
  const exhausted = remaining === 0

  function edit() {
    requestId.current = null
    setError('')
    setNeedsLogin(false)
  }

  function selectImage(nextId: string) {
    const next = images.find((image) => image.id === nextId)
    if (!next) return
    if (prompt === selected.prompt) setPrompt(next.prompt)
    setImageId(nextId)
    edit()
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || exhausted) return
    const scene = prompt.trim()
    if (scene.length < 5 || scene.length > 500) {
      setError('Give the AI a little context: between 5 and 500 characters.')
      return
    }
    inFlight.current = true
    setBusy(true)
    setError('')
    setNeedsLogin(false)
    requestId.current ??= crypto.randomUUID()
    let navigating = false
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: requestId.current, imageId, style, prompt: scene }),
      })
      const body: unknown = await response.json().catch(() => null)
      const result = typeof body === 'object' && body !== null && !Array.isArray(body)
        ? body as GenerationResponse : null
      if (!result) {
        setError('We could not confirm your captions. Please try again to pick up where you left off.')
        return
      }
      if (typeof result.remaining === 'number') setRemaining(Math.max(0, result.remaining))
      if (!response.ok) {
        const code = typeof result.code === 'string' ? result.code : null
        // Pending or uncertain saves may already have used the AI call. Failed
        // reservations need a fresh ID, even when the response status is 409.
        if (code && code !== 'generation_pending' && code !== 'save_failed') requestId.current = null
        if (code === 'unauthorized' || response.status === 401) {
          setNeedsLogin(true)
          setError('Your session has expired. Sign in to create captions.')
        } else if (code === 'daily_limit') {
          setRemaining(0)
          setError('You have used today’s five generations. Come back tomorrow for a fresh batch.')
        } else if (code === 'provider_busy') {
          setError('The caption generator is busy. Your scene is still here; try again in a moment.')
        } else if (code === 'setup_required') {
          setError('The caption lab is getting ready. Please try again later.')
        } else if (code === 'generation_pending') {
          setError('Your captions are still on their way. Give it a moment and try again.')
        } else if (code === 'save_failed') {
          setError('We could not confirm the saved captions. Please try again to check for them.')
        } else {
          setError(typeof result.error === 'string' ? result.error : 'That punchline did not land. Your scene is saved here; try again.')
        }
        return
      }
      if (typeof result.generationId !== 'string' || !Array.isArray(result.captionIds) || result.captionIds.length === 0) {
        // An unclear response may follow a successful save. Retrying the same ID
        // lets the server return that result instead of making another AI call.
        setError('We could not confirm your captions. Please try again to pick up where you left off.')
        return
      }
      requestId.current = null
      navigating = true
      router.push(`/?generation=${encodeURIComponent(result.generationId)}`)
    } catch {
      setError('The connection dropped. Your scene is still here. Try again to check for your captions.')
    } finally {
      if (!navigating) {
        inFlight.current = false
        setBusy(false)
      }
    }
  }

  return (
    <div className="lab-layout">
      <aside className="lab-preview" aria-label="Your selected illustration">
        <div className="lab-preview-image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/captions/${selected.id}.svg`} width="720" height="480" alt={selected.alt} />
          <span className="lab-image-label">YOUR CANVAS</span>
        </div>
        <div className="lab-preview-body">
          <p className="eyebrow">PICTURE THIS</p>
          <h2>{selected.label}</h2>
          <p>One illustration. Three AI punchlines. The members decide what lands.</p>
        </div>
        <div className="lab-daily">
          <p className="eyebrow"><span className="live-dot" /> TODAY’S BRIEF</p>
          <p className="lab-brief">{dailyBrief}</p>
          <button type="button" className="text-link" disabled={busy} onClick={() => { setPrompt(dailyBrief); edit() }}>
            Try this scene <span aria-hidden="true">↗</span>
          </button>
          <p className="lab-daily-note">A fresh idea every day, inspired by campus life and NYC weekends.</p>
        </div>
      </aside>

      <form className="lab-form" onSubmit={generate} aria-busy={busy}>
        <fieldset className="lab-fieldset" disabled={busy}>
          <legend><span className="lab-step">01</span> Pick your picture</legend>
          <div className="lab-image-options">
            {images.map((image) => (
              <label key={image.id} className="lab-image-option">
                <input type="radio" name="image" value={image.id} checked={imageId === image.id} onChange={() => selectImage(image.id)} />
                <span className="lab-image-choice">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/captions/${image.id}.svg`} width="180" height="120" alt="" />
                  <span>{image.label}</span>
                  <span className="lab-selection" aria-hidden="true">✓</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="lab-fieldset" disabled={busy}>
          <legend><span className="lab-step">02</span> Choose the energy</legend>
          <div className="lab-style-options">
            {styles.map((item) => (
              <label key={item.id} className="lab-style-option">
                <input type="radio" name="style" value={item.id} checked={style === item.id} onChange={() => { setStyle(item.id); edit() }} />
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="lab-scene">
          <label htmlFor={`${formId}-prompt`}><span className="lab-step">03</span> Set the scene</label>
          <p id={`${formId}-hint`}>Give the AI a situation, an inside joke, or a little campus context.</p>
          <textarea id={`${formId}-prompt`} name="prompt" value={prompt} minLength={5} maxLength={500} required disabled={busy}
            aria-describedby={`${formId}-hint ${formId}-count`} rows={4}
            onChange={(event) => { setPrompt(event.target.value); edit() }} />
          <p id={`${formId}-count`} className="lab-character-count">{prompt.length} / 500</p>
        </div>

        <div className="lab-submit-area">
          <button type="submit" className="btn btn-primary lab-submit" disabled={busy || exhausted}>
            {busy ? <><span className="lab-spinner" aria-hidden="true" /> Finding the punchline…</> : <><SparkIcon /> Generate 3 captions <span aria-hidden="true">↗</span></>}
          </button>
          <p className="lab-allowance">{remaining === null ? 'Up to 5 generations a day.' : `${remaining} of 5 generations left today.`} Three captions each.</p>
          <p className="lab-privacy">Your scene stays private. Your AI captions are shared with signed-in members and ready to rate.</p>
          <div aria-live="polite" role="status" className="lab-progress">{busy ? 'Making and saving your captions. Keep this page open for a moment.' : ''}</div>
          {error && <p className="status status-error" role="alert">{error}{needsLogin && <> <Link href="/login">Sign in</Link></>}</p>}
        </div>
      </form>
    </div>
  )
}

function SparkIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" /></svg>
}
