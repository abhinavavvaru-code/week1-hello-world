import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const reply = (body: object, status = 200) => Response.json(body, {
    status, headers: { 'Cache-Control': 'private, no-store' },
  })
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return reply({ error: 'Please submit your rating from Punchline.' }, 403)
  }
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return reply({ error: 'Invalid rating request.' }, 400)
  }
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return reply({ error: 'Sign in to rate captions.' }, 401)
  // Bound the actual streamed body rather than trusting the caller's Content-Length.
  let input: unknown
  try {
    const reader = request.body?.getReader()
    if (!reader) return reply({ error: 'Choose a rating.' }, 400)
    const chunks: Uint8Array[] = []
    let length = 0
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
    input = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)))
  } catch { return reply({ error: 'Choose a valid rating.' }, 400) }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return reply({ error: 'Choose a valid rating.' }, 400)
  }
  const { captionId, value } = input as Record<string, unknown>
  if (typeof captionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(captionId)
    || (value !== 1 && value !== -1)) {
    return reply({ error: 'Choose a valid caption and rating.' }, 400)
  }
  // Identity comes from the verified session. Every rating is an INSERT, never an upsert.
  const { data, error } = await supabase.from('caption_votes')
    .insert({ caption_id: captionId, user_id: user.id, value })
    .select('value, created_at').single()
  if (error?.code === '23505') {
    const { data: existing, error: readError } = await supabase.from('caption_votes')
      .select('value, created_at').eq('user_id', user.id).eq('caption_id', captionId).maybeSingle()
    if (!readError && existing) return reply({ ...existing, alreadyRated: true })
  }
  if (error?.code === '23503') return reply({ error: 'This caption is no longer available.' }, 404)
  if (error || !data) return reply({ error: 'Your rating didn’t save. Please try again.' }, 503)
  return reply(data, 201)
}
