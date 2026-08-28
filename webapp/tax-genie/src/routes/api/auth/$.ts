import { createFileRoute } from '@tanstack/react-router'
const authHandler = async ({ request }: { request: Request }) => {
  if (import.meta.env.SSR) {
    const { auth, ensureSeedAdminUser } = await import('@/lib/auth-server')
    await ensureSeedAdminUser()
    return auth.handler(request)
  }

  return new Response('Not supported', { status: 500 })
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: authHandler,
      POST: authHandler,
    },
  },
})
