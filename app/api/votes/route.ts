import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const reply = (body: object, status = 200) => Response.json(body, {
    status, headers: { 'Cache-Control': 'private, no-store' },
  })
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return reply({ error: 'Please submit your rating from Punchline.' }, 403)
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return reply({ error: 'Invalid rating request.' }, 400)
  }
  let supabase: Awaited<ReturnType<typeof createClient>>
  try {
    supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return reply({ error: 'Sign in to rate captions.' }, 401)
  } catch { return reply({ error: 'Your rating couldn’t be checked. Please try again.' }, 503) }
  // Bound the actual streamed body rather than trusting the caller's Content-Length.
  let input: unknown
  try {
    const reader = request.body?.getReader()
    if (!reader) return reply({ error: 'Choose a rating.' }, 400)
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.length
        if (length > 1024) {
          await reader.cancel()
          return reply({ error: 'Invalid rating request.' }, 413)
        }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
  } catch { return reply({ error: 'Choose a valid rating.' }, 400) }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return reply({ error: 'Choose a valid rating.' }, 400)
  }
  const { captionId, value } = input as Record<string, unknown>
  if (Object.keys(input).some(key => !['captionId', 'value'].includes(key))
    || typeof captionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(captionId)
    || (value !== 1 && value !== -1 && value !== 0)) {
    return reply({ error: 'Choose a valid caption and rating.' }, 400)
  }
  // The database derives identity from auth.uid() and locks the caption while
  // inserting, switching, or removing this member's own rating.
  try {
    const { data, error } = await supabase.rpc('set_caption_vote_v7', { p_caption_id: captionId, p_value: value })
    if (error?.code === 'P0002' || error?.code === '23503') return reply({ error: 'This caption is no longer available.' }, 404)
    if (error?.code === '42501') return reply({ error: 'Sign in to rate this caption.' }, 403)
    const timestamp = (item: unknown) => typeof item === 'string' && item.length <= 64 && Number.isFinite(Date.parse(item))
    if (error || !data || typeof data !== 'object' || Array.isArray(data) || typeof data.caption_id !== 'string' || data.caption_id.toLowerCase() !== captionId.toLowerCase()
      || data.value !== value || !Number.isSafeInteger(data.laughs) || data.laughs < 0
      || !Number.isSafeInteger(data.groans) || data.groans < 0
      || (value !== 0 && (!timestamp(data.created_at) || !timestamp(data.updated_at)))
      || (value === 0 && (data.created_at !== null || data.updated_at !== null))) {
      return reply({ error: 'Your rating couldn’t be confirmed. Refresh the gallery before trying again.' }, 503)
    }
    return reply({ caption_id: data.caption_id, value: data.value, laughs: data.laughs, groans: data.groans,
      created_at: data.created_at, updated_at: data.updated_at })
  } catch { return reply({ error: 'Your rating didn’t save. Please try again.' }, 503) }
}
