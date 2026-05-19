/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PasswordInput } from '@/components/password-input'

afterEach(() => {
  cleanup()
})

describe('PasswordInput', () => {
  it('toggles password visibility with an accessible button', () => {
    const onVisibilityChange = vi.fn()
    const { rerender } = render(
      <PasswordInput
        aria-label="Temporary password"
        isVisible={false}
        onVisibilityChange={onVisibilityChange}
        visibilityLabel="temporary password"
        value="SecretPassword1!"
        onChange={vi.fn()}
      />,
    )

    const input = screen.getByLabelText('Temporary password')

    expect(input.getAttribute('type')).toBe('password')
    fireEvent.click(
      screen.getByRole('button', { name: /show temporary password/i }),
    )
    expect(onVisibilityChange).toHaveBeenCalledWith(true)

    rerender(
      <PasswordInput
        aria-label="Temporary password"
        isVisible
        onVisibilityChange={onVisibilityChange}
        visibilityLabel="temporary password"
        value="SecretPassword1!"
        onChange={vi.fn()}
      />,
    )

    expect(input.getAttribute('type')).toBe('text')
    expect(
      screen
        .getByRole('button', { name: /hide temporary password/i })
        .getAttribute('aria-pressed'),
    ).toBe('true')
  })
})
