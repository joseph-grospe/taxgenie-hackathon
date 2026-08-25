import { Delete02Icon, Undo02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useId, useRef, useState } from 'react'

import type { NormalizedSignatureImage } from '@/lib/signature-image-processing'
import { normalizeSignatureCanvas } from '@/lib/signature-image-processing'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

const DRAWING_WIDTH = 720
const DRAWING_HEIGHT = 240
const DRAWING_LINE_WIDTH = 6
const DRAWING_INK = '#111827'
const MIN_DRAWING_PATH_LENGTH = 24

type SignaturePoint = {
  x: number
  y: number
}

type SignatureStroke = Array<SignaturePoint>

type SignatureDrawingPadProps = {
  disabled?: boolean
  onErrorChange: (message: string) => void
  onImageChange: (image: NormalizedSignatureImage | null) => void
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const getCanvasPoint = (
  canvas: HTMLCanvasElement,
  event: React.PointerEvent<HTMLCanvasElement>,
): SignaturePoint | null => {
  const bounds = canvas.getBoundingClientRect()
  if (bounds.width <= 0 || bounds.height <= 0) {
    return null
  }

  return {
    x: clamp(
      (event.clientX - bounds.left) * (canvas.width / bounds.width),
      0,
      canvas.width,
    ),
    y: clamp(
      (event.clientY - bounds.top) * (canvas.height / bounds.height),
      0,
      canvas.height,
    ),
  }
}

const drawStroke = (
  context: CanvasRenderingContext2D,
  stroke: SignatureStroke,
) => {
  const firstPoint = stroke[0]

  context.beginPath()
  context.moveTo(firstPoint.x, firstPoint.y)

  if (stroke.length === 1) {
    context.lineTo(firstPoint.x + 0.01, firstPoint.y + 0.01)
  } else {
    for (let index = 1; index < stroke.length; index += 1) {
      const point = stroke[index]
      context.lineTo(point.x, point.y)
    }
  }

  context.stroke()
}

const getStrokeLength = (stroke: SignatureStroke) => {
  let length = 0

  for (let index = 1; index < stroke.length; index += 1) {
    const previous = stroke[index - 1]
    const current = stroke[index]
    length += Math.hypot(current.x - previous.x, current.y - previous.y)
  }

  return length
}

const renderStrokes = (
  canvas: HTMLCanvasElement,
  strokes: Array<SignatureStroke>,
  activeStroke?: SignatureStroke,
) => {
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Signature drawing is unavailable in this browser.')
  }

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = DRAWING_LINE_WIDTH
  context.strokeStyle = DRAWING_INK

  for (const stroke of strokes) {
    drawStroke(context, stroke)
  }

  if (activeStroke) {
    drawStroke(context, activeStroke)
  }
}

export function SignatureDrawingPad({
  disabled = false,
  onErrorChange,
  onImageChange,
}: SignatureDrawingPadProps) {
  const descriptionId = useId()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const strokesRef = useRef<Array<SignatureStroke>>([])
  const activeStrokeRef = useRef<SignatureStroke | null>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const [strokeCount, setStrokeCount] = useState(0)

  const publishDrawing = (canvas: HTMLCanvasElement) => {
    try {
      const pathLength = strokesRef.current.reduce(
        (total, stroke) => total + getStrokeLength(stroke),
        0,
      )
      if (pathLength < MIN_DRAWING_PATH_LENGTH) {
        throw new Error(
          'Add a longer signature stroke before saving your drawing.',
        )
      }

      const image = normalizeSignatureCanvas(canvas)
      onImageChange(image)
      onErrorChange('')
    } catch (error) {
      onImageChange(null)
      onErrorChange(
        error instanceof Error
          ? error.message
          : 'Unable to prepare the drawn signature.',
      )
    }
  }

  const resetActiveStroke = (canvas: HTMLCanvasElement) => {
    activeStrokeRef.current = null
    activePointerIdRef.current = null
    renderStrokes(canvas, strokesRef.current)
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (
      disabled ||
      activePointerIdRef.current !== null ||
      !event.isPrimary ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) {
      return
    }

    const point = getCanvasPoint(event.currentTarget, event)
    if (!point) {
      return
    }

    event.preventDefault()
    activePointerIdRef.current = event.pointerId
    activeStrokeRef.current = [point]
    const pointerTarget: {
      setPointerCapture?: (pointerId: number) => void
    } = event.currentTarget
    pointerTarget.setPointerCapture?.(event.pointerId)
    renderStrokes(
      event.currentTarget,
      strokesRef.current,
      activeStrokeRef.current,
    )
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (
      disabled ||
      event.pointerId !== activePointerIdRef.current ||
      !activeStrokeRef.current
    ) {
      return
    }

    const point = getCanvasPoint(event.currentTarget, event)
    if (!point) {
      return
    }

    event.preventDefault()
    activeStrokeRef.current.push(point)
    renderStrokes(
      event.currentTarget,
      strokesRef.current,
      activeStrokeRef.current,
    )
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (
      event.pointerId !== activePointerIdRef.current ||
      !activeStrokeRef.current
    ) {
      return
    }

    event.preventDefault()
    const completedStroke = activeStrokeRef.current
    strokesRef.current = [...strokesRef.current, completedStroke]
    setStrokeCount(strokesRef.current.length)
    activeStrokeRef.current = null
    activePointerIdRef.current = null
    const pointerTarget: {
      releasePointerCapture?: (pointerId: number) => void
    } = event.currentTarget
    pointerTarget.releasePointerCapture?.(event.pointerId)
    renderStrokes(event.currentTarget, strokesRef.current)
    publishDrawing(event.currentTarget)
  }

  const handlePointerCancel = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    if (event.pointerId !== activePointerIdRef.current) {
      return
    }

    resetActiveStroke(event.currentTarget)
  }

  const handleUndo = () => {
    const canvas = canvasRef.current
    if (!canvas || strokesRef.current.length === 0) {
      return
    }

    strokesRef.current = strokesRef.current.slice(0, -1)
    setStrokeCount(strokesRef.current.length)
    resetActiveStroke(canvas)

    if (strokesRef.current.length === 0) {
      onImageChange(null)
      onErrorChange('')
      return
    }

    publishDrawing(canvas)
  }

  const handleClear = () => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    strokesRef.current = []
    setStrokeCount(0)
    resetActiveStroke(canvas)
    onImageChange(null)
    onErrorChange('')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-lg border border-border/70 bg-background">
        <Separator
          aria-hidden="true"
          className="absolute inset-x-4 top-1/2 w-auto"
        />
        <canvas
          ref={canvasRef}
          width={DRAWING_WIDTH}
          height={DRAWING_HEIGHT}
          aria-label="Draw your signature"
          aria-describedby={descriptionId}
          aria-disabled={disabled}
          data-disabled={disabled ? true : undefined}
          className="relative block aspect-[3/1] w-full touch-none cursor-crosshair data-disabled:cursor-not-allowed"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p id={descriptionId} className="text-xs text-muted-foreground">
          Use your mouse, finger, or stylus to sign above the line.
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || strokeCount === 0}
            onClick={handleUndo}
          >
            <HugeiconsIcon icon={Undo02Icon} data-icon="inline-start" />
            Undo
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || strokeCount === 0}
            onClick={handleClear}
          >
            <HugeiconsIcon icon={Delete02Icon} data-icon="inline-start" />
            Clear
          </Button>
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {strokeCount === 0
          ? 'Signature drawing is empty.'
          : `${strokeCount} signature ${strokeCount === 1 ? 'stroke' : 'strokes'} drawn.`}
      </p>
    </div>
  )
}
