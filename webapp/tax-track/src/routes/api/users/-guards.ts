import type { ManagedUser } from '@/lib/users-module'

import { auth } from '@/lib/auth-server'
import { badRequestResponse } from '@/lib/user-admin-server'
import { normalizeManagedUser } from '@/lib/users-module'

type MutableUserResult =
  | { ok: true; user: ManagedUser }
  | { ok: false; response: Response }

export const deletedUserMessage = 'This user has been deleted.'
export const targetUserNotFoundMessage = 'Target user was not found.'

export const getManagedUserById = async (
  request: Request,
  userId: string,
): Promise<ManagedUser | null> => {
  const rawUser = await auth.api
    .getUser({
      headers: request.headers,
      query: {
        id: userId,
      },
    })
    .catch(() => null)

  const user = normalizeManagedUser(rawUser)
  return user.id ? user : null
}

export const requireMutableManagedUser = async (
  request: Request,
  userId: string,
): Promise<MutableUserResult> => {
  const user = await getManagedUserById(request, userId)

  if (!user) {
    return {
      ok: false,
      response: badRequestResponse(targetUserNotFoundMessage),
    }
  }

  if (user.isDeleted) {
    return {
      ok: false,
      response: badRequestResponse(deletedUserMessage),
    }
  }

  return { ok: true, user }
}
