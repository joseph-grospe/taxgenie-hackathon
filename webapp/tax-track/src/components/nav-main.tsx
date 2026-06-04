'use client'

import * as React from 'react'
import { Link, useMatchRoute } from '@tanstack/react-router'
import type { Icon } from '@tabler/icons-react'

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

export function NavMain({
  items,
  label,
  ...props
}: {
  label?: string
  items: Array<{
    title: string
    url: string
    icon?: Icon
    search?: Record<string, unknown>
  }>
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const matchRoute = useMatchRoute()

  if (items.length === 0) {
    return null
  }

  return (
    <SidebarGroup {...props}>
      {label ? <SidebarGroupLabel>{label}</SidebarGroupLabel> : null}
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                isActive={!!matchRoute({ to: item.url, fuzzy: true })}
                asChild
              >
                <Link
                  to={item.url}
                  search={(item.search ?? {}) as never}
                  className="flex items-center gap-2"
                >
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
