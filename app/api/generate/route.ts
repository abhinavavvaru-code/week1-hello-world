import { Buffer } from 'node:buffer'
import { createClient } from '@/lib/supabase/server'
import { CAPTION_PERSPECTIVES, CAPTION_STYLES, CAPTION_TOPICS } from '@/lib/generation-options'
import {
  CAPTION_IMAGE_IDS,
  CaptionGenerationError,
  captionSystemPrompt,
  generateCaptions,
  type GenerateCaptionInput,
} from '@/lib/ai-captions'

export const runtime = 'nodejs'
export const maxDuration = 45

const MAX_BODY_BYTES = 8 * 1024
const MAX_IMAGE_BYTES = 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function reply(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function failure(error: string, code: string, status: number) {
  return reply({ error, code }, status)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readBody(request: Request) {
  const contentLength = request.headers.get('content-length')
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
    return { error: 'too_large' as const }
  }
  const reader = request.body?.getReader()
  if (!reader) return { error: 'invalid_json' as const }
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        return { error: 'too_large' as const }
      }
      chunks.push(value)
    }
  } catch {
    return { error: 'invalid_json' as const }
  } finally {
    reader.releaseLock()
  }
  const buffer = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return { data: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)) as unknown }
  } catch {
    return { error: 'invalid_json' as const }
  }
}

function validateInput(data: unknown): GenerateCaptionInput | null {
  if (!isRecord(data) || typeof data.requestId !== 'string' || !UUID.test(data.requestId)) return null
  if (typeof data.imageId !== 'string') return null
  const isPreset = CAPTION_IMAGE_IDS.some((id) => id === data.imageId)
  const isUpload = data.imageId.startsWith('upload-') && UUID.test(data.imageId.slice(7))
  if (!isPreset && !isUpload) return null
  if (typeof data.style !== 'string' || !CAPTION_STYLES.some((style) => style === data.style)) return null
  const topic = data.topic === undefined ? 'campus' : data.topic
  const perspective = data.perspective === undefined ? 'observer' : data.perspective
  if (typeof topic !== 'string' || !CAPTION_TOPICS.some((value) => value === topic)) return null
  if (typeof perspective !== 'string' || !CAPTION_PERSPECTIVES.some((value) => value === perspective)) return null
  if (typeof data.prompt !== 'string') return null
  const prompt = data.prompt.trim()
  if (prompt.length < 1 || prompt.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(prompt)) return null
  return {
    requestId: data.requestId,
    imageId: (isUpload ? data.imageId.toLowerCase() : data.imageId) as GenerateCaptionInput['imageId'],
    style: data.style as GenerateCaptionInput['style'],
    topic: topic as GenerateCaptionInput['topic'],
    perspective: perspective as GenerateCaptionInput['perspective'],
    prompt,
  }
}

function databaseFailure(error: { code?: string; message?: string }) {
  if (error.message === 'REQUEST_ID_REUSED_WITH_DIFFERENT_INPUT') {
    return failure('This request has already been used. Start a fresh generation.', 'request_conflict', 409)
  }
  if (error.message === 'GENERATION_LIMIT_REACHED') {
    return failure('You have used today’s five generations. Come back tomorrow for a fresh round.', 'daily_limit', 429)
  }
  if (error.code === '42501') return failure('Sign in again to generate captions.', 'unauthorized', 401)
  if (['PGRST202', 'PGRST204', 'PGRST205', '42703', '42883', '42P01'].includes(error.code ?? '')) {
    return failure('The caption lab is being set up. Please try again later.', 'setup_required', 503)
  }
  return failure('We couldn’t save this generation. Please try again.', 'save_failed', 503)
}

function captionIds(data: unknown): string[] | null {
  if (!Array.isArray(data) || data.length !== 3) return null
  const ids = data.map((row: unknown) => isRecord(row) && typeof row.id === 'string' && UUID.test(row.id) ? row.id : '')
  return ids.every(Boolean) && new Set(ids).size === 3 ? ids : null
}

