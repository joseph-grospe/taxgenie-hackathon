import { describe, expect, it } from 'vitest'

import type {UserRole} from '@/lib/access-control';
import {
  
  canAccessPath,
  canAccessRoute,
  resolveProtectedRoute
} from '@/lib/access-control'

describe('access-control route policy', () => {
  it('matches the documented admin-only and upload routes', () => {
    expect(canAccessRoute('settings', 'admin')).toBe(true)
    expect(canAccessRoute('settings', 'editor')).toBe(false)
    expect(canAccessRoute('settings', 'viewer')).toBe(false)

    expect(canAccessRoute('upload', 'admin')).toBe(true)
    expect(canAccessRoute('upload', 'editor')).toBe(true)
    expect(canAccessRoute('upload', 'viewer')).toBe(false)
  })

  it('allows all authenticated roles on the shared operational routes', () => {
    const roles: Array<UserRole> = ['admin', 'editor', 'viewer']
    const sharedRoutes = [
      '/dashboard',
      '/issues',
      '/validated',
      '/reconciliation',
      '/reconciliation/ROW-1',
      '/reports',
      '/audit',
      '/documents/DOC-1001',
      '/error-detail',
    ]

    for (const role of roles) {
      for (const path of sharedRoutes) {
        expect(canAccessPath(path, role)).toBe(true)
      }
    }
  })

  it('resolves detail pages to the expected protected route group', () => {
    expect(resolveProtectedRoute('/reconciliation/ROW-1')).toBe(
      'reconciliation',
    )
    expect(resolveProtectedRoute('/documents/DOC-1001')).toBe('documents')
    expect(resolveProtectedRoute('/settings')).toBe('settings')
    expect(resolveProtectedRoute('/upload')).toBe('upload')
  })

  it('keeps unknown paths permissive until they are explicitly classified', () => {
    expect(resolveProtectedRoute('/some-future-page')).toBeNull()
    expect(canAccessPath('/some-future-page', 'viewer')).toBe(true)
  })
})
