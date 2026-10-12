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

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return denied(404)
  let supabase: Awaited<ReturnType<typeof createClient>>
  try {
    supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return denied(401)
  } catch {
    return denied(401)
  }
  try {
    const { data: path, error } = await supabase.rpc('get_caption_image_v5', { p_caption_id: id })
    if (error || typeof path !== 'string') return denied(404)
    const parts = path.split('/')
    if (parts.length !== 2 || !UUID.test(parts[0]) || !parts[1].endsWith('.jpg')
      || !UUID.test(parts[1].slice(0, -4))) return denied(404)
    const { data: image, error: downloadError } = await supabase.storage.from('caption-uploads').download(path)
    if (downloadError || !image || image.size < 4 || image.size > MAX_IMAGE_BYTES) return denied(404)
    const bytes = new Uint8Array(await image.arrayBuffer())
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff
      || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return denied(404)
    return new Response(bytes, { headers })
  } catch {
    return denied(503)
  }
}
