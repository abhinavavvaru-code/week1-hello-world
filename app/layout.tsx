import type { Metadata } from 'next'
import { Bricolage_Grotesque } from 'next/font/google'
import Nav from '@/components/Nav'
import GenerationProvider from '@/components/GenerationProvider'
import './globals.css'
import './explore.css'
import './generation.css'

const bricolage = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-body' })

export const metadata: Metadata = {
  title: 'Punchline · The Humor Project',
  description: 'A picture. A punchline. Your call. Explore freely. Sign in to create and rate captions.',
}

const themeScript = `try { var t = localStorage.getItem('punchline-theme'); document.documentElement.dataset.theme = ['system','light','dark'].includes(t) ? t : 'dark'; } catch {}`

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={bricolage.variable} data-theme="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body><GenerationProvider><Nav />{children}</GenerationProvider></body>
    </html>
  )
}
