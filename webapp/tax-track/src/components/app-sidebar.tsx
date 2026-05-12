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
  IconStack2,
} from '@tabler/icons-react'

import { Link } from '@tanstack/react-router'
import { authClient } from '@/lib/auth-client'
import { canAccessPath, parseSessionContext } from '@/lib/access-control'
import { parseDashboardSearch } from '@/lib/dashboard-period'
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
      title: 'Upload Intake',
      url: '/upload',
      icon: IconCloudUpload,
    },
    {
      title: 'Batches',
      url: '/batches',
      icon: IconStack2,
    },
    {
      title: 'Issues Queue',
      url: '/issues',
      icon: IconAlertTriangle,
    },
    {
      title: 'Validated Docs',
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
      title: 'Merge PDFs',
      url: '/merge-pdfs',
      icon: IconReportAnalytics,
    },
  ],
  governance: [
    {
      title: 'Audit Trail',
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
        />
        <NavMain
          label="Workflow"
          items={data.workflow.filter((item) => canAccess(item.url))}
        />
        <NavMain
          label="Outputs"
          items={data.outputs.filter((item) => canAccess(item.url))}
        />
        <NavMain
          label="Governance"
          items={data.governance.filter((item) => canAccess(item.url))}
          className="mt-auto"
        />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
