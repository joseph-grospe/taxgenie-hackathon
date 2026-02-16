import { createFileRoute } from '@tanstack/react-router'
import {
  IconDownload,
  IconFileDescription,
  IconNotes,
  IconShieldExclamation,
} from '@tabler/icons-react'

import { AppShell } from '@/components/app-shell'
import { StatusPill } from '@/components/status-pill'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { errorDetail } from '@/data/mock-data'

export const Route = createFileRoute('/error-detail')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <AppShell
      title="Error Detail"
      subtitle="Review and annotate failed extraction"
      actions={
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline">
            <IconDownload className="size-4" />
            Download file
          </Button>
          <Button size="sm">
            <IconNotes className="size-4" />
            Save notes
          </Button>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <Card className="min-h-[480px] overflow-hidden">
          <CardHeader>
            <CardTitle>Document preview</CardTitle>
            <CardDescription>{errorDetail.fileName}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-[380px] flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-emerald-500/30 bg-gradient-to-b from-emerald-500/5 to-transparent">
              <div className="rounded-2xl border border-emerald-500/30 bg-white/80 p-4 text-emerald-700">
                <IconFileDescription className="size-6" />
              </div>
              <p className="text-sm text-muted-foreground">
                PDF preview placeholder
              </p>
              <Badge variant="outline">{errorDetail.documentId}</Badge>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Extraction summary</CardTitle>
              <CardDescription>
                Missing fields detected during validation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status="Error" />
                <Badge variant="outline">
                  Confidence {errorDetail.confidence}
                </Badge>
              </div>
              <div className="space-y-2 text-sm">
                <p>
                  <span className="text-muted-foreground">Payor:</span>{' '}
                  {errorDetail.payor}
                </p>
                <p>
                  <span className="text-muted-foreground">Payee:</span>{' '}
                  {errorDetail.payee}
                </p>
                <p>
                  <span className="text-muted-foreground">ATC:</span>{' '}
                  {errorDetail.atc}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Validation failures</CardTitle>
              <CardDescription>
                Reasons the document is blocked.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {errorDetail.issues.map((issue) => (
                <div
                  key={issue}
                  className="flex items-center gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm"
                >
                  <IconShieldExclamation className="size-4 text-rose-600" />
                  {issue}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Extracted fields</CardTitle>
          <CardDescription>
            Review the extracted values and confidence.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {errorDetail.fields.map((field) => (
            <div
              key={field.label}
              className="rounded-2xl border border-border/60 bg-muted/40 p-4"
            >
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                {field.label}
              </p>
              <p className="mt-2 text-sm font-semibold">{field.value}</p>
              <p className="text-xs text-muted-foreground">
                Confidence {field.confidence}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reviewer notes</CardTitle>
          <CardDescription>
            Add context for manual follow-up and audit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={4}
            placeholder="Add investigation notes, outreach status, or correction plan."
          />
        </CardContent>
      </Card>
    </AppShell>
  )
}
