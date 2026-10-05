export type Caption = {
  id: string
  content: string
  imageId: string
  style: string
  createdAt: string
  laughs: number
  groans: number
  myVote: number
  votedAt: string | null
}

export const captionImages = [
  { id: 'udp', alt: 'A paper airplane carrying a message into the unknown', category: 'Group chat energy' },
  { id: 'dark-mode', alt: 'A laptop glowing in the dark, attracting a few curious bugs', category: 'After hours' },
  { id: 'gravity', alt: 'An open book floating above a desk', category: 'Library spiral' },
  { id: 'interest', alt: 'A piggy bank beside a falling interest chart', category: 'Student budget' },
  { id: 'binary', alt: 'Two friendly robots, one and zero', category: 'Roommate logic' },
  { id: 'earth', alt: 'A happy planet Earth enjoying the sunshine', category: 'Weekend orbit' },
] as const

// The persisted image ID links every generated caption to its chosen illustration.
export function captionVisual(caption: Pick<Caption, 'imageId'>) {
  const visual = captionImages.find((item) => item.id === caption.imageId)
  return visual ? { src: `/captions/${visual.id}.svg`, alt: visual.alt, category: visual.category }
    : { src: '', alt: 'Caption illustration unavailable', category: 'AI caption' }
}
