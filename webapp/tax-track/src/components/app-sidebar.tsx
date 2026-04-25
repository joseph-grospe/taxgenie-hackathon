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
} from '@tabler/icons-react'

import { Link } from '@tanstack/react-router'
import { authClient } from '@/lib/auth-client'
import { canAccessPath, parseSessionContext } from '@/lib/access-control'
import { NavDocuments } from '@/components/nav-documents'
import { NavMain } from '@/components/nav-main'
import { NavSecondary } from '@/components/nav-secondary'
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
  navMain: [
    {
      title: 'Dashboard',
      url: '/dashboard',
      icon: IconDashboard,
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
  navSecondary: [
    {
      title: 'Settings',
      url: '/settings',
      icon: IconSettings,
    },
  ],
  documents: [
    {
      name: 'Upload Intake',
      url: '/upload',
      icon: IconCloudUpload,
    },
    {
      name: 'Reports',
      url: '/reports',
      icon: IconReportAnalytics,
    },
    {
      name: 'Audit Trail',
      url: '/audit',
      icon: IconFileSpreadsheet,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: session } = authClient.useSession()
  const context = session?.user ? parseSessionContext(session.user) : null
  const role = context?.role ?? 'viewer'
  const canAccess = (path: string) => canAccessPath(path, role)

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
              <Link to="/dashboard" className="flex items-center gap-2">
                <IconInnerShadowTop className="!size-5" />
                <span className="text-base font-semibold">TaxTrack</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain.filter((item) => canAccess(item.url))} />
        <NavDocuments
          items={data.documents.filter((item) => canAccess(item.url))}
        />
        <NavSecondary
          items={data.navSecondary.filter((item) => canAccess(item.url))}
          className="mt-auto"
        />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
