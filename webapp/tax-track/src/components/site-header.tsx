import type { ReactNode } from 'react'

import { SupportSheet } from '@/components/support-sheet'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

export function SiteHeader({
  title = 'Documents',
  subtitle,
  leadingActions,
  actions,
  showSupportAction = true,
}: {
  title?: string
  subtitle?: string
  leadingActions?: ReactNode
  actions?: ReactNode
  showSupportAction?: boolean
}) {
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        {leadingActions ? (
          <div className="flex items-center gap-2">{leadingActions}</div>
        ) : null}
        <div className="flex flex-col leading-tight">
          <span className="text-[0.6rem] uppercase tracking-[0.38em] text-muted-foreground">
            TaxTrack
          </span>
          <h1 className="text-sm font-semibold tracking-wide">{title}</h1>
          {subtitle ? (
            <span className="text-xs text-muted-foreground">{subtitle}</span>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {actions}
          {showSupportAction ? <SupportSheet /> : null}
        </div>
      </div>
    </header>
  )
}
