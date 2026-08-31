'use client'

import * as React from 'react'
import {
  IconAlertTriangle,
  IconChecklist,
  IconCloudUpload,
  IconDashboard,
  IconDatabase,
  IconFileSpreadsheet,
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
import { productFeatures } from '@/lib/product-features'
import { BrandLogo } from '@/components/brand-logo'
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
  intake: [
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
  ],
  review: [
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
  merge: [
    {
      title: 'PDF Merge',
      url: '/merge-pdfs',
      icon: IconReportAnalytics,
    },
  ],
  governance: [
    {
      title: 'Reference Data',
      url: '/reference-data',
      icon: IconDatabase,
    },
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
                <BrandLogo size="sidebar" />
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
          label="Step 1: Intake"
          items={data.intake.filter((item) => canAccess(item.url))}
          {...getProductTourTargetProps(DASHBOARD_TOUR_TARGETS.navIntake)}
        />
        <NavMain
          label="Step 2: Review"
          items={data.review.filter((item) => canAccess(item.url))}
          {...getProductTourTargetProps(DASHBOARD_TOUR_TARGETS.navReview)}
        />
        {productFeatures.merge ? (
          <NavMain
            label="Step 3: Merge"
            items={data.merge.filter((item) => canAccess(item.url))}
            {...getProductTourTargetProps(DASHBOARD_TOUR_TARGETS.navMerge)}
          />
        ) : null}
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
