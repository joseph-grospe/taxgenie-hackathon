import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { authClient, getSessionWithRetry } from '@/lib/auth-client'
import { parseSessionContext } from '@/lib/access-control'
import { createFileRoute, useLocation, useNavigate } from '@tanstack/react-router'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/login')({
  component: RouteComponent,
})

function RouteComponent() {
  const navigate = useNavigate()
  const location = useLocation()
  const { data: session, isPending, refetch } = authClient.useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const searchParams = new URLSearchParams(location.search)
  const requestedPath = searchParams.get('from')
  const redirectTo = requestedPath?.startsWith('/') ? requestedPath : '/dashboard'
  const sessionContext = session?.user ? parseSessionContext(session.user) : null
  const contextMustChangePassword = sessionContext?.mustChangePassword
  const contextUserId = sessionContext?.userId

  useEffect(() => {
    if (!isPending && sessionContext) {
      void navigate({
        to: sessionContext.mustChangePassword ? '/change-password' : redirectTo,
        search: sessionContext.mustChangePassword
          ? {
              from: redirectTo,
            }
          : undefined,
        replace: true,
      })
    }
  }, [
    isPending,
    navigate,
    redirectTo,
    contextMustChangePassword,
    contextUserId,
  ])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage('')
    setIsSubmitting(true)
    try {
      const result = await authClient.signIn.email({
        email,
        password,
        callbackURL: redirectTo,
      })

      if (result.error) {
        setErrorMessage(result.error.message ?? 'Invalid email or password.')
        return
      }

      await refetch()
      const freshSession = await getSessionWithRetry()
      const freshContext = freshSession.data?.user
        ? parseSessionContext(freshSession.data.user)
        : null
      const destination = freshContext?.mustChangePassword
        ? '/change-password'
        : redirectTo

      void navigate({
        to: destination,
        search:
          destination === '/change-password'
            ? {
                from: redirectTo,
              }
            : undefined,
        replace: true,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-6 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2">
          <CardTitle className="text-2xl">Sign in</CardTitle>
          <CardDescription>
            Use your email and password to access TaxTrack.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  autoComplete="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  autoComplete="current-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </Field>
              {errorMessage ? (
                <FieldDescription className="text-destructive">
                  {errorMessage}
                </FieldDescription>
              ) : null}
              <Field>
                <Button type="submit" disabled={isSubmitting || isPending}>
                  {isSubmitting ? 'Signing in...' : 'Sign in'}
                </Button>
                {/* <FieldDescription className="text-center">
                  No account yet? <Link to="/signup">Create one</Link>
                </FieldDescription> */}
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
