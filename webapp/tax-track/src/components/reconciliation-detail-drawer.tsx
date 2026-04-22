import { IconExternalLink, IconX } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'

import { StatusPill } from '@/components/status-pill'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { cn } from '@/lib/utils'

type ReconciliationDetailDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  subtitle?: string
  status: string
  meta: Array<{ label: string; value: string }>
  amounts: Array<{ label: string; value: string }>
  openTo?: string
}

export function ReconciliationDetailDrawer({
  open,
  onOpenChange,
  title,
  subtitle,
  status,
  meta,
  amounts,
  openTo,
}: ReconciliationDetailDrawerProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent
        className={cn(
          'data-[vaul-drawer-direction=right]:w-[min(56vw,860px)] data-[vaul-drawer-direction=right]:sm:max-w-none max-h-screen overflow-hidden',
        )}
      >
        <DrawerHeader className="flex flex-row items-start justify-between gap-4 border-b border-border/60 px-6 py-5">
          <div>
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{subtitle}</DrawerDescription>
          </div>
          <div className="flex items-center gap-2">
            {openTo ? (
              <Button size="icon-sm" variant="outline" asChild>
                <Link
                  to={openTo}
                  onClick={() => onOpenChange(false)}
                  aria-label="Open full view"
                  title="Open full view"
                >
                  <IconExternalLink className="size-4" />
                </Link>
              </Button>
            ) : null}
            <DrawerClose asChild>
              <Button size="icon" variant="ghost" aria-label="Close drawer">
                <IconX className="size-4" />
              </Button>
            </DrawerClose>
          </div>
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-6 pt-4">
          <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{title}</p>
                  {subtitle ? (
                    <p className="text-xs text-muted-foreground">{subtitle}</p>
                  ) : null}
                </div>
                <StatusPill status={status} />
              </div>

              <div className="mt-4 grid gap-2 text-sm">
                {meta.map((item) => (
                  <p key={`${item.label}-${item.value}`}>
                    <span className="text-muted-foreground">{item.label}:</span>{' '}
                    {item.value}
                  </p>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Books vs 2307</p>
                <Badge variant="outline" className="text-xs">
                  {amounts.length} fields
                </Badge>
              </div>
              <div className="mt-4 grid gap-2 text-sm">
                {amounts.map((item) => (
                  <p key={`${item.label}-${item.value}`}>
                    <span className="text-muted-foreground">{item.label}:</span>{' '}
                    {item.value}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
