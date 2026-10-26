import { Buffer } from 'node:buffer'
import { resolveCaptionRuntime, attachCaptionRuntime, observeCaptionCalls, type CaptionRuntime } from '@/lib/caption-runtime'
import { createClient } from '@/lib/supabase/server'
import { CAPTION_PERSPECTIVES, CAPTION_STYLES, CAPTION_TOPICS } from '@/lib/generation-options'
import {
  CAPTION_IMAGE_IDS,
  assessImageSuitability,
  CaptionGenerationError,
  captionSystemPrompt,
  generateCaptions,
  type GenerateCaptionInput,
} from '@/lib/ai-captions'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BODY_BYTES = 8 * 1024
const MAX_IMAGE_BYTES = 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function reply(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
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
  if (error.message === 'GENERATION_ATTEMPT_LIMIT_REACHED') {
    return failure('There have been too many generation attempts today. Please try again tomorrow.', 'attempt_limit', 429)
  }
  if (error.message === 'REQUEST_ID_REUSED_WITH_DIFFERENT_INPUT') {
    return failure('This request has already been used. Start a fresh generation.', 'request_conflict', 409)
  }
  if (error.message === 'GENERATION_LIMIT_REACHED') {
    return failure('You have used today’s five generations. Come back tomorrow for a fresh round.', 'daily_limit', 429)
  }
  if (error.code === '42501') return failure('Sign in again to generate captions.', 'unauthorized', 401)
  if (['PGRST202', 'PGRST204', 'PGRST205', '42703', '42883', '42P01'].includes(error.code ?? '')) {
    console.warn('[caption-generation]', 'database_setup_required')
    return failure('The caption lab is being set up. Please try again later.', 'setup_required', 503)
  }
  console.warn('[caption-generation]', 'caption_save_failed')
  return failure('We couldn’t confirm the saved captions. Please try again to check for them.', 'save_failed', 503)
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

async function withAllowance(response: Response, supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const { data, error } = await supabase.rpc('get_generation_allowance')
    if (!error && typeof data === 'number' && Number.isInteger(data) && data >= 0 && data <= 5) {
      const body: unknown = await response.clone().json()
      if (isRecord(body)) return reply({ ...body, remaining: data }, response.status)
    }
  } catch {}
  return response
}

function providerFailure(error: unknown) {
  const code = error instanceof CaptionGenerationError ? error.code : 'provider_unavailable'
  console.warn('[caption-generation]', code)
  if (code === 'telemetry_unavailable') {
    return failure('We couldn’t record this generation safely. Please try again later.', 'setup_required', 503)
  }
  if (code === 'provider_auth') {
    return failure('The AI service could not authenticate. The site owner needs to reconnect it.', 'provider_auth', 503)
  }
  if (code === 'provider_credit') {
    return failure('The AI service is out of credits. The site owner needs to top it up before captions can generate.', 'provider_credit', 402)
  }
  if (code === 'provider_busy') {
    return failure('The AI service is busy. Your scene is saved here; try again shortly.', 'provider_busy', 429)
  }
  if (code === 'timeout') {
    return failure('The AI service took too long. Please try again.', 'generation_timeout', 504)
  }
  if (code === 'provider_request') {
    return failure('The AI service could not accept this request. Please try again later.', 'provider_request', 503)
  }
  if (code === 'provider_filtered') {
    return failure('This image or prompt could not be used for captions. Try a different one.', 'content_not_supported', 422)
  }
  if (code === 'image_check_failed') {
    return failure('We couldn’t finish checking this photo. Please try again.', 'image_check_failed', 502)
  }
  if (code === 'invalid_output') {
    return failure('The AI didn’t return three usable short captions. Please try again.', 'generation_output_invalid', 502)
  }
  return failure('The AI service is temporarily unavailable. Please try again shortly.', 'provider_unavailable', 503)
}

