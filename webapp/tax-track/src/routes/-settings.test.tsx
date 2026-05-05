/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DevDataResetStatus } from '@/routes/settings'
import { DevDataResetPanel } from '@/routes/settings'

const status: DevDataResetStatus = {
  available: true,
  stage: 'dev-app',
  counts: {
    intake_files: 2,
    document_results: 3,
  },
}

const noop = () => undefined

const renderPanel = (
  overrides: Partial<Parameters<typeof DevDataResetPanel>[0]> = {},
) => {
  const props: Parameters<typeof DevDataResetPanel>[0] = {
    status,
    error: '',
    isLoading: false,
    isDialogOpen: false,
    confirmationText: '',
    isResetting: false,
    onDialogOpenChange: noop,
    onConfirmationTextChange: noop,
    onReset: noop,
    ...overrides,
  }

  return render(<DevDataResetPanel {...props} />)
}

afterEach(() => {
  cleanup()
})

describe('DevDataResetPanel', () => {
  it('is omitted when the settings route has no dev reset status', () => {
    const Harness = ({ value }: { value: DevDataResetStatus | null }) =>
      value ? (
        <DevDataResetPanel
          status={value}
          error=""
          isLoading={false}
          isDialogOpen={false}
          confirmationText=""
          isResetting={false}
          onDialogOpenChange={noop}
          onConfirmationTextChange={noop}
          onReset={noop}
        />
      ) : null

    render(<Harness value={null} />)

    expect(screen.queryByText('Development data')).toBeNull()
  })

  it('shows the current dev stage and table counts', () => {
    renderPanel()

    expect(screen.getByText('Development data')).toBeTruthy()
    expect(screen.getByText('dev-app')).toBeTruthy()
    expect(screen.getByText('Intake files')).toBeTruthy()
    expect(screen.getByText('Document results')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('requires confirmation text before calling reset', () => {
    const onConfirmationTextChange = vi.fn()
    const onReset = vi.fn()
    const { rerender } = renderPanel({
      isDialogOpen: true,
      onConfirmationTextChange,
      onReset,
    })

    const confirmButton = screen.getByRole('button', {
      name: /clear data/i,
    })
    expect(confirmButton.disabled).toBe(true)

    fireEvent.change(
      screen.getByLabelText(/type clear dev data to confirm/i),
      {
        target: { value: 'CLEAR DEV DATA' },
      },
    )
    expect(onConfirmationTextChange).toHaveBeenCalledWith('CLEAR DEV DATA')

    rerender(
      <DevDataResetPanel
        status={status}
        error=""
        isLoading={false}
        isDialogOpen
        confirmationText="CLEAR DEV DATA"
        isResetting={false}
        onDialogOpenChange={noop}
        onConfirmationTextChange={onConfirmationTextChange}
        onReset={onReset}
      />,
    )

    const enabledConfirmButton = screen.getByRole('button', {
      name: /clear data/i,
    })
    expect(enabledConfirmButton.disabled).toBe(false)

    fireEvent.click(enabledConfirmButton)

    expect(onReset).toHaveBeenCalledTimes(1)
  })
})
