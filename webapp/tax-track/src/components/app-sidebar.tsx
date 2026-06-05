'use client'

import * as React from 'react'
import {
  IconAlertTriangle,
  IconChecklist,
  IconCloudUpload,
  IconDashboard,
  IconFileSpreadsheet,
  IconInnerShadowTop,
  IconReportAnalytics,
  IconSettings,
  IconShieldCheck,
  IconShieldExclamation,
  IconStack2,
} from '@tabler/icons-react'

import { Link } from '@tanstack/react-router'
import { authClient } from '@/lib/auth-client'
import { canAccessPath, parseSessionContext } from '@/lib/access-control'
import { parseDashboardSearch } from '@/lib/dashboard-period'
import {
  DASHBOARD_TOUR_TARGETS,
  getProductTourTargetProps,
} from '@/lib/product-tours'
import { defaultValidatedRouteSearch } from '@/lib/validated-search-state'
import { NavMain } from '@/components/nav-main'
import { NavUser } from '@/components/nav-user'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

const data = {
  overview: [
    {
      title: 'Dashboard',
      url: '/dashboard',
      icon: IconDashboard,
    },
  ],
  workflow: [
    {
      title: 'Upload',
      url: '/upload',
      icon: IconCloudUpload,
    },
    {
      title: 'Batches',
      url: '/batches',
      icon: IconStack2,
    },
    {
      title: 'Issues',
      url: '/issues',
      icon: IconAlertTriangle,
    },
    {
      title: 'Validated Results',
      url: '/validated',
      icon: IconChecklist,
    },
    {
      title: 'Reconciliation',
      url: '/reconciliation',
      icon: IconShieldCheck,
    },
  ],
  outputs: [
    {
      title: 'PDF Merge',
      url: '/merge-pdfs',
      icon: IconReportAnalytics,
    },
  ],
  governance: [
    {
      title: 'Override Requests',
      url: '/override-requests',
      icon: IconShieldExclamation,
    },
    {
      title: 'Audit Log',
      url: '/audit',
      icon: IconFileSpreadsheet,
    },
    {
      title: 'Settings',
      url: '/settings',
      icon: IconSettings,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: session } = authClient.useSession()
  const context = session?.user ? parseSessionContext(session.user) : null
  const role = context?.role ?? 'viewer'
  const canAccess = (path: string) => canAccessPath(path, role)
  const dashboardSearch = {
    ...defaultValidatedRouteSearch,
    ...parseDashboardSearch({}),
  }

  const user = {
    name: session?.user.name ?? 'User',
    email: session?.user.email ?? 'No email',
    avatar: session?.user.image ?? '',
  }

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <Link
                to="/dashboard"
                search={dashboardSearch}
                className="flex items-center gap-2"
              >
                <IconInnerShadowTop className="!size-5" />
                <span className="text-base font-semibold">TaxTrack</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain
          label="Overview"
          items={data.overview.filter((item) => canAccess(item.url))}
          {...getProductTourTargetProps(DASHBOARD_TOUR_TARGETS.navOverview)}
        />
        <NavMain
          label="Workflow"
          items={data.workflow.filter((item) => canAccess(item.url))}
          {...getProductTourTargetProps(DASHBOARD_TOUR_TARGETS.navWorkflow)}
        />
        <NavMain
          label="Exports"
          items={data.outputs.filter((item) => canAccess(item.url))}
          {...getProductTourTargetProps(DASHBOARD_TOUR_TARGETS.navOutputs)}
        />
        <NavMain
          label="Admin"
          items={data.governance.filter((item) => canAccess(item.url))}
          className="mt-auto"
          {...getProductTourTargetProps(DASHBOARD_TOUR_TARGETS.navGovernance)}
        />
      </SidebarContent>
      <SidebarFooter
        {...getProductTourTargetProps(DASHBOARD_TOUR_TARGETS.navUser)}
      >
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
