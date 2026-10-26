'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useGeneration } from './GenerationProvider'
import { CAPTION_STYLES, CAPTION_TOPICS, CAPTION_PERSPECTIVES, topicLabels, perspectiveLabels, type CaptionStyle, type CaptionTopic, type CaptionPerspective } from '@/lib/generation-options'
import { presetPhotos } from '@/lib/preset-photos'

const illustrations = [
  { id: 'udp', label: 'Left on read', alt: 'A paper airplane carrying a message into the unknown', prompt: 'A message vanishes into the void of the dorm group chat.' },
  { id: 'dark-mode', label: 'One more tab', alt: 'A laptop glowing in the dark, attracting a few curious bugs', prompt: 'It is late at night in the dorms, and the laptop is still glowing.' },
  { id: 'gravity', label: 'Light reading', alt: 'An open book floating above a desk', prompt: 'An open book floats above a desk during a long library study session.' },
  { id: 'interest', label: 'Student budget', alt: 'A piggy bank beside a falling interest chart', prompt: 'A piggy bank watches a falling interest chart after a weekend in New York.' },
  { id: 'binary', label: 'Roommate logic', alt: 'Two friendly robots, one and zero', prompt: 'Two robot roommates, one and zero, have very different ideas about the weekend.' },
  { id: 'earth', label: 'Outside era', alt: 'A happy planet Earth enjoying the sunshine', prompt: 'A happy planet enjoys the sunshine while a student finally goes outside in New York.' },
] as const
const images = [...presetPhotos, ...illustrations.map((image) => ({ ...image, src: `/captions/${image.id}.svg` }))]

const styleDescriptions: Record<CaptionStyle, { label: string; description: string }> = {
  dry: { label: 'Dry', description: 'Understated. Unbothered.' },
  chaotic: { label: 'Chaotic', description: 'A little too online.' },
  wholesome: { label: 'Wholesome', description: 'Good vibes, good joke.' },
  wordplay: { label: 'Wordplay', description: 'A pun with a plan.' },
  roast: { label: 'Roast', description: 'Playful, never personal.' },
}

type PhotoChoice = { id: string | null; src: string; blob: Blob; title: string; alt: string }
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_PHOTO_BYTES = 3 * 1024 * 1024
const MAX_UPLOAD_BYTES = 1_000_000
const MAX_PHOTO_PIXELS = 24_000_000

// Resize before uploading so neither the app nor the captioning service needs
// the original full-resolution photo. The conversion also removes metadata.
export async function preparePhoto(file: File): Promise<Blob> {
  if (!PHOTO_TYPES.includes(file.type)) throw new Error('Choose a JPEG, PNG, or WebP photo.')
  if (file.size > MAX_PHOTO_BYTES) throw new Error('Choose a photo smaller than 3 MB.')
  if (file.size === 0) throw new Error('This photo is empty. Choose another file.')
  const original = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = original
    try { await image.decode() } catch { throw new Error('We could not open this photo. Try another JPEG, PNG, or WebP.') }
    const width = image.naturalWidth
    const height = image.naturalHeight
    if (!width || !height || width * height > MAX_PHOTO_PIXELS) {
      throw new Error('Choose a photo with no more than 24 megapixels.')
    }
    const scale = Math.min(1, 1280 / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('We could not prepare this photo. Please try another browser.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.86, 0.74, 0.62, 0.5]) {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => {
        if (result) resolve(result)
        else reject(new Error('We could not prepare this photo. Please try again.'))
      }, 'image/jpeg', quality))
      if (blob.type === 'image/jpeg' && blob.size <= MAX_UPLOAD_BYTES) return blob
    }
    throw new Error('This photo is still too large. Try a simpler or smaller photo.')
  } finally {
    URL.revokeObjectURL(original)
  }
}

type GenerationResponse = {
  generationId?: string
  captionIds?: string[]
  remaining?: number
  error?: string
  code?: string
}

