export type Caption = {
  id: number
  content: string
  laughs: number
  groans: number
  myVote: number
  votedAt: string | null
}

const visuals = [
  { match: /udp|packet/i, file: 'udp', alt: 'A paper airplane carrying a message into the unknown', category: 'Lost in transmission' },
  { match: /dark mode|bugs/i, file: 'dark-mode', alt: 'A laptop glowing in the dark, attracting a few curious bugs', category: 'After hours' },
  { match: /gravity|book/i, file: 'gravity', alt: 'An open book floating above a desk', category: 'Light reading' },
  { match: /bank|interest/i, file: 'interest', alt: 'A piggy bank beside a falling interest chart', category: 'Funny business' },
  { match: /binary|10 kinds/i, file: 'binary', alt: 'Two friendly robots, one and zero', category: 'Inside joke' },
  { match: /earth|rotation/i, file: 'earth', alt: 'A happy planet Earth enjoying the sunshine', category: 'Daily rotation' },
]

// Presentation only: messages and votes still come from the existing database.
// Replace this adapter with each caption's image relation in Assignment 4.
export function captionVisual(caption: Pick<Caption, 'id' | 'content'>) {
  const visual = visuals.find((item) => item.match.test(caption.content))
    ?? visuals[Math.abs(caption.id) % visuals.length]
  return { src: `/captions/${visual.file}.svg`, alt: visual.alt, category: visual.category }
}
