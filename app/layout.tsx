import type { Metadata } from 'next'
import { Bricolage_Grotesque } from 'next/font/google'
import Nav from '@/components/Nav'
import './globals.css'

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-body',
})

export const metadata: Metadata = {
  title: 'Punchline',
  description: 'Vote on jokes. The funniest ones rise to the top.',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={bricolage.variable}>
      <body>
        <Nav />
        {children}
      </body>
    </html>
  )
}
