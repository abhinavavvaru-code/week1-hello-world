import { supabase } from '@/lib/supabase'

export default async function Home() {
  const { data: messages } = await supabase.from('messages').select()

  return (
    <ul>
      {messages?.map((m) => (
        <li key={m.id}>{m.content}</li>
      ))}
    </ul>
  )
}