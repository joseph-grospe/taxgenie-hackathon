import { IconDotsVertical, IconTrash } from '@tabler/icons-react'
import { Component } from 'react'
import type { ComponentType } from 'react'

import type { ManagedUser } from '@/lib/users-module'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type UserStatusAction = 'activate' | 'deactivate'

type SettingsUserMoreActionsProps = {
  user: ManagedUser
  isSubmitting: boolean
  triggerClassName: string
  menuContentClassName: string
  statusAction: UserStatusAction
  statusLabel: string
  statusIcon: ComponentType
  statusDisabledReason: string
  deleteDisabledReason: string
  onStatusChange: (userId: string, action: UserStatusAction) => void
  onDeleteUser: (userId: string) => void
}

type SettingsUserMoreActionsState = {
  statusDialogOpen: boolean
  deleteDialogOpen: boolean
}

export class SettingsUserMoreActions extends Component<
  SettingsUserMoreActionsProps,
  SettingsUserMoreActionsState
> {
  state: SettingsUserMoreActionsState = {
    statusDialogOpen: false,
    deleteDialogOpen: false,
  }

  componentDidUpdate(prevProps: SettingsUserMoreActionsProps) {
    if (
      prevProps.user.id !== this.props.user.id ||
      prevProps.statusAction !== this.props.statusAction
    ) {
      this.setState({
        statusDialogOpen: false,
        deleteDialogOpen: false,
      })
    }
  }

  render() {
    const {
      user,
      isSubmitting,
      triggerClassName,
      menuContentClassName,
      statusAction,
      statusLabel,
      statusIcon: StatusIcon,
      statusDisabledReason,
      deleteDisabledReason,
      onStatusChange,
      onDeleteUser,
    } = this.props
    const { statusDialogOpen, deleteDialogOpen } = this.state

    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={triggerClassName}
                disabled={isSubmitting}
              />
            }
          >
            <IconDotsVertical data-icon="inline-start" />
            More actions
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="top"
            sideOffset={8}
            className={menuContentClassName}
          >
            <DropdownMenuGroup>
              <DropdownMenuItem
                variant={user.isBanned ? 'default' : 'destructive'}
                disabled={isSubmitting || Boolean(statusDisabledReason)}
                title={statusDisabledReason || undefined}
                onClick={() => this.setState({ statusDialogOpen: true })}
              >
                <StatusIcon />
                {statusLabel}
              </DropdownMenuItem>

              <DropdownMenuItem
                variant="destructive"
                disabled={isSubmitting || Boolean(deleteDisabledReason)}
                title={deleteDisabledReason || undefined}
                onClick={() => this.setState({ deleteDialogOpen: true })}
              >
                <IconTrash />
                Delete user
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <AlertDialog
          open={statusDialogOpen}
          onOpenChange={(open) => this.setState({ statusDialogOpen: open })}
        >
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>{statusLabel}?</AlertDialogTitle>
              <AlertDialogDescription>
                {user.isBanned
                  ? `This restores access for ${user.name}.`
                  : `This disables sign-in for ${user.name} until the super admin reactivates the account.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isSubmitting}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogCancel
                type="button"
                variant={user.isBanned ? 'default' : 'destructive'}
                disabled={isSubmitting}
                onClick={() => {
                  this.setState({ statusDialogOpen: false })
                  onStatusChange(user.id, statusAction)
                }}
              >
                {statusLabel}
              </AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={deleteDialogOpen}
          onOpenChange={(open) => this.setState({ deleteDialogOpen: open })}
        >
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete user?</AlertDialogTitle>
              <AlertDialogDescription>
                This hides {user.name} from user management, blocks sign-in, and
                keeps historical activity for audit and reporting.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isSubmitting}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                type="button"
                variant="destructive"
                disabled={isSubmitting}
                onClick={() => {
                  this.setState({ deleteDialogOpen: false })
                  onDeleteUser(user.id)
                }}
              >
                Delete user
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    )
  }
}
