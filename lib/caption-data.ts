import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Caption } from './captions'

type FeedRow = {
  id: string; content: string; image_id: string; style: string; created_at: string
  laughs: number; groans: number; my_vote: number | null; voted_at: string | null
}

export async function loadCaptions(supabase: SupabaseClient) {
  // This authenticated RPC exposes counts without exposing other members' votes.
  const { data, error } = await supabase.rpc('get_caption_feed')
  const captions: Caption[] = ((data ?? []) as FeedRow[]).map((row) => ({
    id: row.id, content: row.content, imageId: row.image_id, style: row.style,
    createdAt: row.created_at, laughs: Number(row.laughs), groans: Number(row.groans),
    myVote: Number(row.my_vote ?? 0), votedAt: row.voted_at,
  }))
  return { captions, error }
}