export async function GET(request: Request) {
  let supabase: Awaited<ReturnType<typeof createClient>>
  let userId: string
  try {
    supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return failure('Sign in to check your captions.', 'unauthorized', 401)
    userId = user.id
  } catch {
    return failure('Sign in again to check your captions.', 'unauthorized', 401)
  }
  const requestId = new URL(request.url).searchParams.get('requestId')
  if (!requestId || !UUID.test(requestId)) return failure('Choose a valid generation request.', 'invalid_request', 400)
  try {
    const lookup = () => supabase.from('caption_generations').select('id, status, created_at')
      .eq('request_id', requestId).eq('user_id', userId).maybeSingle()
    let { data: generation, error } = await lookup()
    if (error) return withAllowance(failure('We couldn’t check your captions. Please try again.', 'status_unavailable', 503), supabase)
    if (!generation) return withAllowance(reply({ status: 'missing' }), supabase)
    if (generation.status === 'pending' && typeof generation.created_at === 'string'
      && Date.parse(generation.created_at) < Date.now() - 120_000) {
      // This is beyond the worker's 60-second ceiling. Completion is immutable,
      // so cleanup cannot overwrite a result that saved before the re-read.
      await markFailed(supabase, generation.id)
      const refreshed = await lookup()
      if (refreshed.error || !refreshed.data) {
        return withAllowance(failure('We couldn’t check your captions. Please try again.', 'status_unavailable', 503), supabase)
      }
      generation = refreshed.data
      error = refreshed.error
    }
    if (generation.status === 'succeeded') {
      const { data, error: captionError } = await supabase.from('captions').select('id')
        .eq('generation_id', generation.id).order('position')
      const ids = captionIds(data)
      if (captionError || !ids) {
        return withAllowance(failure('We couldn’t load your saved captions. Please try again.', 'status_unavailable', 503), supabase)
      }
      return withAllowance(reply({ status: 'succeeded', generationId: generation.id, captionIds: ids }), supabase)
    }
    if (generation.status === 'pending' || generation.status === 'failed') {
      return withAllowance(reply({ status: generation.status, generationId: generation.id }), supabase)
    }
  } catch {}
  console.warn('[caption-generation]', 'status_lookup_failed')
  return withAllowance(failure('We couldn’t check your captions. Please try again.', 'status_unavailable', 503), supabase)
}

async function existingRequest(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, input: GenerateCaptionInput): Promise<Response | null> {
  try {
    const { data: generation, error } = await supabase.from('caption_generations')
      .select('id,status,image_id,style,prompt,topic,perspective').eq('request_id', input.requestId).eq('user_id', userId).maybeSingle()
    if (error) return databaseFailure(error)
    if (!generation) return null
    if (generation.image_id !== input.imageId || generation.style !== input.style || generation.prompt !== input.prompt
      || generation.topic !== input.topic || generation.perspective !== input.perspective) {
      return failure('This request has already been used. Start a fresh generation.', 'request_conflict', 409)
    }
    if (generation.status === 'succeeded') {
      const { data, error: captionError } = await supabase.from('captions').select('id').eq('generation_id', generation.id).order('position')
      const ids = captionIds(data)
      if (captionError || !ids) return failure('We couldn’t load those captions. Check the saved result.', 'save_failed', 503)
      return reply({ generationId: generation.id, captionIds: ids })
    }
    if (generation.status === 'failed') return failure('That generation didn’t finish. Start a fresh generation to try again.', 'generation_failed', 409)
    if (generation.status === 'pending') return reply({ error: 'Your captions are still being generated. Check the saved result in a moment.', code: 'generation_pending', generationId: generation.id }, 409)
  } catch {}
  return failure('We couldn’t check your saved captions. Please try again.', 'save_failed', 503)
}

