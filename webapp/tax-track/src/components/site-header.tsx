import type { ReactNode } from 'react'

import type { PageHelpTourAction } from '@/components/page-help-menu'
import { PageHelpMenu } from '@/components/page-help-menu'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { getProductTourTargetProps } from '@/lib/product-tours'

export type SiteHeaderTourTargets = {
  actions?: string
  entityScope?: string
  help?: string
  leadingActions?: string
  sidebarTrigger?: string
  title?: string
}

const getOptionalTourTargetProps = (targetId?: string) =>
  targetId ? getProductTourTargetProps(targetId) : {}

export function SiteHeader({
  title = 'Documents',
  subtitle,
  leadingActions,
  entityScope,
  actions,
  pageHelp,
  showSupportAction = true,
  tourTargets,
}: {
  title?: string
  subtitle?: string
  leadingActions?: ReactNode
  entityScope?: ReactNode
  actions?: ReactNode
  pageHelp?: PageHelpTourAction
  showSupportAction?: boolean
  tourTargets?: SiteHeaderTourTargets
}) {
  const hasHelpMenu = Boolean(pageHelp || showSupportAction)

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger
          className="-ml-1"
          {...getOptionalTourTargetProps(tourTargets?.sidebarTrigger)}
        />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        {leadingActions ? (
          <div
            className="flex items-center gap-2"
            {...getOptionalTourTargetProps(tourTargets?.leadingActions)}
          >
            {leadingActions}
          </div>
        ) : null}
        <div
          className="flex flex-col leading-tight"
          {...getOptionalTourTargetProps(tourTargets?.title)}
        >
          <span className="text-[0.6rem] uppercase tracking-[0.38em] text-muted-foreground">
            TaxTrack
          </span>
          <h1 className="text-sm font-semibold tracking-wide">{title}</h1>
          {subtitle ? (
            <span className="text-xs text-muted-foreground">{subtitle}</span>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {entityScope ? (
            <div
              className="flex items-center"
              {...getOptionalTourTargetProps(tourTargets?.entityScope)}
            >
              {entityScope}
            </div>
          ) : null}
          {actions ? (
            <div
              className="flex items-center gap-2"
              {...getOptionalTourTargetProps(tourTargets?.actions)}
            >
              {actions}
            </div>
          ) : null}
          {hasHelpMenu ? (
            <div
              className="flex items-center"
              {...getOptionalTourTargetProps(tourTargets?.help)}
            >
              <PageHelpMenu
                tourAction={pageHelp}
                showSupportAction={showSupportAction}
              />
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
