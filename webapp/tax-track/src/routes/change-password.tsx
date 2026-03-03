import { type FormEvent, useEffect, useState } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { createFileRoute } from '@tanstack/react-router'

import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { authClient } from '@/lib/auth-client'
import { parseSessionContext } from '@/lib/access-control'
import { passwordPolicy, passwordSchema } from '@/lib/users-module'

export const Route = createFileRoute('/change-password')({
  component: RouteComponent,
})

function RouteComponent() {
  const navigate = useNavigate()
  const location = useLocation()
  const { data: session, isPending, refetch } = authClient.useSession()
  const searchParams = new URLSearchParams(location.search)
  const from = searchParams.get('from') ?? '/dashboard'
  const destination = from.startsWith('/') ? from : '/dashboard'
  const context = session?.user ? parseSessionContext(session.user) : null

  useEffect(() => {
    if (!isPending && context && !context.mustChangePassword) {
      void navigate({
        to: destination,
        replace: true,
      })
    }
  }, [isPending, context?.mustChangePassword, context?.userId, destination, navigate])

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState('')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage('')

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
      setMessage(parsedPassword.error.issues[0]?.message ?? passwordPolicy.message)
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

      await refetch()
      void navigate({
        to: destination,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AppShell title="Change Password" subtitle="Set a new password for your account">
      <div className="mx-auto w-full max-w-md">
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="current-password">Current password</FieldLabel>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
              <FieldDescription>
                Use 12+ chars with upper, lower, number, and symbol.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </Field>
            {message ? <FieldDescription className="text-destructive">{message}</FieldDescription> : null}
            <Field>
              <Button type="submit" disabled={isSubmitting || !session?.user}>
                {isSubmitting ? 'Updating...' : 'Update password'}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </div>
    </AppShell>
  )
}