export async function POST(request: Request) {
  const requestDeadlineAt = Date.now() + 50_000
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

  const previous = await existingRequest(supabase, userId, input)
  if (previous) return withAllowance(previous, supabase)

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) {
    console.warn('[caption-generation]', 'api_key_missing')
    return failure('The AI caption service is not configured yet. Please try again later.', 'api_key_missing', 503)
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

  let runtimeConfig: CaptionRuntime
  let systemPrompt: string
  try {
    runtimeConfig = await resolveCaptionRuntime(supabase, input.style)
    if (uploadedImage && !runtimeConfig.supportsVision) throw Error('runtime_unavailable')
    let creativeContext = runtimeConfig.creativeContext
    systemPrompt = captionSystemPrompt(input, uploadedImage, creativeContext)
    for (const reference of runtimeConfig.references) {
      const next = `${creativeContext}\n${reference}`
      const candidate = captionSystemPrompt(input, uploadedImage, next)
      if (candidate.length <= 8000) { creativeContext = next; systemPrompt = candidate }
    }
    if (systemPrompt.length > 8000) throw Error('runtime_unavailable')
  } catch {
    return failure('The caption instructions are unavailable. Please try again later.', 'setup_required', 503)
  }
  const model = runtimeConfig.model
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
    if (error) {
      if (error.message === 'REQUEST_ID_REUSED_WITH_DIFFERENT_INPUT') {
        const existing = await existingRequest(supabase, userId, input)
        if (existing) return withAllowance(existing, supabase)
      }
      return withAllowance(databaseFailure(error), supabase)
    }
    reservationData = data
  } catch {
    return withAllowance(databaseFailure({}), supabase)
  }
  const reservation: unknown = Array.isArray(reservationData) ? reservationData[0] : null
  if (!isRecord(reservation) || typeof reservation.id !== 'string' || !UUID.test(reservation.id)
    || typeof reservation.is_new !== 'boolean') {
    return withAllowance(failure('We couldn’t start this generation. Please try again.', 'save_failed', 503), supabase)
  }
  const generationId = reservation.id
  if (reservation.image_id !== input.imageId || reservation.style !== input.style || reservation.prompt !== input.prompt
    || reservation.topic !== input.topic || reservation.perspective !== input.perspective) {
    return withAllowance(failure('This request has already been used. Start a fresh generation.', 'request_conflict', 409), supabase)
  }

  if (!reservation.is_new) {
    if (reservation.status === 'succeeded') {
      try {
        const { data, error } = await supabase.from('captions').select('id').eq('generation_id', generationId).order('position')
        if (error) return withAllowance(databaseFailure(error), supabase)
        const ids = captionIds(data)
        if (!ids) return withAllowance(failure('We couldn’t load those captions. Please try again.', 'save_failed', 503), supabase)
        return withAllowance(reply({ generationId, captionIds: ids }), supabase)
      } catch {
        return withAllowance(databaseFailure({}), supabase)
      }
    }
    if (reservation.status === 'failed') {
      return withAllowance(failure('That generation didn’t finish. Start a fresh generation to try again.', 'generation_failed', 409), supabase)
    }
    return withAllowance(reply({ error: 'Your captions are still being generated. Wait a moment, then try again.', code: 'generation_pending', generationId }, 409), supabase)
  }

  let generationRequestId: string
  try { generationRequestId = await attachCaptionRuntime(supabase, generationId, runtimeConfig) }
  catch {
    await markFailed(supabase, generationId)
    return withAllowance(failure('We couldn’t save the caption instructions. Please try again later.', 'setup_required', 503), supabase)
  }
  const observer = observeCaptionCalls(supabase, generationRequestId)
  let imageDataUrl: string | undefined
  if (uploadedImage) {
    try {
      const { data, error } = await supabase.storage.from('caption-uploads').download(uploadedImage.storagePath)
      if (error || !data || data.size < 4 || data.size > MAX_IMAGE_BYTES) {
        await markFailed(supabase, generationId)
        return withAllowance(failure('We couldn’t read your photo. Upload it again and try once more.', 'invalid_image', 400), supabase)
      }
      const bytes = new Uint8Array(await data.arrayBuffer())
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff
        || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
        await markFailed(supabase, generationId)
        return withAllowance(failure('This photo couldn’t be read as a JPEG. Upload it again.', 'invalid_image', 400), supabase)
      }
      imageDataUrl = `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`
    } catch {
      await markFailed(supabase, generationId)
      return withAllowance(failure('We couldn’t load your photo. Please try again.', 'image_unavailable', 503), supabase)
    }
  }

  const deadlineAt = Math.min(Date.now() + 45_000, requestDeadlineAt)
  let captions: [string, string, string]
  try {
    if (imageDataUrl) {
      const assessment = await assessImageSuitability(imageDataUrl, { apiKey, model: runtimeConfig.assessmentModel, deadlineAt, observer })
      if (!assessment.image_suitable) {
        await markFailed(supabase, generationId)
        const message = assessment.reason === 'private_information'
          ? 'This photo exposes sensitive personal information. Choose a different photo.'
          : assessment.reason === 'unclear'
            ? 'We couldn’t find a clear subject in this photo. Try a clearer picture.'
            : 'This photo isn’t suitable for friendly humor captions. Choose a different photo.'
        console.warn('[caption-generation]', 'image_not_suitable')
        return withAllowance(failure(message, 'image_not_suitable', 422), supabase)
      }
    }
    captions = await generateCaptions(input, { apiKey, model, systemPrompt, imageDataUrl, deadlineAt, observer, chainSteps: runtimeConfig.steps })
  } catch (error) {
    await markFailed(supabase, generationId)
    return withAllowance(providerFailure(error), supabase)
  }

  try {
    const { data, error } = await supabase.rpc('complete_caption_generation_v6', {
      p_generation_id: generationId,
      p_captions: captions,
    })
    if (error) {
      await markFailed(supabase, generationId)
      return withAllowance(databaseFailure(error), supabase)
    }
    const ids = captionIds(data)
    if (!ids) return withAllowance(failure('We couldn’t load the saved captions. Please try again.', 'save_failed', 503), supabase)
    return withAllowance(reply({ generationId, captionIds: ids }), supabase)
  } catch {
    // The database may have committed before the response was lost. The client
    // keeps this request ID so a retry retrieves the saved captions safely.
    await markFailed(supabase, generationId)
    return withAllowance(databaseFailure({}), supabase)
  }
}
