import { redirect } from 'next/navigation'
import { getAuth } from '@/lib/auth'
import LoginButton from './LoginButton'

export const dynamic = 'force-dynamic'

export default async function Login({ searchParams }: {
  searchParams: Promise<{ error?: string | string[] }>
}) {
  const { user } = await getAuth()
  if (user) redirect('/')

  const params = await searchParams
  return (
    <main id="main-content" className="login-page week5-login">
      <section className="login-intro" aria-label="What you can make">
        <p className="eyebrow"><span className="live-dot" /> YOUR GROUP CHAT NEEDS THIS</p>
        <h2>A photo. A punchline.<br /><span>Instant lore.</span></h2>
        <p>Turn the little moments into something worth sharing.</p>
        <div className="login-demo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/captions/interest.svg" width="720" height="480" alt="An illustrated piggy bank with a falling budget chart" />
          <p>My budget and I are seeing other people.</p><small>Example AI caption · 9 words</small>
        </div>
        <div className="login-steps"><span>01 Upload a photo</span><span>02 Find the punchline</span><span>03 Let people vote</span></div>
      </section>
      <section className="login-card" aria-labelledby="login-title">
        <p className="login-brand">PUNCHLINE · THE HUMOR PROJECT</p>
        <h1 id="login-title" className="login-title">Find your funny.</h1>
        <p className="login-description">Make memes from your photos. Find the best captions from the community.</p>
        {params.error && (
          <p className="status status-error" role="alert">We couldn&apos;t finish signing you in. Please try again.</p>
        )}
        <LoginButton />
        <p className="login-note">One Google sign-in. No profile form required.</p>
      </section>
    </main>
  )
}
