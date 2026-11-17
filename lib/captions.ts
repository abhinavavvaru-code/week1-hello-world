import { presetPhotos } from './preset-photos'

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
  authorId: string
  authorKey?: string
  authorName: string
  imageSrc: string
  imageAlt: string
  topic: string
  perspective: string
  weekUpvotes: number
  monthUpvotes: number
}

// Early weeks used AI-style illustrations. They are no longer offered or shown:
// only real photos (bundled presets and member uploads) appear on the site.
export const LEGACY_ILLUSTRATION_IDS: readonly string[] = ['udp', 'dark-mode', 'gravity', 'interest', 'binary', 'earth']

export function isRealPhotoCaption(caption: Pick<Caption, 'imageId' | 'imageSrc'>) {
  if (caption.imageSrc) return !/\.svg(?:$|[?#])/i.test(caption.imageSrc)
  return presetPhotos.some((item) => item.id === caption.imageId)
}

// The persisted image ID links every generated caption to its chosen photo.
export function captionVisual(caption: Pick<Caption, 'imageId' | 'imageSrc' | 'imageAlt'>) {
  if (caption.imageSrc) return {src:caption.imageSrc, alt:caption.imageAlt || 'A member-uploaded photo', category:'Your photo'}
  const photo = presetPhotos.find((item) => item.id === caption.imageId)
  if (photo) return { src: photo.src, alt: photo.alt, category: photo.label }
  return { src: '', alt: 'Photo unavailable', category: 'Photo' }
}

export function captionFlavor(style: string): string {
  const labels: Record<string, string> = {
    dry: 'Dry / deadpan', deadpan: 'Dry / deadpan', chaotic: 'Chaotic / absurd',
    wholesome: 'Wholesome', wordplay: 'Puns / wordplay', pun: 'Puns / wordplay',
    roast: 'Playful roast', observational: 'Observational', sarcastic: 'Sarcastic',
    surreal: 'Surreal', absurdist: 'Absurdist', dark: 'Dark humor', satire: 'Satire',
  }
  const value = style.trim().toLowerCase()
  return labels[value] || value.replace(/[_-]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase()) || 'Classic'
}