async function markFailed(supabase: Awaited<ReturnType<typeof createClient>>, generationId: string) {
  try {
    await supabase.rpc('fail_caption_generation', { p_generation_id: generationId })
  } catch {
    // Cleanup must not hide the original generation or persistence failure.
  }
}

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return failure('Please generate captions from the Punchline website.', 'invalid_origin', 403)
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return failure('Send a valid caption request.', 'invalid_request', 415)
  }

  let supabase: Awaited<ReturnType<typeof createClient>>
  let userId: string
  try {
    supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return failure('Sign in to generate captions.', 'unauthorized', 401)
    userId = user.id
  } catch {
    return failure('Sign in again to generate captions.', 'unauthorized', 401)
  }

  const body = await readBody(request)
  if (body.error === 'too_large') return failure('This request is too large.', 'invalid_request', 413)
  if (body.error) return failure('Send a valid caption request.', 'invalid_request', 400)
  const input = validateInput(body.data)
  if (!input) return failure('Choose a picture, tone, topic, and point of view, then add up to 500 characters of context.', 'invalid_request', 400)

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  const model = 'deepseek-flash'
  if (!apiKey) {
    return failure('The caption lab is being set up. Please try again later.', 'setup_required', 503)
  }

  let uploadedImage: { scene: string; alt: string; storagePath: string } | undefined
  if (input.imageId.startsWith('upload-')) {
    try {
      const { data: image, error } = await supabase.from('caption_images')
        .select('id, owner_id, storage_path, alt, scene').eq('id', input.imageId).maybeSingle()
      if (error) return databaseFailure(error)
      if (!isRecord(image) || image.id !== input.imageId || image.owner_id !== userId
        || image.storage_path !== `${userId}/${input.imageId.slice(7)}.jpg`) {
        return failure('Choose a photo you uploaded, or upload it again.', 'invalid_image', 400)
      }
      uploadedImage = {
        scene: typeof image.scene === 'string' ? image.scene.slice(0, 1000) : '',
        alt: typeof image.alt === 'string' ? image.alt.slice(0, 300) : 'Uploaded photo',
        storagePath: image.storage_path,
      }
    } catch {
      return failure('We couldn’t load your photo. Please try again.', 'image_unavailable', 503)
    }
  }

  const systemPrompt = captionSystemPrompt(input, uploadedImage)
  let reservationData: unknown
  try {
    const { data, error } = await supabase.rpc('reserve_caption_generation_v5', {
      p_request_id: input.requestId,
      p_image_id: input.imageId,
      p_prompt: input.prompt,
      p_style: input.style,
      p_topic: input.topic,
      p_perspective: input.perspective,
      p_system_prompt: systemPrompt,
      p_model: model,
    })
    if (error) return databaseFailure(error)
    reservationData = data
  } catch {
    return databaseFailure({})
  }
  const reservation: unknown = Array.isArray(reservationData) ? reservationData[0] : null
  if (!isRecord(reservation) || typeof reservation.id !== 'string' || !UUID.test(reservation.id)
    || typeof reservation.is_new !== 'boolean') {
    return failure('We couldn’t start this generation. Please try again.', 'save_failed', 503)
  }
  const generationId = reservation.id
  if (reservation.image_id !== input.imageId || reservation.style !== input.style || reservation.prompt !== input.prompt
    || reservation.topic !== input.topic || reservation.perspective !== input.perspective) {
    return failure('This request has already been used. Start a fresh generation.', 'request_conflict', 409)
  }

  if (!reservation.is_new) {
    if (reservation.status === 'succeeded') {
      const { data, error } = await supabase.from('captions').select('id').eq('generation_id', generationId).order('position')
      if (error) return databaseFailure(error)
      const ids = captionIds(data)
      if (!ids) return failure('We couldn’t load those captions. Please try again.', 'save_failed', 503)
      return reply({ generationId, captionIds: ids })
    }
    if (reservation.status === 'failed') {
      return failure('That generation didn’t finish. Start a fresh generation to try again.', 'generation_failed', 409)
    }
    return failure('Your captions are still being generated. Wait a moment, then try again.', 'generation_pending', 409)
  }

  let imageDataUrl: string | undefined
  if (uploadedImage) {
    try {
      const { data, error } = await supabase.storage.from('caption-uploads').download(uploadedImage.storagePath)
      if (error || !data || data.size < 4 || data.size > MAX_IMAGE_BYTES) {
        await markFailed(supabase, generationId)
        return failure('We couldn’t read your photo. Upload it again and try once more.', 'invalid_image', 400)
      }
      const bytes = new Uint8Array(await data.arrayBuffer())
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff
        || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
        await markFailed(supabase, generationId)
        return failure('This photo couldn’t be read as a JPEG. Upload it again.', 'invalid_image', 400)
      }
      imageDataUrl = `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`
    } catch {
      await markFailed(supabase, generationId)
      return failure('We couldn’t load your photo. Please try again.', 'image_unavailable', 503)
    }
  }

  let captions: [string, string, string]
  try {
    captions = await generateCaptions(input, { apiKey, model, systemPrompt, imageDataUrl })
  } catch (error) {
    await markFailed(supabase, generationId)
    if (error instanceof CaptionGenerationError && error.code === 'provider_busy') {
      return failure('The caption generator is busy. Try again in a moment.', 'provider_busy', 429)
    }
    if (error instanceof CaptionGenerationError && error.code === 'timeout') {
      return failure('The caption generator took too long. Please try again.', 'generation_timeout', 504)
    }
    return failure('The caption generator couldn’t finish this round. Please try again.', 'generation_failed', 502)
  }

  try {
    const { data, error } = await supabase.rpc('complete_caption_generation_v5', {
      p_generation_id: generationId,
      p_captions: captions,
    })
    if (error) {
      await markFailed(supabase, generationId)
      return databaseFailure(error)
    }
    const ids = captionIds(data)
    if (!ids) return failure('We couldn’t load the saved captions. Please try again.', 'save_failed', 503)
    return reply({ generationId, captionIds: ids })
  } catch {
    // The database may have committed before the response was lost. The client
    // keeps this request ID so a retry retrieves the saved captions safely.
    await markFailed(supabase, generationId)
    return databaseFailure({})
  }
}
