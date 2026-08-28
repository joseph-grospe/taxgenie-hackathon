import { useEffect } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import type { CSSProperties, ReactNode } from 'react'

import type { PageHelpTourAction } from '@/components/page-help-menu'
import type { SiteHeaderTourTargets } from '@/components/site-header'
import { AppSidebar } from '@/components/app-sidebar'
import { EntityScopeSelect } from '@/components/entity-scope-select'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { authClient } from '@/lib/auth-client'

export function AppShell({
  title,
  subtitle,
  leadingActions,
  actions,
  pageHelp,
  showSupportAction = true,
  tourTargets,
  children,
}: {
  title: string
  subtitle?: string
  leadingActions?: ReactNode
  actions?: ReactNode
  pageHelp?: PageHelpTourAction
  showSupportAction?: boolean
  tourTargets?: SiteHeaderTourTargets
  children: ReactNode
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const { data: session, isPending } = authClient.useSession()

  useEffect(() => {
    if (!isPending && !session?.user) {
      void navigate({
        to: '/login',
        search: {
          from: location.pathname,
        },
        replace: true,
      })
    }
  }, [isPending, location.pathname, location.search, session?.user, navigate])

  if (isPending || !session?.user) {
    return null
  }

  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 72)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset className="min-h-0 overflow-hidden">
        <SiteHeader
          title={title}
          subtitle={subtitle}
          leadingActions={leadingActions}
          entityScope={<EntityScopeSelect />}
          actions={actions}
          pageHelp={pageHelp}
          showSupportAction={showSupportAction}
          tourTargets={tourTargets}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col gap-6 px-4 py-6 lg:px-6">
            {children}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
