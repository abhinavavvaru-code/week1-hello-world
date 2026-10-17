import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 30
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_IMAGE_BYTES = 1024 * 1024
const headers = {
  'Content-Type': 'image/jpeg',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'",
}

function denied(status: number) {
  return new Response(null, { status, headers })
}

async function signedImage(supabase: Awaited<ReturnType<typeof createClient>>, path: string) {
  const { data, error } = await supabase.storage.from('caption-uploads').createSignedUrl(path, 60)
  if (error || !data?.signedUrl) return null
  const signed = new URL(data.signedUrl)
  const expected = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!)
  if (signed.origin !== expected.origin || signed.username || signed.password || signed.hash
    || signed.pathname !== `/storage/v1/object/sign/caption-uploads/${path}`) return null
  const response = await fetch(signed, {
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000),
  })
  if (!response.ok || !response.body) return null
  const contentLength = response.headers.get('content-length')
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_IMAGE_BYTES)) {
    await response.body.cancel()
    return null
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_IMAGE_BYTES) { await reader.cancel(); return null }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return denied(404)
  let supabase: Awaited<ReturnType<typeof createClient>>
  try {
    supabase = await createClient()
  } catch {
    return denied(503)
  }
  try {
    const { data: path, error } = await supabase.rpc('get_caption_image_v6', { p_caption_id: id })
    if (error || typeof path !== 'string') return denied(404)
    const parts = path.split('/')
    if (parts.length !== 2 || !UUID.test(parts[0]) || !parts[1].endsWith('.jpg')
      || !UUID.test(parts[1].slice(0, -4))) return denied(404)
    let image: Blob | null = null
    try {
      const download = await supabase.storage.from('caption-uploads').download(path, {}, {
        cache: 'no-store', signal: AbortSignal.timeout(5000),
      })
      if (!download.error) image = download.data
    } catch { /* Some Storage deployments allow signing a published object but deny download. */ }
    if (image && (image.size < 4 || image.size > MAX_IMAGE_BYTES)) return denied(404)
    const bytes = image ? new Uint8Array(await image.arrayBuffer()) : await signedImage(supabase, path)
    if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff
      || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return denied(404)
    return new Response(bytes, { headers })
  } catch {
    return denied(503)
  }
}
