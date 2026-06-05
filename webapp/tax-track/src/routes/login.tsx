import { createFileRoute, useLocation, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { authClient, getSessionWithRetry } from '@/lib/auth-client'
import { parseSessionContext } from '@/lib/access-control'

export const Route = createFileRoute('/login')({
  component: LoginRouteContent,
})

type LoginNavigation = ReturnType<typeof buildLoginNavigation>

type LoginCredentialsSubmission = {
  email: string
  password: string
  redirectTo: string
  signInEmail: (input: {
    email: string
    password: string
    callbackURL: string
  }) => Promise<{
    error?: {
      message?: string | null
    } | null
  }>
  refetch: () => Promise<unknown> | unknown
  getSession: () => Promise<{
    data?: {
      user?: unknown
    } | null
  }>
}

export const buildLoginNavigation = (
  mustChangePassword: boolean,
  redirectTo: string,
) =>
  mustChangePassword
    ? ({
        to: '/change-password',
        search: {
          from: redirectTo,
        },
        replace: true,
      } as const)
    : ({
        to: redirectTo,
        replace: true,
      } as const)

export const submitLoginCredentials = async ({
  email,
  password,
  redirectTo,
  signInEmail,
  refetch,
  getSession,
}: LoginCredentialsSubmission): Promise<
  | {
      errorMessage: string
      navigation?: never
    }
  | {
      errorMessage?: never
      navigation: LoginNavigation
    }
> => {
  const result = await signInEmail({
    email,
    password,
    callbackURL: redirectTo,
  })

  if (result.error) {
    return {
      errorMessage: result.error.message ?? 'Invalid email or password.',
    }
  }

  await refetch()
  const freshSession = await getSession()
  const freshContext = freshSession.data?.user
    ? parseSessionContext(freshSession.data.user)
    : null

  return {
    navigation: buildLoginNavigation(
      freshContext?.mustChangePassword ?? false,
      redirectTo,
    ),
  }
}

export function LoginRouteContent() {
  const navigate = useNavigate()
  const location = useLocation()
  const { data: session, isPending, refetch } = authClient.useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const searchParams = new URLSearchParams(location.search)
  const requestedPath = searchParams.get('from')
  const loggedOut = searchParams.get('loggedOut') === '1'
  const redirectTo = requestedPath?.startsWith('/') ? requestedPath : '/dashboard'
  const sessionContext = session?.user ? parseSessionContext(session.user) : null
  const contextMustChangePassword = sessionContext?.mustChangePassword
  const contextUserId = sessionContext?.userId

  useEffect(() => {
    if (!isPending && sessionContext) {
      void navigate(
        buildLoginNavigation(sessionContext.mustChangePassword, redirectTo),
      )
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
      const result = await submitLoginCredentials({
        email,
        password,
        redirectTo,
        signInEmail: authClient.signIn.email,
        refetch,
        getSession: getSessionWithRetry,
      })

      if (result.errorMessage) {
        setErrorMessage(result.errorMessage)
        return
      }

      void navigate(result.navigation)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <LoginPage
      email={email}
      password={password}
      errorMessage={errorMessage}
      isPending={isPending}
      isSubmitting={isSubmitting}
      loggedOut={loggedOut}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onSubmit={handleSubmit}
    />
  )
}

export function LoginPage({
  email,
  password,
  errorMessage,
  isPending,
  isSubmitting,
  loggedOut,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: {
  email: string
  password: string
  errorMessage: string
  isPending: boolean
  isSubmitting: boolean
  loggedOut: boolean
  onEmailChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <main className="flex min-h-svh bg-background px-6 py-10 text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col justify-center gap-10 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] lg:items-center lg:gap-16">
        <section className="flex max-w-xl flex-col gap-6">
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-primary">TaxTrack</p>
            <div className="flex flex-col gap-2">
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                TaxTrack
              </h1>
              <p className="max-w-md text-base text-muted-foreground">
                BIR 2307 compliance workspace
              </p>
            </div>
          </div>
          <div className="flex w-fit items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
            <span className="size-2 rounded-full bg-primary" />
            <span>Secure access required</span>
          </div>
        </section>

        <Card className="w-full">
          <CardHeader className="flex flex-col gap-2">
            <CardTitle className="text-2xl">Sign in to TaxTrack</CardTitle>
            <CardDescription>
              Use your email and password to continue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    id="email"
                    autoComplete="email"
                    type="email"
                    value={email}
                    onChange={(event) => onEmailChange(event.target.value)}
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
                    onChange={(event) => onPasswordChange(event.target.value)}
                    required
                  />
                </Field>
                {errorMessage ? (
                  <Alert variant="destructive">
                    <AlertDescription>{errorMessage}</AlertDescription>
                  </Alert>
                ) : null}
                {loggedOut && !errorMessage ? (
                  <Alert>
                    <AlertDescription>
                      You have been signed out.
                    </AlertDescription>
                  </Alert>
                ) : null}
                <Field>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isSubmitting || isPending}
                  >
                    {isSubmitting ? 'Signing in...' : 'Sign in'}
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
