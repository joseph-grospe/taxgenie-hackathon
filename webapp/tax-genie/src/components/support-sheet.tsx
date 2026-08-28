import { HelpCircleIcon, MailIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { Button, buttonVariants } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

export const SUPPORT_EMAIL = 'dev@baconsolutions.ph'

const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
  'TaxGenie support request',
)}`

function SupportSheetTrigger({ compact = false }: { compact?: boolean }) {
  return compact ? (
    <SheetTrigger
      render={
        <Button
          size="icon-sm"
          variant="outline"
          className="md:hidden"
          aria-label="Open support"
        />
      }
    >
      <HugeiconsIcon icon={HelpCircleIcon} strokeWidth={2} />
    </SheetTrigger>
  ) : (
    <SheetTrigger
      render={
        <Button size="sm" variant="outline" className="hidden md:inline-flex" />
      }
    >
      <HugeiconsIcon
        icon={HelpCircleIcon}
        strokeWidth={2}
        data-icon="inline-start"
      />
      Support
    </SheetTrigger>
  )
}

export function SupportSheetContent() {
  return (
    <SheetContent side="right" className="overflow-y-auto">
      <SheetHeader>
        <SheetTitle>Support</SheetTitle>
        <SheetDescription>
          Send the details needed to diagnose upload, validation,
          reconciliation, signing, or export issues.
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-4 px-6 pb-6">
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-primary">
              <HugeiconsIcon icon={HelpCircleIcon} strokeWidth={2} />
            </span>
            <div>
              <p className="text-sm font-medium">What to include</p>
              <ul className="mt-2 list-disc pl-4 text-xs leading-5 text-muted-foreground">
                <li>The page where the issue happened.</li>
                <li>Relevant batch ID or document ID.</li>
                <li>A short summary of what you expected and what happened.</li>
                <li>Any visible error message or failed action.</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-background p-3">
          <p className="text-sm font-medium">Contact</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Email TaxGenie support at{' '}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </div>
      </div>

      <SheetFooter>
        <a
          href={SUPPORT_MAILTO}
          className={cn(buttonVariants(), 'w-full sm:w-auto')}
        >
          <HugeiconsIcon
            icon={MailIcon}
            strokeWidth={2}
            data-icon="inline-start"
          />
          Email support
        </a>
        <SheetClose render={<Button variant="outline" />}>Close</SheetClose>
      </SheetFooter>
    </SheetContent>
  )
}

export function SupportSheet({
  open,
  onOpenChange,
  showTrigger = true,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  showTrigger?: boolean
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {showTrigger ? (
        <>
          <SupportSheetTrigger compact />
          <SupportSheetTrigger />
        </>
      ) : null}
      <SupportSheetContent />
    </Sheet>
  )
}
