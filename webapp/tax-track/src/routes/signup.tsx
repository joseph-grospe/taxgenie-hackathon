import { createFileRoute, redirect } from '@tanstack/react-router'

import { AppShell } from '@/components/app-shell'

export const Route = createFileRoute('/signup')({
  beforeLoad: ({ location }) => {
    const from = new URLSearchParams(location.search).get('from')

    throw redirect({
      to: '/login',
      search: {
        ...(from ? { from } : {}),
      },
    })
  },
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <AppShell title="Sign up disabled">
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">
          Sign up is disabled. Use an admin-provisioned account.
        </p>
      </div>
    </AppShell>
  )
}
