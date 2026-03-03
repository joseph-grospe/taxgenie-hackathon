import { HeadContent, Scripts, createRootRoute, redirect } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import appCss from '../styles.css?url'
import { authClient } from '@/lib/auth-client'
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

    const sessionResponse = await authClient.getSession()
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
