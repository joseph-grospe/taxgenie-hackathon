/* @vitest-environment jsdom */

import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'

import type { NormalizedSignatureImage } from '@/lib/signature-image-processing'
import { SignatureDrawingPad } from '@/components/signature-drawing-pad'

const normalizationMocks = vi.hoisted(() => ({
  normalizeSignatureCanvas: vi.fn(),
}))

vi.mock('@/lib/signature-image-processing', () => ({
  normalizeSignatureCanvas: normalizationMocks.normalizeSignatureCanvas,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    size: _size,
    variant: _variant,
    ...props
  }: React.ComponentProps<'button'> & {
    size?: string
    variant?: string
  }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/separator', () => ({
  Separator: (props: React.ComponentProps<'hr'>) => <hr {...props} />,
}))

const DRAWN_IMAGE: NormalizedSignatureImage = {
  backgroundRemoved: false,
  dataUrl: 'data:image/png;base64,ZHJhd24=',
  height: 80,
  mimeType: 'image/png',
  width: 240,
}

const canvasContext = {
  beginPath: vi.fn(),
  clearRect: vi.fn(),
  lineTo: vi.fn(),
  moveTo: vi.fn(),
  stroke: vi.fn(),
  lineCap: 'round',
  lineJoin: 'round',
  lineWidth: 6,
  strokeStyle: '#111827',
}

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = []

const renderPad = async (onImageChange = vi.fn(), onErrorChange = vi.fn()) => {
  const container = document.createElement('div')
  const root = createRoot(container)
  document.body.append(container)
  mountedRoots.push({ container, root })

  await React.act(() => {
    root.render(
      <SignatureDrawingPad
        onImageChange={onImageChange}
        onErrorChange={onErrorChange}
      />,
    )
  })

  const canvas = container.querySelector('canvas')
  if (!canvas) {
    throw new Error('Signature canvas was not rendered.')
  }

  return { canvas, container, onErrorChange, onImageChange }
}

const dispatchPointer = (
  canvas: HTMLCanvasElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  input: {
    clientX: number
    clientY: number
    pointerId: number
    pointerType: 'mouse' | 'pen' | 'touch'
  },
) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: input.clientX },
    clientY: { value: input.clientY },
    isPrimary: { value: true },
    pointerId: { value: input.pointerId },
    pointerType: { value: input.pointerType },
  })
  canvas.dispatchEvent(event)
}

const drawStroke = (
  canvas: HTMLCanvasElement,
  pointerType: 'mouse' | 'pen' | 'touch',
  pointerId = 1,
) => {
  dispatchPointer(canvas, 'pointerdown', {
    clientX: 40,
    clientY: 80,
    pointerId,
    pointerType,
  })
  dispatchPointer(canvas, 'pointermove', {
    clientX: 180,
    clientY: 110,
    pointerId,
    pointerType,
  })
  dispatchPointer(canvas, 'pointerup', {
    clientX: 220,
    clientY: 120,
    pointerId,
    pointerType,
  })
}

const getButton = (container: HTMLElement, label: string) => {
  const button = Array.from(container.querySelectorAll('button')).find(
    (element) => element.textContent.includes(label),
  )
  if (!button) {
    throw new Error(`${label} button was not rendered.`)
  }

  return button
}

beforeEach(() => {
  const actGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true

  normalizationMocks.normalizeSignatureCanvas.mockReturnValue(DRAWN_IMAGE)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    canvasContext as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(
    HTMLCanvasElement.prototype,
    'getBoundingClientRect',
  ).mockReturnValue({
    bottom: 240,
    height: 240,
    left: 0,
    right: 720,
    top: 0,
    width: 720,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
})

afterEach(async () => {
  for (const { container, root } of mountedRoots.splice(0)) {
    await React.act(() => {
      root.unmount()
    })
    container.remove()
  }

  vi.restoreAllMocks()
  normalizationMocks.normalizeSignatureCanvas.mockReset()
  for (const mock of Object.values(canvasContext)) {
    if (typeof mock === 'function' && 'mockReset' in mock) {
      mock.mockReset()
    }
  }
})

describe('SignatureDrawingPad', () => {
  it.each(['mouse', 'touch', 'pen'] as const)(
    'publishes completed %s strokes as normalized images',
    async (pointerType) => {
      const onImageChange = vi.fn()
      const onErrorChange = vi.fn()
      const { canvas } = await renderPad(onImageChange, onErrorChange)

      React.act(() => {
        drawStroke(canvas, pointerType)
      })

      expect(normalizationMocks.normalizeSignatureCanvas).toHaveBeenCalledWith(
        canvas,
      )
      expect(onImageChange).toHaveBeenLastCalledWith(DRAWN_IMAGE)
      expect(onErrorChange).toHaveBeenLastCalledWith('')
    },
  )

  it('supports multiple strokes, undo, and clear', async () => {
    const onImageChange = vi.fn()
    const { canvas, container } = await renderPad(onImageChange)

    React.act(() => {
      drawStroke(canvas, 'mouse', 1)
      drawStroke(canvas, 'mouse', 2)
    })
    expect(normalizationMocks.normalizeSignatureCanvas).toHaveBeenCalledTimes(2)

    React.act(() => {
      getButton(container, 'Undo').click()
    })
    expect(normalizationMocks.normalizeSignatureCanvas).toHaveBeenCalledTimes(3)

    React.act(() => {
      getButton(container, 'Clear').click()
    })
    expect(onImageChange).toHaveBeenLastCalledWith(null)
    expect(getButton(container, 'Undo').hasAttribute('disabled')).toBe(true)
    expect(getButton(container, 'Clear').hasAttribute('disabled')).toBe(true)
  })

  it('discards an active stroke when the pointer is cancelled', async () => {
    const { canvas, container } = await renderPad()

    React.act(() => {
      dispatchPointer(canvas, 'pointerdown', {
        clientX: 40,
        clientY: 80,
        pointerId: 1,
        pointerType: 'touch',
      })
      dispatchPointer(canvas, 'pointermove', {
        clientX: 180,
        clientY: 110,
        pointerId: 1,
        pointerType: 'touch',
      })
      dispatchPointer(canvas, 'pointercancel', {
        clientX: 180,
        clientY: 110,
        pointerId: 1,
        pointerType: 'touch',
      })
    })

    expect(normalizationMocks.normalizeSignatureCanvas).not.toHaveBeenCalled()
    expect(getButton(container, 'Undo').hasAttribute('disabled')).toBe(true)
  })

  it('rejects an insufficient drawing without publishing an image', async () => {
    const onImageChange = vi.fn()
    const onErrorChange = vi.fn()
    const { canvas } = await renderPad(onImageChange, onErrorChange)

    React.act(() => {
      dispatchPointer(canvas, 'pointerdown', {
        clientX: 40,
        clientY: 80,
        pointerId: 1,
        pointerType: 'mouse',
      })
      dispatchPointer(canvas, 'pointermove', {
        clientX: 45,
        clientY: 80,
        pointerId: 1,
        pointerType: 'mouse',
      })
      dispatchPointer(canvas, 'pointerup', {
        clientX: 45,
        clientY: 80,
        pointerId: 1,
        pointerType: 'mouse',
      })
    })

    expect(normalizationMocks.normalizeSignatureCanvas).not.toHaveBeenCalled()
    expect(onImageChange).toHaveBeenLastCalledWith(null)
    expect(onErrorChange).toHaveBeenLastCalledWith(
      'Add a longer signature stroke before saving your drawing.',
    )
  })
})
