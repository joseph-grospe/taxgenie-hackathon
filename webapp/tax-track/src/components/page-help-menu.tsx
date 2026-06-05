import {
  HelpCircleIcon,
  MailIcon,
  Route01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { SupportSheetContent } from '@/components/support-sheet'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetTrigger } from '@/components/ui/sheet'

export type PageHelpTourAction = {
  label?: string
  onStartTour: () => void
}

export function PageHelpMenu({
  showSupportAction = true,
  tourAction,
}: {
  showSupportAction?: boolean
  tourAction?: PageHelpTourAction
}) {
  if (!tourAction && !showSupportAction) {
    return null
  }

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            className="md:hidden"
            aria-label="Open help"
          />
        }
      >
        <HugeiconsIcon icon={HelpCircleIcon} strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="hidden md:inline-flex"
          />
        }
      >
        <HugeiconsIcon
          icon={HelpCircleIcon}
          strokeWidth={2}
          data-icon="inline-start"
        />
        Help
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {tourAction ? (
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={tourAction.onStartTour}>
              <HugeiconsIcon icon={Route01Icon} strokeWidth={2} />
              <span>{tourAction.label ?? 'Guide me through this page'}</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        ) : null}
        {tourAction && showSupportAction ? <DropdownMenuSeparator /> : null}
        {showSupportAction ? (
          <DropdownMenuGroup>
            <SheetTrigger nativeButton={false} render={<DropdownMenuItem />}>
              <HugeiconsIcon icon={MailIcon} strokeWidth={2} />
              <span>Contact support</span>
            </SheetTrigger>
          </DropdownMenuGroup>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return showSupportAction ? (
    <Sheet>
      {menu}
      <SupportSheetContent />
    </Sheet>
  ) : (
    menu
  )
}
