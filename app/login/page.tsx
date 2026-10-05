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
    <main id="main-content" className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <p className="login-brand">PUNCHLINE · THE HUMOR PROJECT</p>
        <h1 id="login-title" className="login-title">Welcome back</h1>
        <p className="login-description">Prepare to get crackd.</p>
        {params.error && (
          <p className="status status-error" role="alert">We couldn&apos;t finish signing you in. Please try again.</p>
        )}
        <LoginButton />
        <p className="login-note">Sign in to find your funny. No extra setup.</p>
      </section>
    </main>
  )
}
