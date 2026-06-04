import { Link, createFileRoute } from '@tanstack/react-router'
import {
  IconBuilding,
  IconCertificate,
  IconDownload,
  IconFileTypePdf,
  IconId,
  IconKey,
  IconMail,
  IconShieldCheck,
  IconSignature,
  IconUserCheck,
  IconUserCircle,
} from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import type { ProtectedRouteKey } from '@/lib/access-control'
import type { SignatureProfileView } from '@/lib/signing-module'
import type { UserRole } from '@/lib/user-roles'

import { AppShell } from '@/components/app-shell'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  canAccessRoute,
  canExport,
  parseSessionContext,
} from '@/lib/access-control'
import { authClient } from '@/lib/auth-client'
import { teamLabels } from '@/lib/user-roles'

export const Route = createFileRoute('/account')({
  component: RouteComponent,
})

const PANEL_CARD_CLASS = 'rounded-lg border border-border/70 shadow-sm'
const PANEL_HEADER_CLASS = 'border-b border-border/70 bg-muted/10 py-4'
const SUMMARY_ITEM_CLASS =
  'flex min-h-16 items-center justify-between gap-3 rounded-lg border border-border/70 bg-background px-4 py-3'
const ICON_TILE_CLASS =
  'flex rounded-md border border-current/15 bg-current/10 p-1'
const iconTone = {
  account: 'text-primary',
  access: 'text-chart-2',
  admin: 'text-muted-foreground',
  export: 'text-chart-3',
  identity: 'text-chart-1',
  muted: 'text-muted-foreground',
  security: 'text-chart-1',
  signature: 'text-chart-4',
  warning: 'text-destructive',
} as const

const roleLabels: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
}

const routeAccessItems = [
  { label: 'Dashboard', route: 'dashboard' },
  { label: 'Upload intake', route: 'upload' },
  { label: 'Batches', route: 'batches' },
  { label: 'Merge PDFs', route: 'reports' },
  { label: 'Audit trail', route: 'audit' },
  { label: 'Settings', route: 'settings' },
] as const satisfies ReadonlyArray<{
  label: string
  route: ProtectedRouteKey
}>

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Manila',
})

type SignatureProfileStatus = 'idle' | 'loading' | 'ready' | 'error'

type SignatureProfilePayload = {
  error?: string
  profile?: SignatureProfileView | null
}

const getInitials = (name: string, email: string) => {
  const nameParts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)

  if (nameParts.length > 0) {
    return nameParts
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('')
  }

  return email.slice(0, 2).toUpperCase() || 'TT'
}

const formatDate = (value?: string) => {
  if (!value) {
    return 'Not recorded'
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Not recorded'
    : DATE_FORMATTER.format(date)
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <dt className="flex items-center gap-2 text-muted-foreground">{label}</dt>
      <dd className="max-w-[55%] truncate text-right font-medium">{value}</dd>
    </div>
  )
}

function StatusBadge({
  enabled,
  enabledLabel = 'Enabled',
  disabledLabel = 'Disabled',
}: {
  enabled: boolean
  enabledLabel?: string
  disabledLabel?: string
}) {
  return (
    <Badge variant={enabled ? 'secondary' : 'outline'}>
      {enabled ? enabledLabel : disabledLabel}
    </Badge>
  )
}

function AccessItem({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className={SUMMARY_ITEM_CLASS}>
      <span className="truncate text-sm font-medium">{label}</span>
      <StatusBadge
        enabled={enabled}
        enabledLabel="Allowed"
        disabledLabel="No access"
      />
    </div>
  )
}

function IconTile({
  children,
  tone,
}: {
  children: ReactNode
  tone: (typeof iconTone)[keyof typeof iconTone]
}) {
  return <span className={`${ICON_TILE_CLASS} ${tone}`}>{children}</span>
}

