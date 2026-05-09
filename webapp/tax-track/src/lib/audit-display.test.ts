import { describe, expect, it } from 'vitest'

import {
  formatAuditAction,
  formatAuditTargetType,
  getAuditTargetDisplay,
  getAuditUserDisplay,
} from '@/lib/audit-display'

describe('audit display helpers', () => {
  it('normalizes known and unknown audit actions', () => {
    expect(formatAuditAction('user_created')).toBe('User created')
    expect(formatAuditAction('certificate_sign_failed')).toBe(
      'Certificate signing failed',
    )
    expect(formatAuditAction('custom_event-name')).toBe('Custom event name')
  })

  it('resolves user display from profile data with id fallbacks', () => {
    expect(
      getAuditUserDisplay(
        {
          id: 'user-1',
          name: 'Ada Admin',
          email: 'ada@example.com',
        },
        'user-1',
        'System',
      ),
    ).toEqual({
      label: 'Ada Admin',
      detail: 'ada@example.com',
    })

    expect(getAuditUserDisplay(null, 'missing-user', 'System')).toEqual({
      label: 'missing-user',
      detail: 'User not found',
    })

    expect(getAuditUserDisplay(null, null, 'System')).toEqual({
      label: 'System',
    })
  })

  it('formats target types and target display fallbacks', () => {
    expect(formatAuditTargetType('batch')).toBe('Batch')
    expect(formatAuditTargetType('document')).toBe('Document')
    expect(formatAuditTargetType(null)).toBe('System')

    expect(
      getAuditTargetDisplay({
        target: {
          id: 'user-1',
          name: 'Eli Editor',
          email: 'eli@example.com',
        },
        targetId: 'user-1',
        targetType: 'user',
      }),
    ).toEqual({
      label: 'Eli Editor',
      detail: 'eli@example.com',
    })

    expect(
      getAuditTargetDisplay({
        target: null,
        targetId: 'batch-1',
        targetType: 'batch',
      }),
    ).toEqual({
      label: 'batch-1',
      detail: 'Batch',
    })
  })
})
