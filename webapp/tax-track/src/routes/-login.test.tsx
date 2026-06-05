/* @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps, ComponentType } from 'react'

const routerMocks = vi.hoisted(() => ({
  location: {
    search: '',
  },
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: { component: ComponentType }) => config,
  lazyRouteComponent: () => () => null,
  useLocation: () => routerMocks.location,
  useNavigate: () => routerMocks.navigate,
}))

const loginModule = await import('@/routes/login')
const { LoginPage, buildLoginNavigation, submitLoginCredentials } = loginModule
type LoginPageProps = ComponentProps<typeof LoginPage>

const sessionUser = {
  id: 'user-1',
  email: 'manager@example.com',
  role: 'editor',
  team: 'tax_manager',
  canExportPdf: true,
  canExportExcel: true,
  mustChangePassword: false,
}

const renderLogin = (overrides: Partial<LoginPageProps> = {}) =>
  render(
    <LoginPage
      email=""
      password=""
      errorMessage=""
      isPending={false}
      isSubmitting={false}
      loggedOut={false}
      onEmailChange={vi.fn()}
      onPasswordChange={vi.fn()}
      onSubmit={vi.fn()}
      {...overrides}
    />,
  )

beforeEach(() => {
  routerMocks.location.search = ''
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('/login route', () => {
  it('renders the TaxTrack identity and email/password form when unauthenticated', () => {
    renderLogin()

    expect(screen.getByRole('heading', { name: 'TaxTrack' })).toBeTruthy()
    expect(screen.getByText('BIR 2307 compliance workspace')).toBeTruthy()
    expect(screen.getByText('Secure access required')).toBeTruthy()
    expect(screen.getByText('Sign in to TaxTrack')).toBeTruthy()
    expect(screen.getByLabelText('Email')).toBeTruthy()
    expect(screen.getByLabelText('Password')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  })

  it('shows the signed-out alert from the loggedOut search param', () => {
    renderLogin({ loggedOut: true })

    expect(screen.getByRole('alert').textContent).toContain(
      'You have been signed out.',
    )
  })

  it('submits credentials with the requested callback URL and exposes sign-in errors', async () => {
    const signInEmail = vi.fn().mockResolvedValue({
      error: {
        message: 'Invalid email or password.',
      },
    })
    const refetch = vi.fn()
    const getSession = vi.fn()

    const result = await submitLoginCredentials({
      email: 'manager@example.com',
      password: 'secret-password',
      redirectTo: '/upload',
      signInEmail,
      refetch,
      getSession,
    })

    expect(signInEmail).toHaveBeenCalledWith({
      email: 'manager@example.com',
      password: 'secret-password',
      callbackURL: '/upload',
    })
    expect(refetch).not.toHaveBeenCalled()
    expect(getSession).not.toHaveBeenCalled()
    expect(result).toEqual({
      errorMessage: 'Invalid email or password.',
    })

    renderLogin({ errorMessage: result.errorMessage })

    expect(screen.getByRole('alert').textContent).toContain(result.errorMessage)
  })

  it('builds the first-login change-password destination with the original from path', async () => {
    const signInEmail = vi.fn().mockResolvedValue({})
    const refetch = vi.fn()
    const getSession = vi.fn().mockResolvedValue({
      data: {
        user: {
          ...sessionUser,
          mustChangePassword: true,
        },
      },
    })

    await expect(
      submitLoginCredentials({
        email: 'manager@example.com',
        password: 'secret-password',
        redirectTo: '/upload',
        signInEmail,
        refetch,
        getSession,
      }),
    ).resolves.toEqual({
      navigation: buildLoginNavigation(true, '/upload'),
    })

    expect(refetch).toHaveBeenCalled()
    expect(getSession).toHaveBeenCalled()
    expect(buildLoginNavigation(true, '/upload')).toEqual({
      to: '/change-password',
      search: {
        from: '/upload',
      },
      replace: true,
    })
  })
})
