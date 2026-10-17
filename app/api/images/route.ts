import { Buffer } from 'node:buffer'
import sharp from 'sharp'
import { createClient } from '@/lib/supabase/server'

// SVG is unsupported; prevent its decoder from parsing uploads at all.
sharp.block({ operation: ['VipsForeignLoadSvg'] })

export const runtime = 'nodejs'
export const maxDuration = 30
const MAX_FILE = 3 * 1024 * 1024
const MAX_INPUT = MAX_FILE + 16 * 1024
const MAX_OUTPUT = 1024 * 1024

type Supabase = Awaited<ReturnType<typeof createClient>>

function reply(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

async function recoverRegistration(supabase: Supabase, imageId: string, userId: string, path: string) {
  try {
    const { data, error } = await supabase.from('caption_images')
      .select('id, owner_id, storage_path').eq('id', imageId).maybeSingle()
    if (error) return 'uncertain'
    if (!data) return 'absent'
    return data.id === imageId && data.owner_id === userId && data.storage_path === path
      ? 'saved' : 'uncertain'
  } catch {
    return 'uncertain'
  }
}

async function removeOrphan(supabase: Supabase, path: string) {
  try {
    // RLS serializes this with registration and protects all registered photos.
    await supabase.storage.from('caption-uploads').remove([path])
  } catch {}
}

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return reply({ error: 'Upload from the Punchline website.' }, 403)
  }
  let supabase: Supabase
  let userId: string
  try {
    supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return reply({ error: 'Sign in to upload a photo.' }, 401)
    userId = user.id
  } catch {
    return reply({ error: 'Sign in again to upload a photo.' }, 401)
  }
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.split(';')[0].trim().toLowerCase() !== 'multipart/form-data') {
    return reply({ error: 'Choose a JPEG, PNG, or WebP photo.' }, 415)
  }
  const length = request.headers.get('content-length')
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_INPUT)) {
    return reply({ error: 'Choose a photo smaller than 3 MB.' }, 413)
  }
  const reader = request.body?.getReader()
  if (!reader) return reply({ error: 'Choose a photo.' }, 400)
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_INPUT) {
        await reader.cancel()
        return reply({ error: 'Choose a photo smaller than 3 MB.' }, 413)
      }
      chunks.push(value)
    }
  } catch {
    return reply({ error: 'The upload was interrupted. Try again.' }, 400)
  } finally {
    reader.releaseLock()
  }
  let form: FormData
  try {
    form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': contentType } }).formData()
  } catch {
    return reply({ error: 'That photo could not be read.' }, 400)
  }
  const file = form.get('image')
  if (!(file instanceof File) || !file.size) return reply({ error: 'Choose a photo.' }, 400)
  if (file.size > MAX_FILE) return reply({ error: 'Choose a photo smaller than 3 MB.' }, 413)
  const titleValue = form.get('title') ?? 'My photo'
  const altValue = form.get('alt') ?? 'A member-uploaded photo'
  if (typeof titleValue !== 'string' || typeof altValue !== 'string') {
    return reply({ error: 'Use a short photo title and description.' }, 400)
  }
  const title = titleValue.trim()
  const alt = altValue.trim() || 'A member-uploaded photo'
  if (!title || title.length > 80 || !alt || alt.length > 250 || /[\u0000-\u001f]/.test(title + alt)) {
    return reply({ error: 'Use a short photo title and description.' }, 400)
  }
  let jpeg: Buffer
  try {
    const bytes = Buffer.from(await file.arrayBuffer())
    const image = sharp(bytes, { limitInputPixels: 24_000_000, animated: false })
    const metadata = await image.metadata()
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1
      || !metadata.width || !metadata.height || metadata.width * metadata.height > 24_000_000) {
      throw new Error('format')
    }
    // Decode, orient, re-encode, and strip metadata before storing the photo.
    jpeg = await image.rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 }).toBuffer()
    if (jpeg.length > MAX_OUTPUT) return reply({ error: 'That photo is too detailed. Try a smaller one.' }, 413)
  } catch {
    return reply({ error: 'Choose a readable JPEG, PNG, or WebP photo under 24 megapixels.' }, 400)
  }
  const id = crypto.randomUUID()
  const imageId = `upload-${id}`
  const path = `${userId}/${id}.jpg`
  try {
    const { error } = await supabase.storage.from('caption-uploads')
      .upload(path, jpeg, { contentType: 'image/jpeg', upsert: false })
    if (error) return reply({ error: 'The photo could not upload. You can add up to 20 photos a day.' }, 503)
  } catch {
    await removeOrphan(supabase, path)
    return reply({ error: 'The upload was interrupted. Try again.' }, 503)
  }
  try {
    const { data, error } = await supabase.rpc('register_caption_image_v5', {
      p_image_id: id, p_title: title, p_alt: alt,
    })
    if (!error && data === imageId) return reply({ imageId, imageSrc: '', imageAlt: alt })
  } catch {
    // A lost response can follow a successful transaction. Check before cleanup.
  }
  const registration = await recoverRegistration(supabase, imageId, userId, path)
  if (registration === 'saved') return reply({ imageId, imageSrc: '', imageAlt: alt })
  if (registration === 'absent') await removeOrphan(supabase, path)
  return reply({ error: 'We could not save that photo. Try again.' }, 503)
}