function SignatureProfilePanel({
  profile,
  status,
}: {
  profile: SignatureProfileView | null
  status: SignatureProfileStatus
}) {
  return (
    <Card size="sm" className={PANEL_CARD_CLASS}>
      <CardHeader className={PANEL_HEADER_CLASS}>
        <CardTitle className="flex items-center gap-2 text-sm">
          <IconTile tone={iconTone.signature}>
            <IconSignature />
          </IconTile>
          Signing profile
        </CardTitle>
        <CardDescription>Saved certificate signing identity.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {status === 'loading' ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-24 w-full rounded-md" />
          </div>
        ) : profile ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {profile.displayName}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {profile.designation}
                </div>
              </div>
              <Badge variant="secondary">Ready</Badge>
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
              <img
                src={profile.signatureImageUrl}
                alt={`${profile.displayName} signature`}
                className="mx-auto max-h-24 max-w-full object-contain"
              />
            </div>
            <dl className="flex flex-col gap-3">
              <DetailRow label="TIN" value={profile.tin} />
              <DetailRow
                label="Updated"
                value={formatDate(profile.updatedAt)}
              />
            </dl>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Not set</div>
                <div className="text-xs text-muted-foreground">
                  Add this during certificate signing.
                </div>
              </div>
              <Badge variant={status === 'error' ? 'destructive' : 'outline'}>
                {status === 'error' ? 'Unavailable' : 'Pending'}
              </Badge>
            </div>
            <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center">
              <IconSignature className={`mx-auto ${iconTone.signature}`} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function RouteComponent() {
  const { data: session } = authClient.useSession()
  const user = session?.user
  const context = user ? parseSessionContext(user) : null
  const [signatureProfile, setSignatureProfile] =
    useState<SignatureProfileView | null>(null)
  const [signatureProfileStatus, setSignatureProfileStatus] =
    useState<SignatureProfileStatus>('idle')

  const userId = context?.userId ?? ''

  useEffect(() => {
    if (!userId) {
      return
    }

    const controller = new AbortController()

    setSignatureProfileStatus('loading')
    void fetch('/api/users/me/signature-profile', {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as
          | SignatureProfilePayload
          | undefined

        if (!response.ok || payload?.error) {
          throw new Error(payload?.error ?? 'Unable to load signature profile.')
        }

        setSignatureProfile(payload?.profile ?? null)
        setSignatureProfileStatus('ready')
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        setSignatureProfile(null)
        setSignatureProfileStatus('error')
      })

    return () => {
      controller.abort()
    }
  }, [userId])

  if (!user || !context) {
    return null
  }

  const name = user.name
  const email = user.email
  const initials = getInitials(name, email)
  const roleLabel = roleLabels[context.role]
  const teamLabel = teamLabels[context.team]
  const canExportPdf = canExport.pdf(context.role, context.canExportPdf)
  const canExportExcel = canExport.excel(context.role, context.canExportExcel)
  const accessItems = [
    ...routeAccessItems.map((item) => ({
      enabled: canAccessRoute(item.route, context.role),
      label: item.label,
    })),
    {
      enabled: canExportPdf,
      label: 'PDF export',
    },
    {
      enabled: canExportExcel,
      label: 'Excel export',
    },
  ]

  return (
    <AppShell
      title="Account"
      subtitle="Profile, access, and security"
      showSupportAction={false}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <Card size="sm" className={PANEL_CARD_CLASS}>
          <CardContent className="grid gap-4 py-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
            <Avatar className="size-16">
              {user.image ? <AvatarImage src={user.image} alt={name} /> : null}
              <AvatarFallback className="text-lg">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-semibold">{name}</h2>
                <Badge variant="secondary">{roleLabel}</Badge>
                <Badge variant="outline">{teamLabel}</Badge>
              </div>
              <div className="mt-1 flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                <IconMail className={iconTone.account} />
                <span className="truncate">{email}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <Badge variant="secondary">
                <IconUserCheck
                  className={iconTone.security}
                  data-icon="inline-start"
                />
                Active
              </Badge>
              <Badge
                variant={context.mustChangePassword ? 'outline' : 'secondary'}
              >
                <IconShieldCheck
                  className={
                    context.mustChangePassword
                      ? iconTone.warning
                      : iconTone.security
                  }
                  data-icon="inline-start"
                />
                {context.mustChangePassword
                  ? 'Password due'
                  : 'Password current'}
              </Badge>
              <Button
                size="sm"
                render={
                  <Link
                    to="/change-password"
                    search={{ from: '/account', mode: 'account' }}
                  />
                }
              >
                <IconKey data-icon="inline-start" />
                Change password
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.48fr)]">
          <div className="flex flex-col gap-4">
            <Card size="sm" className={PANEL_CARD_CLASS}>
              <CardHeader className={PANEL_HEADER_CLASS}>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <IconTile tone={iconTone.identity}>
                    <IconUserCircle />
                  </IconTile>
                  Profile
                </CardTitle>
                <CardDescription>
                  Identity and account assignment.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4 md:grid-cols-2">
                  <DetailRow label="Name" value={name} />
                  <DetailRow label="Email" value={email} />
                  <DetailRow label="Role" value={roleLabel} />
                  <DetailRow label="Team" value={teamLabel} />
                </dl>
              </CardContent>
              <CardFooter className="border-t border-border/70 py-3">
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <IconBuilding className={iconTone.admin} />
                  <span>
                    Role, team, email, and export changes are admin-managed.
                  </span>
                </div>
              </CardFooter>
            </Card>

            <Card size="sm" className={PANEL_CARD_CLASS}>
              <CardHeader className={PANEL_HEADER_CLASS}>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <IconTile tone={iconTone.access}>
                    <IconShieldCheck />
                  </IconTile>
                  Access matrix
                </CardTitle>
                <CardDescription>
                  Permissions from role and export grants.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {accessItems.map((item) => (
                  <AccessItem
                    key={item.label}
                    label={item.label}
                    enabled={item.enabled}
                  />
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <Card size="sm" className={PANEL_CARD_CLASS}>
              <CardHeader className={PANEL_HEADER_CLASS}>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <IconTile tone={iconTone.security}>
                    <IconKey />
                  </IconTile>
                  Security
                </CardTitle>
                <CardDescription>Current sign-in status.</CardDescription>
                <CardAction>
                  <Button
                    size="sm"
                    variant="outline"
                    render={
                      <Link
                        to="/change-password"
                        search={{ from: '/account', mode: 'account' }}
                      />
                    }
                  >
                    <IconKey data-icon="inline-start" />
                    Update
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className={SUMMARY_ITEM_CLASS}>
                  <div className="flex items-center gap-2">
                    <IconShieldCheck
                      className={
                        context.mustChangePassword
                          ? iconTone.warning
                          : iconTone.security
                      }
                    />
                    <span className="text-sm font-medium">Password</span>
                  </div>
                  <StatusBadge
                    enabled={!context.mustChangePassword}
                    enabledLabel="Current"
                    disabledLabel="Change required"
                  />
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <IconId className={iconTone.identity} />
                      Role
                    </div>
                    <div className="mt-1 truncate text-sm font-medium">
                      {roleLabel}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <IconCertificate className={iconTone.export} />
                      Exports
                    </div>
                    <div className="mt-1 truncate text-sm font-medium">
                      {canExportPdf && canExportExcel
                        ? 'PDF and Excel'
                        : canExportPdf
                          ? 'PDF'
                          : canExportExcel
                            ? 'Excel'
                            : 'None'}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <SignatureProfilePanel
              profile={signatureProfile}
              status={signatureProfileStatus}
            />

            <Card size="sm" className={PANEL_CARD_CLASS}>
              <CardHeader className={PANEL_HEADER_CLASS}>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <IconTile tone={iconTone.export}>
                    <IconDownload />
                  </IconTile>
                  Export access
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <AccessItem label="PDF export" enabled={canExportPdf} />
                <AccessItem label="Excel export" enabled={canExportExcel} />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
