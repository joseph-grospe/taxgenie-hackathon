import {
  createFileRoute,
  useLocation,
  useNavigate,
} from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/password-input'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { authClient, getSessionWithRetry } from '@/lib/auth-client'
import { parseSessionContext } from '@/lib/access-control'
import { passwordPolicy, passwordSchema } from '@/lib/users-module'

export const Route = createFileRoute('/change-password')({
  component: RouteComponent,
})

function RouteComponent() {
  const navigate = useNavigate()
  const location = useLocation()
  const { data: session, isPending } = authClient.useSession()
  const searchParams = new URLSearchParams(location.search)
  const from = searchParams.get('from') ?? '/dashboard'
  const isAccountChange = searchParams.get('mode') === 'account'
  const destination = from.startsWith('/') ? from : '/dashboard'
  const context = session?.user ? parseSessionContext(session.user) : null

  useEffect(() => {
    if (
      !isPending &&
      context &&
      !context.mustChangePassword &&
      !isAccountChange
    ) {
      void navigate({
        to: destination,
        replace: true,
      })
    }
  }, [
    isPending,
    isAccountChange,
    context?.mustChangePassword,
    context?.userId,
    destination,
    navigate,
  ])

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isCurrentPasswordVisible, setIsCurrentPasswordVisible] =
    useState(false)
  const [isNewPasswordVisible, setIsNewPasswordVisible] = useState(false)
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] =
    useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState<'error' | 'info'>('error')
  const [recoveryDestination, setRecoveryDestination] = useState<string | null>(
    null,
  )

  const finalizePasswordChange = async () => {
    const freshSession = await getSessionWithRetry(
      {
        query: {
          disableCookieCache: true,
        },
      },
      {
        attempts: 3,
        delayMs: 250,
      },
    )
    const freshContext = freshSession.data?.user
      ? parseSessionContext(freshSession.data.user)
      : null

    if (freshContext?.mustChangePassword) {
      throw new Error('Session refresh is still pending.')
    }

    window.location.replace(destination)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage('')
    setMessageTone('error')
    setRecoveryDestination(null)

    if (!currentPassword.trim()) {
      setMessage('Current password is required.')
      return
    }

    if (newPassword === currentPassword) {
      setMessage('New password must be different from your current password.')
      return
    }

    if (newPassword !== confirmPassword) {
      setMessage('Password confirmation does not match.')
      return
    }

    const parsedPassword = passwordSchema.safeParse(newPassword)
    if (!parsedPassword.success) {
      setMessage(
        parsedPassword.error.issues[0]?.message ?? passwordPolicy.message,
      )
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch('/api/users/change-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })

      const payload = (await response.json().catch(() => ({
        error: 'Password change failed. Please try again.',
      }))) as {
        error?: string
        mustChangePassword?: boolean
      }

      if (!response.ok) {
        setMessage(payload.error ?? 'Unable to change password.')
        return
      }

      setMessageTone('info')
      setMessage('Password updated. Loading your account...')
      await finalizePasswordChange()
    } catch (error) {
      setRecoveryDestination(destination)
      setMessageTone('info')
      setMessage(
        'Password updated, but we could not finish loading your account. Retry continue or sign in again.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AppShell
      title="Change Password"
      subtitle={
        isAccountChange
          ? 'Update the password for your account'
          : 'Set a new password for your account'
      }
    >
      <div className="mx-auto w-full max-w-md">
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="current-password">
                Current password
              </FieldLabel>
              <PasswordInput
                id="current-password"
                isVisible={isCurrentPasswordVisible}
                onVisibilityChange={setIsCurrentPasswordVisible}
                visibilityLabel="current password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                disabled={isSubmitting || !!recoveryDestination}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <PasswordInput
                id="new-password"
                isVisible={isNewPasswordVisible}
                onVisibilityChange={setIsNewPasswordVisible}
                visibilityLabel="new password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                disabled={isSubmitting || !!recoveryDestination}
                required
              />
              <FieldDescription>
                Use 12+ chars with upper, lower, number, and symbol.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="confirm-password">
                Confirm password
              </FieldLabel>
              <PasswordInput
                id="confirm-password"
                isVisible={isConfirmPasswordVisible}
                onVisibilityChange={setIsConfirmPasswordVisible}
                visibilityLabel="confirm password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={isSubmitting || !!recoveryDestination}
                required
              />
            </Field>
            {message ? (
              <FieldDescription
                className={
                  messageTone === 'error'
                    ? 'text-destructive'
                    : 'text-muted-foreground'
                }
              >
                {message}
              </FieldDescription>
            ) : null}
            <Field>
              <div className="flex flex-wrap gap-3">
                <Button
                  type="submit"
                  disabled={
                    isSubmitting || !session?.user || !!recoveryDestination
                  }
                >
                  {isSubmitting ? 'Updating...' : 'Update password'}
                </Button>
                {recoveryDestination ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        void finalizePasswordChange().catch(() => {
                          setMessageTone('info')
                          setMessage(
                            'Retry failed. Use sign in again if the page still does not load.',
                          )
                        })
                      }}
                    >
                      Retry continue
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        window.location.assign('/login')
                      }}
                    >
                      Sign in again
                    </Button>
                  </>
                ) : null}
              </div>
            </Field>
          </FieldGroup>
        </form>
      </div>
    </AppShell>
  )
}
