import { z } from 'zod'

import type { AccessContext } from '@/lib/access-control'
import type { Team as TeamType, UserRole } from '@/lib/user-roles'

import {
  TEAM_OPTIONS,
  validateTeam,
  validateUserRole,
} from '@/lib/access-control'
import { assignableUserRoles } from '@/lib/user-roles'

export const passwordPolicy = {
  minLength: 12,
  message:
    'Password must be at least 12 characters and include uppercase, lowercase, number, and symbol.',
}

const strongPasswordPattern =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/

export const passwordSchema = z
  .string()
  .trim()
  .min(passwordPolicy.minLength, passwordPolicy.message)
  .regex(strongPasswordPattern, {
    message: passwordPolicy.message,
  })

export const roleSchema = z.enum(assignableUserRoles)
export const teamSchema = z.enum(TEAM_OPTIONS)

export const userCreateSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1, 'Name is required'),
  password: passwordSchema,
  role: roleSchema,
  team: teamSchema,
  canExportPdf: z.coerce.boolean().default(false),
  canExportExcel: z.coerce.boolean().default(false),
})

export const userUpdateSchema = z.object({
  userId: z.string().trim().min(1, 'User ID is required'),
  role: roleSchema.optional(),
  team: teamSchema.optional(),
  canExportPdf: z.coerce.boolean().optional(),
  canExportExcel: z.coerce.boolean().optional(),
})

export const userStatusSchema = z.object({
  userId: z.string().trim().min(1, 'User ID is required'),
})

export const userVerificationEmailSchema = userStatusSchema

export const userResetPasswordSchema = z.object({
  userId: z.string().trim().min(1, 'User ID is required'),
  newPassword: passwordSchema,
})

export const userChangePasswordSchema = z.object({
  currentPassword: z.string().trim().min(1, 'Current password is required'),
  newPassword: passwordSchema,
})

export const usersListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

const toBoolean = (value: unknown): boolean =>
  value === true || value === 'true' || value === 1 || value === '1'

export type ManagedUser = {
  id: string
  email: string
  name: string
  role: UserRole
  team: TeamType
  canExportPdf: boolean
  canExportExcel: boolean
  emailVerified: boolean
  mustChangePassword: boolean
  isBanned: boolean
  isDeleted: boolean
  createdAt?: string
  updatedAt?: string
  deletedAt?: string
  deletedByUserId?: string
  deletedReason?: string
}

const normalizeId = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

const normalizeText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

const normalizeDateText = (value: unknown): string | undefined =>
  typeof value === 'string' || value instanceof Date ? String(value) : undefined

export const normalizeManagedUser = (value: unknown): ManagedUser => {
  const user = (value ?? {}) as Partial<AccessContext> & Record<string, unknown>
  const role = validateUserRole(
    typeof user.role === 'string' ? user.role : 'viewer',
  )
  const team = validateTeam(typeof user.team === 'string' ? user.team : null)

  const id = normalizeId(user.id)
  const name = normalizeText(user.name)
  const email = normalizeText(user.email)
  const deletedAt = normalizeDateText(user.deletedAt)

  return {
    id,
    name,
    email,
    role,
    team,
    canExportPdf: toBoolean(user.canExportPdf),
    canExportExcel: toBoolean(user.canExportExcel),
    emailVerified: toBoolean(user.emailVerified),
    mustChangePassword: toBoolean(user.mustChangePassword),
    isBanned: toBoolean(user.banned),
    isDeleted: deletedAt !== undefined,
    createdAt: normalizeDateText(user.createdAt),
    updatedAt: normalizeDateText(user.updatedAt),
    deletedAt,
    deletedByUserId: normalizeText(user.deletedByUserId) || undefined,
    deletedReason: normalizeText(user.deletedReason) || undefined,
  }
}

export type UserCreateInput = z.infer<typeof userCreateSchema>
export type UserUpdateInput = z.infer<typeof userUpdateSchema>
export type UserStatusInput = z.infer<typeof userStatusSchema>
export type UserVerificationEmailInput = z.infer<
  typeof userVerificationEmailSchema
>
export type UserResetPasswordInput = z.infer<typeof userResetPasswordSchema>
export type UserChangePasswordInput = z.infer<typeof userChangePasswordSchema>
export type UsersListQuery = z.infer<typeof usersListQuerySchema>