export default function CaptionLab({ initialRemaining = null, dailyBrief, initialTopic = 'campus', availableImageIds = images.map((image) => image.id) }: {
  initialRemaining?: number | null
  dailyBrief: string
  initialTopic?: CaptionTopic
  availableImageIds?: string[]
}) {
  const availableImages = images.filter((image) => availableImageIds.includes(image.id))
  const generation = useGeneration()
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const [sceneApplied,setSceneApplied] = useState(false)
  const [imageId, setImageId] = useState<string>(availableImages[0]?.id || '')
  const [style, setStyle] = useState<CaptionStyle>('dry')
  const [topic, setTopic] = useState<CaptionTopic>(initialTopic)
  const [perspective, setPerspective] = useState<CaptionPerspective>('observer')
  const [photo, setPhoto] = useState<PhotoChoice | null>(null)
  const [photoConsent, setPhotoConsent] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [prompt, setPrompt] = useState<string>('')
  const [remaining, setRemaining] = useState(initialRemaining)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [needsLogin, setNeedsLogin] = useState(false)
  const requestId = useRef<string | null>(null)
  const inFlight = useRef(false)
  const photoInFlight = useRef(false)
  const photoUrl = useRef<string | null>(null)
  const uploadController = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const router = useRouter()
  const formId = useId()
  const selected = images.find((image) => image.id === imageId) ?? availableImages[0] ?? images[0]
  const available = generation.remaining ?? remaining
  const exhausted = available === 0
  const photoSelected = imageId.startsWith('upload-')
  const locked = busy || generation.busy || preparing || uploading
  const selectedAlt = photoSelected && photo ? photo.alt || 'Your uploaded photo' : selected.alt
  const selectedSrc = photoSelected && photo ? photo.src : selected.src
  const selectedTitle = photoSelected && photo ? photo.title || 'Your photo' : selected.label

  useEffect(() => {
    if (generation.job?.status === 'failed') requestId.current = null
  }, [generation.job?.status])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      uploadController.current?.abort()
      if (photoUrl.current) URL.revokeObjectURL(photoUrl.current)
    }
  }, [])

  function edit() {
    requestId.current = null
    setError('')
    setNeedsLogin(false)
  }

  function selectImage(nextId: string) {
    const next = images.find((image) => image.id === nextId)
    if (!next) return
    if (prompt === selected.prompt || (photoSelected && prompt === '')) setPrompt(next.prompt)
    setImageId(nextId)
    edit()
  }

  async function selectPhoto(file: File | undefined) {
    if (!file || locked || photoInFlight.current) return
    photoInFlight.current = true
    setPreparing(true)
    setPhotoError('')
    try {
      const blob = await preparePhoto(file)
      if (!mounted.current) return
      const src = URL.createObjectURL(blob)
      if (photoUrl.current) URL.revokeObjectURL(photoUrl.current)
      photoUrl.current = src
      const title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 80) || 'Your photo'
      setPhoto({ id: null, src, blob, title, alt: '' })
      setPhotoConsent(false)
      setImageId('upload-pending')
      if (prompt === selected.prompt) setPrompt('')
      edit()
    } catch (failure) {
      if (mounted.current) setPhotoError(failure instanceof Error ? failure.message : 'We could not prepare this photo. Try another file.')
    } finally {
      photoInFlight.current = false
      if (mounted.current) setPreparing(false)
    }
  }

  async function uploadPhoto() {
    if (!photo || !photoConsent || locked || photoInFlight.current) return
    photoInFlight.current = true
    setUploading(true)
    setPhotoError('')
    setNeedsLogin(false)
    const controller = new AbortController()
    uploadController.current = controller
    try {
      const body = new FormData()
      body.append('image', photo.blob, 'photo.jpg')
      body.append('title', photo.title.trim().slice(0, 80) || 'Your photo')
      body.append('alt', photo.alt.trim().slice(0, 250))
      const response = await fetch('/api/images', { method: 'POST', body, signal: controller.signal })
      const result: unknown = await response.json().catch(() => null)
      if (!mounted.current) return
      if (response.status === 401) {
        setNeedsLogin(true)
        throw new Error('Your session has expired. Sign in to upload your photo.')
      }
      if (!response.ok || !result || typeof result !== 'object' || Array.isArray(result)) {
        throw new Error(response.status === 429 ? 'You have reached the photo limit for today. Try a preset picture.' : 'Your photo did not upload. Please try again.')
      }
      const saved = result as { imageId?: unknown; imageSrc?: unknown; imageAlt?: unknown }
      if (typeof saved.imageId !== 'string' || !/^upload-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved.imageId)
        || typeof saved.imageSrc !== 'string' || typeof saved.imageAlt !== 'string') {
        throw new Error('We could not confirm the upload. Please try again.')
      }
      setPhoto({ ...photo, id: saved.imageId, alt: saved.imageAlt })
      setImageId(saved.imageId)
      edit()
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted) setPhotoError(failure instanceof Error ? failure.message : 'Your photo did not upload. Please try again.')
    } finally {
      photoInFlight.current = false
      uploadController.current = null
      if (mounted.current) setUploading(false)
    }
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || exhausted || preparing || uploading) return
    if (!photoSelected && !availableImageIds.includes(imageId)) {
      setError('Choose an available picture or upload your own photo.')
      return
    }
    if (photoSelected && (!photo?.id || !photoConsent)) {
      setError('Upload your photo and confirm the photo settings before generating.')
      return
    }
    const scene = prompt.trim() || (photoSelected ? 'Write three short captions grounded in the visible photo.' : selected.prompt)
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
      const response = await generation.start({requestId:requestId.current,imageId,style,topic,perspective,prompt:scene})
      const result: GenerationResponse = response.data
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
      if (mounted.current) router.push(`/explore?generation=${encodeURIComponent(result.generationId)}`)
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
      <aside className="lab-preview" aria-label="Your selected picture">
        <div className="lab-preview-image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={selectedSrc} width="720" height="480" alt={selectedAlt} />
          <span className="lab-image-label">YOUR CANVAS</span>
        </div>
        <div className="lab-preview-body">
          <p className="eyebrow">PICTURE THIS</p>
          <h2>{selectedTitle}</h2>
          <p>Your picture. Three short AI punchlines. The members decide what lands.</p>
          {!photoSelected && 'photographer' in selected && <p className="lab-photo-credit">Photo by <a href={selected.source} target="_blank" rel="noreferrer">{selected.photographer} / Pexels</a></p>}
        </div>
        <div className="lab-daily">
          <p className="eyebrow"><span className="live-dot" /> TODAY’S BRIEF</p>
          <p className="lab-brief">{dailyBrief}</p>
          <button type="button" className="text-link" disabled={locked} onClick={() => { setPrompt(dailyBrief); edit(); setSceneApplied(true); promptRef.current?.focus(); promptRef.current?.scrollIntoView({behavior:'smooth',block:'center'}) }}>
            {sceneApplied ? 'Scene added ✓' : 'Use this scene in my prompt'}
          </button>
          <p className="lab-daily-note">Fills the scene box below. Then choose Generate to make captions.</p>
        </div>
      </aside>

      <form className="lab-form" onSubmit={generate} aria-busy={locked}>
        <fieldset className="lab-fieldset" disabled={locked}>
          <legend><span className="lab-step">01</span> Pick your picture</legend>
          <div className="lab-upload-box">
            <label className="lab-upload-label" htmlFor={`${formId}-photo`}><span aria-hidden="true">↥</span> Upload an image</label>
            <input id={`${formId}-photo`} className="lab-file-input" type="file" accept="image/jpeg,image/png,image/webp"
              aria-describedby={`${formId}-photo-hint`} onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                void selectPhoto(file)
              }} />
            <p id={`${formId}-photo-hint`}>JPEG, PNG, or WebP · up to 3 MB. We resize it before uploading.</p>
            {preparing && <p className="lab-upload-status" role="status">Preparing your photo…</p>}
            {photo && (
              <div className="lab-photo-details">
                <label htmlFor={`${formId}-photo-title`}>Photo title</label>
                <input id={`${formId}-photo-title`} value={photo.title} maxLength={80} disabled={Boolean(photo.id)} onChange={(event) => { setPhoto({ ...photo, title: event.target.value }); edit() }} />
                <label htmlFor={`${formId}-photo-alt`}>Image description <span>(optional, not your joke prompt)</span></label>
                <input id={`${formId}-photo-alt`} value={photo.alt} maxLength={250} disabled={Boolean(photo.id)} placeholder="A coffee cup beside a pile of books" onChange={(event) => { setPhoto({ ...photo, alt: event.target.value }); edit() }} />
                <label className="lab-photo-consent"><input type="checkbox" checked={photoConsent} onChange={(event) => { setPhotoConsent(event.target.checked); edit() }} />
                  <span>I’m okay with DeepSeek reading this photo’s visible content for captions, and publishing the photo and captions in Explore when I post.</span>
                </label>
                <p className="lab-photo-note">Use an image you have permission to publish. Your written prompt stays private.</p>
                {!photo.id ? <button type="button" className="btn btn-sm" disabled={locked || !photoConsent} onClick={uploadPhoto}>{uploading ? 'Uploading your photo…' : 'Upload and use photo'}</button>
                  : <p className="lab-upload-status" role="status">Photo ready. Choose your style and set the scene below.</p>}
              </div>
            )}
            {photoError && <p className="status status-error" role="alert">{photoError}{needsLogin && <> <Link href="/login">Sign in</Link></>}</p>}
          </div>
          <p className="lab-preset-label">Or start with a real photo or illustration</p>
          <div className="lab-image-options">
            {photo && <label className="lab-image-option">
              <input type="radio" name="image" value={photo.id || 'upload-pending'} checked={photoSelected} onChange={() => { if (prompt === selected.prompt) setPrompt(''); setImageId(photo.id || 'upload-pending'); edit() }} />
              <span className="lab-image-choice">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.src} width="180" height="120" alt="" />
                <span>Your photo</span><span className="lab-selection" aria-hidden="true">✓</span>
              </span>
            </label>}
            {availableImages.map((image) => (
              <label key={image.id} className="lab-image-option">
                <input type="radio" name="image" value={image.id} checked={imageId === image.id} onChange={() => selectImage(image.id)} />
                <span className="lab-image-choice">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.src} width="180" height="120" alt="" />
                  <span>{image.label}</span>
                  <span className="lab-selection" aria-hidden="true">✓</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="lab-fieldset" disabled={locked}>
          <legend><span className="lab-step">02</span> Choose the energy <small>optional</small></legend>
          <div className="lab-style-options">
            {CAPTION_STYLES.map((id) => ({ id, ...styleDescriptions[id] })).map((item) => (
              <label key={item.id} className="lab-style-option">
                <input type="radio" name="style" value={item.id} checked={style === item.id} onChange={() => { setStyle(item.id); edit() }} />
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="lab-fieldset lab-angle-fields" disabled={locked}>
          <legend><span className="lab-step">03</span> Find your angle <small>optional</small></legend>
          <div className="lab-angle-options">
            <label htmlFor={`${formId}-topic`}>Topic
              <select id={`${formId}-topic`} value={topic} onChange={(event) => { setTopic(event.target.value as CaptionTopic); edit() }}>
                {CAPTION_TOPICS.map((value) => <option key={value} value={value}>{topicLabels[value]}</option>)}
              </select>
            </label>
            <label htmlFor={`${formId}-perspective`}>Whose point of view?
              <select id={`${formId}-perspective`} value={perspective} onChange={(event) => { setPerspective(event.target.value as CaptionPerspective); edit() }}>
                {CAPTION_PERSPECTIVES.map((value) => <option key={value} value={value}>{perspectiveLabels[value]}</option>)}
              </select>
            </label>
          </div>
        </fieldset>

        <div className="lab-scene">
          <label htmlFor={`${formId}-prompt`}><span className="lab-step">04</span> Set the scene <small>optional</small></label>
          <p id={`${formId}-hint`}>Add an inside joke, or leave this blank and we’ll use the picture. Captions stay under 10 words.</p>
          <textarea ref={promptRef} id={`${formId}-prompt`} name="prompt" value={prompt} placeholder={photoSelected ? 'Optional: add a situation or an inside joke…' : selected.prompt} minLength={5} maxLength={500} disabled={locked}
            aria-describedby={`${formId}-hint ${formId}-count`} rows={4}
            onChange={(event) => { setPrompt(event.target.value); edit() }} />
          <p id={`${formId}-count`} className="lab-character-count">{prompt.length} / 500</p>
        </div>

        <div className="lab-submit-area">
          <button type="submit" className="btn btn-primary lab-submit" disabled={locked || exhausted || (photoSelected && (!photo?.id || !photoConsent))}>
            {busy || generation.busy ? <><span className="lab-spinner" aria-hidden="true" /> Finding the punchline…</> : <><SparkIcon /> Generate 3 captions <span aria-hidden="true">↗</span></>}
          </button>
          <p className="lab-allowance">{available === null ? 'Up to 5 successful generations a day.' : `${available} of 5 generations left today.`} Failed rounds are returned.</p>
          <p className="lab-privacy">Your prompt and context stay private. Your image and captions are published in Explore when you generate.</p>
          <div aria-live="polite" role="status" className="lab-progress">{busy || generation.busy ? 'Generating and saving your captions. You can browse Explore while you wait.' : ''}</div>
          {error && generation.job?.status!=='succeeded' && <p className="status status-error" role="alert">{error}{needsLogin && <> <Link href="/login">Sign in</Link></>}</p>}
        </div>
      </form>
    </div>
  )
}

function SparkIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" /></svg>
}
