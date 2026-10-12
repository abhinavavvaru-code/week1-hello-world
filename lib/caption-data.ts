import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Caption } from './captions'

type FeedRow = {
  id: string; content: string; image_id: string; style: string; created_at: string
  laughs: number; groans: number; my_vote: number | null; voted_at: string | null
  author_id: string; author_name: string; image_src: string; image_alt: string; storage_path: string | null
  topic: string; perspective: string; week_upvotes: number; month_upvotes: number
}

export async function loadCaptions(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc('get_caption_feed_v5')
  const captions: Caption[] = ((data ?? []) as FeedRow[]).map((row) => ({
    id: row.id, content: row.content, imageId: row.image_id, style: row.style,
    createdAt: row.created_at, laughs: Number(row.laughs), groans: Number(row.groans),
    myVote: Number(row.my_vote ?? 0), votedAt: row.voted_at,
    authorId: row.author_id, authorName: row.author_name || 'Member',
    imageSrc: row.storage_path ? `/api/captions/${row.id}/image` : row.image_src,
    imageAlt: row.image_alt, topic: row.topic || 'campus', perspective: row.perspective || 'observer',
    weekUpvotes: Number(row.week_upvotes), monthUpvotes: Number(row.month_upvotes),
  }))
  return { captions, error }
}
