import {
  HeadContent,
  Scripts,
  createRootRoute,
  redirect,
  type ErrorComponentProps,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import { Button } from '@/components/ui/button'
import appCss from '../styles.css?url'
import { getSessionWithRetry } from '@/lib/auth-client'
import { canAccessPath, parseSessionContext } from '@/lib/access-control'

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    const pathname = location.pathname
    const returnTo = pathname

    const publicPaths = new Set(['/login', '/signup', '/change-password', '/'])
    const isPublicPath =
      publicPaths.has(pathname) ||
      pathname.startsWith('/api/') ||
      pathname.startsWith('/assets/') ||
      pathname.startsWith('/favicon')

    if (isPublicPath) {
      return
    }

    const sessionResponse = await getSessionWithRetry(undefined, {
      attempts: 3,
      delayMs: 250,
    })
    if (sessionResponse.error || !sessionResponse.data) {
      if (pathname === '/change-password') {
        return
      }

      throw redirect({
        to: '/login',
        search: {
          from: returnTo,
        },
      })
    }

    const context = parseSessionContext(sessionResponse.data.user)

    if (context.mustChangePassword && pathname !== '/change-password') {
      throw redirect({
        to: '/change-password',
        search: {
          from: returnTo,
        },
      })
    }

    if (!canAccessPath(pathname, context.role)) {
      throw redirect({
        to: '/dashboard',
      })
    }
  },
  errorComponent: RootErrorComponent,
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'TaxTrack',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),

  shellComponent: RootDocument,
})

function RootErrorComponent({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : 'Unexpected error.'
  const normalizedMessage = message.toLowerCase()
  const isFetchFailure =
    normalizedMessage.includes('fetch failed') ||
    normalizedMessage.includes('failed to fetch')

  const retry = () => {
    reset()
    window.location.reload()
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-xl rounded-xl border bg-card p-6 shadow-sm">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">We couldn&apos;t finish loading TaxTrack.</h1>
          <p className="text-sm text-muted-foreground">
            {isFetchFailure
              ? 'This can happen briefly right after sign-in or password changes. Retry once before trying again.'
              : 'An unexpected error interrupted page loading. Retry the request or return to sign in.'}
          </p>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button type="button" onClick={retry}>
            Retry
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              window.location.assign('/login')
            }}
          >
            Go to sign in
          </Button>
        </div>
        {!isFetchFailure ? (
          <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm text-destructive">{message}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
