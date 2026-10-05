import type { SupabaseClient } from '@supabase/supabase-js'
import type { Caption } from './captions'

type MessageRow = {
  id: number
  content: string
  votes: { user_id: string; value: number; created_at: string }[] | null
}

export async function loadCaptions(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from('messages')
    .select('id, content, votes(user_id, value, created_at)')
    .order('id', { ascending: false })

  const captions: Caption[] = ((data ?? []) as unknown as MessageRow[]).map((row) => {
    const votes = row.votes ?? []
    const mine = votes.find((vote) => vote.user_id === userId)
    return {
      id: row.id,
      content: row.content,
      laughs: votes.filter((vote) => vote.value === 1).length,
      groans: votes.filter((vote) => vote.value === -1).length,
      myVote: mine?.value ?? 0,
      votedAt: mine?.created_at ?? null,
    }
  })
  return { captions, error }
}
