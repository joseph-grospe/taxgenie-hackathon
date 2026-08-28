import { describe, expect, it } from 'vitest'

import { normalizeManagedUser, userCreateSchema } from '@/lib/users-module'

describe('normalizeManagedUser', () => {
  it('normalizes Better Auth email verification state', () => {
    expect(
      normalizeManagedUser({
        id: 'user-1',
        name: 'Verified User',
        email: 'verified@example.com',
        role: 'editor',
        team: 'tax_team',
        emailVerified: 'true',
      }).emailVerified,
    ).toBe(true)

    expect(
      normalizeManagedUser({
        id: 'user-2',
        name: 'Pending User',
        email: 'pending@example.com',
        role: 'viewer',
        team: 'ar_team',
        emailVerified: false,
      }).emailVerified,
    ).toBe(false)
  })

  it('normalizes soft deleted user metadata', () => {
    const deletedAt = new Date('2026-05-18T08:00:00.000Z')

    expect(
      normalizeManagedUser({
        id: 'user-3',
        name: 'Deleted User',
        email: 'deleted@example.com',
        role: 'viewer',
        team: 'ar_team',
        deletedAt,
        deletedByUserId: 'admin-1',
        deletedReason: 'Deleted by admin',
      }),
    ).toMatchObject({
      isDeleted: true,
      deletedAt: String(deletedAt),
      deletedByUserId: 'admin-1',
      deletedReason: 'Deleted by admin',
    })
  })

  it('normalizes super admin users but keeps creation seeded-only', () => {
    expect(
      normalizeManagedUser({
        id: 'seed-admin',
        name: 'Seed Admin',
        email: 'seed@example.com',
        role: 'super_admin',
        team: 'it',
      }),
    ).toMatchObject({
      id: 'seed-admin',
      role: 'super_admin',
    })

    expect(
      userCreateSchema.safeParse({
        email: 'new.super@example.com',
        name: 'New Super',
        password: 'TempPassword1!',
        role: 'super_admin',
        team: 'it',
      }).success,
    ).toBe(false)
  })
})
