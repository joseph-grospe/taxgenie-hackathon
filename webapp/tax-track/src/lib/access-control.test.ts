import { describe, expect, it } from 'vitest'

import type { UserRole } from '@/lib/access-control'
import {
  canAccessPath,
  canAccessRoute,
  canExport,
  canExport2307Workbook,
  resolveProtectedRoute,
} from '@/lib/access-control'

describe('access-control route policy', () => {
  it('matches the documented admin-only and upload routes', () => {
    expect(canAccessRoute('settings', 'super_admin')).toBe(true)
    expect(canAccessRoute('settings', 'admin')).toBe(true)
    expect(canAccessRoute('settings', 'editor')).toBe(false)
    expect(canAccessRoute('settings', 'viewer')).toBe(false)

    expect(canAccessRoute('upload', 'super_admin')).toBe(true)
    expect(canAccessRoute('upload', 'admin')).toBe(true)
    expect(canAccessRoute('upload', 'editor')).toBe(true)
    expect(canAccessRoute('upload', 'viewer')).toBe(false)

    expect(canAccessRoute('batches', 'super_admin')).toBe(true)
    expect(canAccessRoute('batches', 'admin')).toBe(true)
    expect(canAccessRoute('batches', 'editor')).toBe(true)
    expect(canAccessRoute('batches', 'viewer')).toBe(true)

    expect(canAccessRoute('audit', 'super_admin')).toBe(true)
    expect(canAccessRoute('audit', 'admin')).toBe(true)
    expect(canAccessRoute('audit', 'editor')).toBe(false)
    expect(canAccessRoute('audit', 'viewer')).toBe(false)
  })

  it('allows all authenticated roles on the shared operational routes', () => {
    const roles: Array<UserRole> = ['super_admin', 'admin', 'editor', 'viewer']
    const sharedRoutes = [
      '/dashboard',
      '/batches',
      '/batches/BATCH-1001',
      '/issues',
      '/validated',
      '/reconciliation',
      '/reconciliation/ROW-1',
      '/merge-pdfs',
      '/documents/DOC-1001',
      '/error-detail',
    ]

    for (const role of roles) {
      for (const path of sharedRoutes) {
        expect(canAccessPath(path, role)).toBe(true)
      }
    }
  })

  it('restricts the audit trail to admins', () => {
    expect(canAccessPath('/audit', 'super_admin')).toBe(true)
    expect(canAccessPath('/audit', 'admin')).toBe(true)
    expect(canAccessPath('/audit', 'editor')).toBe(false)
    expect(canAccessPath('/audit', 'viewer')).toBe(false)
  })

  it('resolves detail pages to the expected protected route group', () => {
    expect(resolveProtectedRoute('/reconciliation/ROW-1')).toBe(
      'reconciliation',
    )
    expect(resolveProtectedRoute('/documents/DOC-1001')).toBe('documents')
    expect(resolveProtectedRoute('/settings')).toBe('settings')
    expect(resolveProtectedRoute('/upload')).toBe('upload')
    expect(resolveProtectedRoute('/batches/BATCH-1001')).toBe('batches')
  })

  it('keeps unknown paths permissive until they are explicitly classified', () => {
    expect(resolveProtectedRoute('/some-future-page')).toBeNull()
    expect(canAccessPath('/some-future-page', 'viewer')).toBe(true)
  })

  it('treats super admins as export-capable admins', () => {
    expect(canExport.pdf('super_admin', false)).toBe(true)
    expect(canExport.excel('super_admin', false)).toBe(true)
    expect(canExport.pdf('admin', false)).toBe(true)
    expect(canExport.excel('viewer', false)).toBe(false)
  })

  it('enforces role and flag policy for 2307 workbook exports', () => {
    expect(
      canExport2307Workbook({ role: 'super_admin', canExportExcel: false }),
    ).toBe(true)
    expect(canExport2307Workbook({ role: 'admin', canExportExcel: false })).toBe(
      true,
    )
    expect(canExport2307Workbook({ role: 'editor', canExportExcel: true })).toBe(
      true,
    )
    expect(
      canExport2307Workbook({ role: 'editor', canExportExcel: false }),
    ).toBe(false)
    expect(canExport2307Workbook({ role: 'viewer', canExportExcel: true })).toBe(
      false,
    )
    expect(canExport2307Workbook(null)).toBe(false)
  })
})
