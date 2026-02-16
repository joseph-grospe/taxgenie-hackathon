import { createFileRoute } from '@tanstack/react-router'
import { IconShieldCheck, IconSparkles } from '@tabler/icons-react'
import { LoginForm } from '@/components/login-form'

export const Route = createFileRoute('/login')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <div className="relative min-h-svh overflow-hidden bg-neutral-950 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.25),_transparent_60%),radial-gradient(circle_at_bottom_right,_rgba(251,191,36,0.2),_transparent_55%)]" />
      <div className="relative grid min-h-svh grid-cols-1 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="flex flex-col justify-between p-8 lg:p-12">
          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.4em] text-emerald-200/70">
            <IconShieldCheck className="size-5" />
            TaxTrack
          </div>
          <div className="max-w-xl space-y-6">
            <h1 className="text-3xl font-semibold leading-tight">
              BIR 2307 automation with audit-grade confidence.
            </h1>
            <p className="text-sm text-emerald-100/70">
              Track extraction, validation, and reconciliation in one secure
              workspace built for revenue teams.
            </p>
            <div className="grid gap-3 text-xs text-emerald-100/60 sm:grid-cols-2">
              <div className="rounded-2xl border border-emerald-400/20 bg-white/5 p-4">
                <p className="text-[0.6rem] uppercase tracking-[0.3em]">
                  Compliance
                </p>
                <p className="mt-2 text-sm text-white">Immutable audit trail</p>
              </div>
              <div className="rounded-2xl border border-amber-300/20 bg-white/5 p-4">
                <p className="text-[0.6rem] uppercase tracking-[0.3em]">
                  Speed
                </p>
                <p className="mt-2 text-sm text-white">
                  Queue → report in minutes
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-emerald-100/60">
            <IconSparkles className="size-4" />
            Live status updates powered by ElectricSQL.
          </div>
        </div>
        <div className="flex items-center justify-center bg-white/4 p-8">
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-white/95 p-6 text-foreground shadow-2xl">
            <div className="mb-6 space-y-1">
              <p className="text-[0.6rem] uppercase tracking-[0.4em] text-muted-foreground">
                Secure sign-in
              </p>
              <h2 className="text-xl font-semibold">Welcome back</h2>
              <p className="text-sm text-muted-foreground">
                Access your BIR 2307 operations workspace.
              </p>
            </div>
            <LoginForm />
          </div>
        </div>
      </div>
    </div>
  )
}
