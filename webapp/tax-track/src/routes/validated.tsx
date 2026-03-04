import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { IconDownload } from '@tabler/icons-react'

import type { ValidatedRouteSearch } from '@/lib/validated-search-state'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { ValidatedDocumentsPanel } from '@/components/validated-documents-panel'
import { authClient } from '@/lib/auth-client'
import { parseValidatedSearch } from '@/lib/validated-search-state'

export const Route = createFileRoute('/validated')({
  validateSearch: (search) => parseValidatedSearch(search),
  component: RouteComponent,
})

function RouteComponent() {
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()
  const { data: session } = authClient.useSession()

  const user = session?.user as
    | {
        role?: string | null
        canExportPdf?: boolean | null
        canExportExcel?: boolean | null
      }
    | undefined

  const canExportSelected = Boolean(
    user &&
      (user.role?.toLowerCase() === 'admin' ||
        user.canExportPdf ||
        user.canExportExcel),
  )

  const updateSearch = (patch: Partial<ValidatedRouteSearch>) => {
    void navigate({
      search: (previous) => parseValidatedSearch({ ...previous, ...patch }),
      replace: true,
    })
  }

  return (
    <AppShell
      title="Validated Results"
      subtitle="Ready-to-export 2307 extractions"
      actions={
        <Button size="sm" disabled={!canExportSelected}>
          <IconDownload className="size-4" />
          Export selected
        </Button>
      }
    >
      <ValidatedDocumentsPanel search={search} onSearchChange={updateSearch} />
    </AppShell>
  )
}
