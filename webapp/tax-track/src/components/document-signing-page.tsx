import { useEffect, useMemo, useRef, useState } from 'react'
import {
  IconAlertCircle,
  IconArrowsMaximize,
  IconCalendarEvent,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheckFilled,
  IconCopy,
  IconDeviceFloppy,
  IconDots,
  IconDownload,
  IconFileDescription,
  IconMinus,
  IconPencil,
  IconPlus,
  IconSignature,
  IconUser,
} from '@tabler/icons-react'
import { toast } from 'sonner'

import type {
  SignaturePlacementTemplate,
  SignatureProfileView,
  SignatureRect,
  SigningContextView,
  SigningTargetView,
} from '@/lib/signing-module'
import {
  fitRectWithinRect,
  getAutoTextBlockRect,
  getDefaultSignatureImageRect,
} from '@/lib/signing-placement'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

const DEFAULT_SIGNATURE_RECT: SignatureRect = {
  x: 0.58,
  y: 0.66,
  width: 0.24,
  height: 0.16,
}

type SigningContextResponse = {
  signingContext?: SigningContextView
  error?: string
}

type SignatureProfileResponse = {
  profile?: SignatureProfileView | null
  error?: string
}

type SignResponse = {
  signedArtifacts?: Array<{
    documentResultId: string
    status: 'signed'
    signedAt?: string
    signedByName?: string
    signedPdfUrl?: string
    templatePlacement?: SignaturePlacementTemplate
  }>
  error?: string
}

type SignatureFormState = {
  displayName: string
  designation: string
  tin: string
  signatureImageDataUrl?: string
  signatureImageMimeType?: 'image/png' | 'image/jpeg'
  signatureImageWidth?: number
  signatureImageHeight?: number
}

type PreviewMode = 'source' | 'signed'
type ZoomPreset = 'fit-width' | 'comfortable' | 'actual-size' | 'custom'
type PlacementStep = 'text' | 'signature'

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const readJson = async <T,>(response: Response): Promise<T | null> => {
  return (await response.json().catch(() => null)) as T | null
}

const loadPdfJs = async () => {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()

  return pdfjs
}

const loadImageDimensions = (dataUrl: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => reject(new Error('Unable to read signature image.'))
    image.src = dataUrl
  })

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('Unable to read the selected file.'))
    }
    reader.onerror = () =>
      reject(new Error('Unable to read the selected file.'))
    reader.readAsDataURL(file)
  })

const defaultSignatureFormState = (
  profile: SignatureProfileView | null | undefined,
): SignatureFormState => ({
  displayName: profile?.displayName ?? '',
  designation: profile?.designation ?? '',
  tin: profile?.tin ?? '',
})

const getTargetPlacement = (target: SigningTargetView) =>
  target.templatePlacement?.signatureRect ?? DEFAULT_SIGNATURE_RECT

const getTargetPlacementReady = (target: SigningTargetView) =>
  Boolean(target.templatePlacement) || target.signingStatus === 'signed'

const getTargetPreviewMode = (target: SigningTargetView): PreviewMode =>
  target.signingStatus === 'signed' && target.signedPdfUrl ? 'signed' : 'source'

const getTargetIdentityLabel = (target: SigningTargetView) =>
  target.payee.trim() || target.fileName

const getTargetSecondaryLabel = (target: SigningTargetView) =>
  target.payee.trim() ? target.fileName : ''

const getInitialSelection = (context: SigningContextView) =>
  (
    context.targets.find((target) => target.signingStatus !== 'signed') ??
    context.targets[0]
  ).documentResultId

const toPercentValue = (value: number) => Math.round(value * 100)

const toPlacementPositionLabel = (placement: SignatureRect) => {
  const horizontalCenter = placement.x + placement.width / 2
  const verticalCenter = placement.y + placement.height / 2
  const horizontal =
    horizontalCenter < 0.34
      ? 'Left'
      : horizontalCenter > 0.66
        ? 'Right'
        : 'Center'
  const vertical =
    verticalCenter < 0.34 ? 'Top' : verticalCenter > 0.66 ? 'Bottom' : 'Middle'

  return `${vertical} ${horizontal.toLowerCase()}`
}

const getZoomPercentForPreset = (preset: Exclude<ZoomPreset, 'custom'>) => {
  if (preset === 'comfortable') {
    return 115
  }

  if (preset === 'actual-size') {
    return 140
  }

  return 100
}

const toSigningLabel = (status: SigningTargetView['signingStatus']) => {
  if (status === 'signed') {
    return 'Signed'
  }

  if (status === 'failed') {
    return 'Signing failed'
  }

  return 'Unsigned'
}

const buildSignatureCaption = (input: {
  displayName: string
  designation: string
  tin: string
}) => {
  const displayName = input.displayName.trim() || 'Name'
  const designation = input.designation.trim() || 'Designation'
  const tin = input.tin.trim() || 'TIN'

  return `${displayName}       /       ${designation}       /       ${tin}`
}

const toRelativePercentRect = (
  blockRect: SignatureRect,
  innerRect: SignatureRect,
) => ({
  left: `${((innerRect.x - blockRect.x) / blockRect.width) * 100}%`,
  top: `${((innerRect.y - blockRect.y) / blockRect.height) * 100}%`,
  width: `${(innerRect.width / blockRect.width) * 100}%`,
  height: `${(innerRect.height / blockRect.height) * 100}%`,
})

const toPercentRect = (rect: SignatureRect) => ({
  left: `${rect.x * 100}%`,
  top: `${rect.y * 100}%`,
  width: `${rect.width * 100}%`,
  height: `${rect.height * 100}%`,
})

const clampRectToPage = (rect: SignatureRect): SignatureRect => ({
  ...rect,
  x: clamp(rect.x, 0, 1 - rect.width),
  y: clamp(rect.y, 0, 1 - rect.height),
})

export function DocumentSigningPage({
  docId,
  batchId,
  canDownloadSignedPdf = false,
}: {
  docId?: string
  batchId?: string
  canDownloadSignedPdf?: boolean
}) {
  const signingId = batchId ?? docId ?? ''
  const contextEndpoint = batchId
    ? `/api/uploads/batches/${encodeURIComponent(batchId)}/signing-context`
    : `/api/documents/${encodeURIComponent(signingId)}/signing-context`
  const signEndpoint = batchId
    ? `/api/uploads/batches/${encodeURIComponent(batchId)}/sign`
    : `/api/documents/${encodeURIComponent(signingId)}/sign`
  const workspaceLabel = batchId ? 'batch' : 'document'
  const [context, setContext] = useState<SigningContextView | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null)
  const [placements, setPlacements] = useState<Record<string, SignatureRect>>(
    {},
  )
  const [signatureImageRectByTarget, setSignatureImageRectByTarget] = useState<
    Partial<Record<string, SignatureRect>>
  >({})
  const [placementReadyByTarget, setPlacementReadyByTarget] = useState<
    Record<string, boolean>
  >({})
  const [previewModeByTarget, setPreviewModeByTarget] = useState<
    Record<string, PreviewMode>
  >({})
  const [thumbnailByTarget, setThumbnailByTarget] = useState<
    Record<string, string>
  >({})
  const [signatureForm, setSignatureForm] = useState<SignatureFormState>(
    defaultSignatureFormState(null),
  )
  const [signaturePreviewUrl, setSignaturePreviewUrl] = useState<string>('')
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [zoomPreset, setZoomPreset] = useState<ZoomPreset>('fit-width')
  const [zoomPercent, setZoomPercent] = useState(100)
  const [profileError, setProfileError] = useState('')
  const [signError, setSignError] = useState('')
  const [notice, setNotice] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isSigning, setIsSigning] = useState(false)
  const [isSignDialogOpen, setIsSignDialogOpen] = useState(false)
  const [isResignDialogOpen, setIsResignDialogOpen] = useState(false)
  const [isResigningBatch, setIsResigningBatch] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [placementStep, setPlacementStep] = useState<PlacementStep>('text')
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const pdfFrameRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let active = true

    const loadContext = async () => {
      setIsLoading(true)
      setLoadError(null)

      try {
        const response = await fetch(contextEndpoint, {
          cache: 'no-store',
        })
        const payload = await readJson<SigningContextResponse>(response)

        if (!response.ok || !payload?.signingContext) {
          throw new Error(
            payload?.error ||
              `Unable to load signing context (${response.status}).`,
          )
        }

        if (!active) {
          return
        }

        const nextContext = payload.signingContext
        setContext(nextContext)
        setSelectedTargetId(getInitialSelection(nextContext))
        setPlacements(
          Object.fromEntries(
            nextContext.targets.map((target) => [
              target.documentResultId,
              getTargetPlacement(target),
            ]),
          ),
        )
        setSignatureImageRectByTarget(
          Object.fromEntries(
            nextContext.targets.flatMap((target) =>
              target.templatePlacement?.signatureImageRect
                ? [
                    [
                      target.documentResultId,
                      target.templatePlacement.signatureImageRect,
                    ],
                  ]
                : [],
            ),
          ),
        )
        setPlacementReadyByTarget(
          Object.fromEntries(
            nextContext.targets.map((target) => [
              target.documentResultId,
              getTargetPlacementReady(target),
            ]),
          ),
        )
        setPreviewModeByTarget(
          Object.fromEntries(
            nextContext.targets.map((target) => [
              target.documentResultId,
              getTargetPreviewMode(target),
            ]),
          ),
        )
        setSignatureForm(
          defaultSignatureFormState(nextContext.signatureProfile),
        )
        setSignaturePreviewUrl(
          nextContext.signatureProfile?.signatureImageUrl ?? '',
        )
        setIsEditingProfile(!nextContext.signatureProfile)
        setZoomPreset('fit-width')
        setZoomPercent(getZoomPercentForPreset('fit-width'))
      } catch (error) {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Unable to load signing context.',
          )
        }
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    }

    void loadContext()

    return () => {
      active = false
    }
  }, [contextEndpoint])

  useEffect(() => {
    if (!context) {
      return
    }

    let cancelled = false

    const loadThumbnails = async () => {
      try {
        const pdfjs = await loadPdfJs()
        const nextEntries = await Promise.all(
          context.targets.map(async (target) => {
            try {
              const previewUrl = target.signedPdfUrl ?? target.sourcePdfUrl
              const loadingTask = pdfjs.getDocument(previewUrl)
              const pdfDocument = await loadingTask.promise
              const page = await pdfDocument.getPage(
                clamp(
                  target.previewPageNumber,
                  1,
                  Math.max(pdfDocument.numPages, 1),
                ),
              )
              const viewport = page.getViewport({ scale: 0.32 })
              const canvas = document.createElement('canvas')
              const context2d = canvas.getContext('2d')
              if (!context2d) {
                return [target.documentResultId, ''] as const
              }

              canvas.width = viewport.width
              canvas.height = viewport.height

              await page.render({
                canvasContext: context2d,
                viewport,
              }).promise

              return [
                target.documentResultId,
                canvas.toDataURL('image/png'),
              ] as const
            } catch {
              return [target.documentResultId, ''] as const
            }
          }),
        )

        if (!cancelled) {
          setThumbnailByTarget(
            Object.fromEntries(
              nextEntries.filter(([, imageUrl]) => imageUrl.length > 0),
            ),
          )
        }
      } catch {
        if (!cancelled) {
          setThumbnailByTarget({})
        }
      }
    }

    void loadThumbnails()

    return () => {
      cancelled = true
    }
  }, [context])

  const activeTarget = useMemo(
    () =>
      context?.targets.find(
        (target) => target.documentResultId === selectedTargetId,
      ) ??
      context?.targets[0] ??
      null,
    [context, selectedTargetId],
  )

  const activePlacement = activeTarget
    ? getAutoTextBlockRect(
        placements[activeTarget.documentResultId] ??
          getTargetPlacement(activeTarget),
        buildSignatureCaption(signatureForm),
      )
    : DEFAULT_SIGNATURE_RECT
  const activePreviewMode = activeTarget
    ? (previewModeByTarget[activeTarget.documentResultId] ??
      getTargetPreviewMode(activeTarget))
    : 'source'
  const activeSignatureImageRect = activeTarget
    ? (signatureImageRectByTarget[activeTarget.documentResultId] ??
      getDefaultSignatureImageRect(
        activePlacement,
        signatureForm.signatureImageWidth ??
          context?.signatureProfile?.signatureImageWidth ??
          1,
        signatureForm.signatureImageHeight ??
          context?.signatureProfile?.signatureImageHeight ??
          1,
      ))
    : getDefaultSignatureImageRect(
        activePlacement,
        signatureForm.signatureImageWidth ??
          context?.signatureProfile?.signatureImageWidth ??
          1,
        signatureForm.signatureImageHeight ??
          context?.signatureProfile?.signatureImageHeight ??
          1,
      )
  const visibleSignatureImageRect = fitRectWithinRect(
    activeSignatureImageRect,
    signatureForm.signatureImageWidth ??
      context?.signatureProfile?.signatureImageWidth ??
      1,
    signatureForm.signatureImageHeight ??
      context?.signatureProfile?.signatureImageHeight ??
      1,
  )
  const activePdfLabel =
    activePreviewMode === 'signed' && activeTarget?.signedPdfUrl
      ? 'Signed preview'
      : 'Source preview'

  useEffect(() => {
    if (!activeTarget) {
      return
    }

    let cancelled = false

    const renderPdf = async () => {
      const targetUrl =
        activePreviewMode === 'signed' && activeTarget.signedPdfUrl
          ? activeTarget.signedPdfUrl
          : activeTarget.sourcePdfUrl

      try {
        setPdfError(null)
        const pdfjs = await loadPdfJs()

        const loadingTask = pdfjs.getDocument(targetUrl)
        const pdfDocument = await loadingTask.promise
        const page = await pdfDocument.getPage(
          clamp(
            activeTarget.previewPageNumber,
            1,
            Math.max(pdfDocument.numPages, 1),
          ),
        )
        const viewport = page.getViewport({
          scale: Math.max(1.25, zoomPercent / 70),
        })
        const canvas = canvasRef.current
        if (!canvas || cancelled) {
          return
        }

        const context2d = canvas.getContext('2d')
        if (!context2d) {
          throw new Error('Canvas is not available.')
        }

        canvas.width = viewport.width
        canvas.height = viewport.height

        await page.render({
          canvasContext: context2d,
          viewport,
        }).promise
      } catch (error) {
        if (!cancelled) {
          setPdfError(
            error instanceof Error
              ? error.message
              : 'Unable to render the certificate preview.',
          )
        }
      }
    }

    void renderPdf()

    return () => {
      cancelled = true
    }
  }, [activePreviewMode, activeTarget, zoomPercent])

  const signatureProfileComplete = useMemo(
    () =>
      signatureForm.displayName.trim().length > 0 &&
      signatureForm.designation.trim().length > 0 &&
      signatureForm.tin.trim().length > 0 &&
      signaturePreviewUrl.length > 0,
    [signatureForm, signaturePreviewUrl],
  )

  const pendingTargets = useMemo(
    () =>
      context?.targets.filter((target) => target.signingStatus !== 'signed') ??
      [],
    [context],
  )
  const pendingTargetCount = pendingTargets.length
  const placedPendingTargetCount = pendingTargets.filter(
    (target) => placementReadyByTarget[target.documentResultId],
  ).length
  const allPendingTargetsPlaced =
    pendingTargetCount === 0 ||
    pendingTargets.every(
      (target) => placementReadyByTarget[target.documentResultId],
    )
  const allTargetsPlaced =
    Boolean(context) &&
    context.targets.every(
      (target) => placementReadyByTarget[target.documentResultId],
    )

  const canSubmitSignature =
    Boolean(context) &&
    pendingTargetCount > 0 &&
    signatureProfileComplete &&
    allPendingTargetsPlaced
  const signActionLabel =
    pendingTargetCount === 1
      ? workspaceLabel === 'batch'
        ? 'Sign'
        : 'Sign document'
      : `Sign ${pendingTargetCount} pages`
  const signConfirmationDescription =
    pendingTargetCount === 1
      ? workspaceLabel === 'batch'
        ? 'This will apply the saved signature placement to the unsigned certificate page in this batch and generate a signed PDF.'
        : 'This will apply the saved signature placement to this document and generate a signed PDF.'
      : `This will apply the saved signature placements to ${pendingTargetCount} unsigned certificate pages and generate signed PDFs.`
  const signedTargets =
    context?.targets.filter((target) => target.signingStatus === 'signed') ?? []
  const signedTargetCount = signedTargets.length
  const documentIsSigned =
    Boolean(context) &&
    context.targets.length > 0 &&
    signedTargetCount === context.targets.length
  const canApplyResignBatch =
    workspaceLabel === 'batch' &&
    documentIsSigned &&
    isResigningBatch &&
    signatureProfileComplete &&
    allTargetsPlaced
  const isActiveTargetPlacementLocked =
    activeTarget?.signingStatus === 'signed' && !isResigningBatch
  const latestSignedTarget = signedTargets
    .slice()
    .sort((left, right) =>
      (right.signedAt ?? '').localeCompare(left.signedAt ?? ''),
    )
    .at(0)
  const activeTargetIndex = Math.max(
    context?.targets.findIndex(
      (target) => target.documentResultId === activeTarget?.documentResultId,
    ) ?? 0,
    0,
  )
  const pageCount = context?.targets.length ?? 0
  const currentDownloadUrl =
    activePreviewMode === 'signed'
      ? activeTarget?.signedPdfUrl
      : activeTarget?.sourcePdfUrl
  const currentPageIndicator = activeTargetIndex + 1
  const placementPositionLabel = toPlacementPositionLabel(activePlacement)
  const shouldShowProfileEditor =
    isEditingProfile || !context?.signatureProfile || !signaturePreviewUrl

  const jumpToTargetIndex = (targetIndex: number) => {
    if (!context) {
      return
    }

    const nextTarget =
      context.targets[clamp(targetIndex, 0, context.targets.length - 1)]

    setSelectedTargetId(nextTarget.documentResultId)
    setSignError('')
  }

  const handlePageNumberInput = (rawValue: string) => {
    const nextValue = Number(rawValue)
    if (!Number.isFinite(nextValue)) {
      return
    }

    jumpToTargetIndex(clamp(nextValue, 1, pageCount) - 1)
  }

  const updateZoom = (nextZoom: number) => {
    setZoomPreset('custom')
    setZoomPercent(clamp(nextZoom, 70, 180))
  }

  const handleZoomPresetChange = (value: string) => {
    if (
      value !== 'fit-width' &&
      value !== 'comfortable' &&
      value !== 'actual-size'
    ) {
      return
    }

    setZoomPreset(value)
    setZoomPercent(getZoomPercentForPreset(value))
  }

  const handlePlacementClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (
      !activeTarget ||
      activePreviewMode === 'signed' ||
      isActiveTargetPlacementLocked
    ) {
      return
    }

    const bounds =
      pdfFrameRef.current?.getBoundingClientRect() ??
      event.currentTarget.getBoundingClientRect()
    const isInsideFrame =
      event.clientX >= bounds.left &&
      event.clientX <= bounds.right &&
      event.clientY >= bounds.top &&
      event.clientY <= bounds.bottom

    if (!isInsideFrame) {
      return
    }

    if (placementStep === 'text') {
      const x = clamp(
        (event.clientX - bounds.left) / bounds.width -
          activePlacement.width / 2,
        0,
        1 - activePlacement.width,
      )
      const y = clamp(
        (event.clientY - bounds.top) / bounds.height -
          activePlacement.height / 2,
        0,
        1 - activePlacement.height,
      )
      const nextPlacement = {
        ...activePlacement,
        x,
        y,
      }

      setPlacements((current) => ({
        ...current,
        [activeTarget.documentResultId]: nextPlacement,
      }))
      setNotice(
        `Text block placed for certificate page ${activeTarget.certificatePageNumber}.`,
      )
    } else {
      const nextSignatureImageRect = clampRectToPage({
        ...activeSignatureImageRect,
        x:
          (event.clientX - bounds.left) / bounds.width -
          activeSignatureImageRect.width / 2,
        y:
          (event.clientY - bounds.top) / bounds.height -
          activeSignatureImageRect.height / 2,
      })

      setSignatureImageRectByTarget((current) => ({
        ...current,
        [activeTarget.documentResultId]: nextSignatureImageRect,
      }))
      setNotice(
        `Signature placed for certificate page ${activeTarget.certificatePageNumber}.`,
      )
    }
    setPlacementReadyByTarget((current) => ({
      ...current,
      [activeTarget.documentResultId]: true,
    }))
    setSignError('')
  }

  const updateSignatureImageSize = (rawValue: string) => {
    if (!activeTarget || isActiveTargetPlacementLocked) {
      return
    }

    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) {
      return
    }

    const requestedWidth = clamp(parsed / 100, 0.03, 0.5)
    const currentAspectRatio =
      activeSignatureImageRect.width > 0
        ? activeSignatureImageRect.height / activeSignatureImageRect.width
        : 0.5
    const unclampedHeight = requestedWidth * currentAspectRatio
    const nextHeight = clamp(unclampedHeight, 0.02, 0.5)
    const nextWidth =
      unclampedHeight > 0.5 && currentAspectRatio > 0
        ? nextHeight / currentAspectRatio
        : requestedWidth
    const nextSignatureImageRect = clampRectToPage({
      ...activeSignatureImageRect,
      width: nextWidth,
      height: nextHeight,
    })

    setSignatureImageRectByTarget((current) => ({
      ...current,
      [activeTarget.documentResultId]: nextSignatureImageRect,
    }))
    setPlacementReadyByTarget((current) => ({
      ...current,
      [activeTarget.documentResultId]: true,
    }))
    setNotice(
      `Signature size updated for certificate page ${activeTarget.certificatePageNumber}.`,
    )
    setSignError('')
  }

  const applyPlacementToEditablePages = () => {
    if (!context || !activeTarget || isActiveTargetPlacementLocked) {
      return
    }

    const editableTargets = context.targets.filter(
      (target) => isResigningBatch || target.signingStatus !== 'signed',
    )

    if (editableTargets.length <= 1) {
      setNotice(
        isResigningBatch
          ? 'This is already the only certificate page in the batch.'
          : 'This is already the only unsigned certificate page.',
      )
      return
    }

    const nextPlacements = Object.fromEntries(
      editableTargets.map((target) => [
        target.documentResultId,
        { ...activePlacement },
      ]),
    )
    const nextSignatureImageRects = Object.fromEntries(
      editableTargets.map((target) => [
        target.documentResultId,
        { ...activeSignatureImageRect },
      ]),
    )
    const nextPlacementReady = Object.fromEntries(
      editableTargets.map((target) => [target.documentResultId, true]),
    )
    const otherPageCount = editableTargets.filter(
      (target) => target.documentResultId !== activeTarget.documentResultId,
    ).length

    setPlacements((current) => ({
      ...current,
      ...nextPlacements,
    }))
    setSignatureImageRectByTarget((current) => ({
      ...current,
      ...nextSignatureImageRects,
    }))
    setPlacementReadyByTarget((current) => ({
      ...current,
      ...nextPlacementReady,
    }))
    setNotice(
      otherPageCount === 1
        ? isResigningBatch
          ? 'Applied this placement to 1 other certificate.'
          : 'Applied this placement to 1 other unsigned certificate.'
        : isResigningBatch
          ? `Applied this placement to ${otherPageCount} other certificates.`
          : `Applied this placement to ${otherPageCount} other unsigned certificates.`,
    )
    setSignError('')
  }

  const handleSignatureFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setProfileError('Signature image must be a PNG or JPEG file.')
      return
    }

    try {
      const dataUrl = await fileToDataUrl(file)
      const dimensions = await loadImageDimensions(dataUrl)

      setSignatureForm((current) => ({
        ...current,
        signatureImageDataUrl: dataUrl,
        signatureImageMimeType: file.type as 'image/png' | 'image/jpeg',
        signatureImageWidth: dimensions.width,
        signatureImageHeight: dimensions.height,
      }))
      setSignaturePreviewUrl(dataUrl)
      setProfileError('')
    } catch (error) {
      setProfileError(
        error instanceof Error
          ? error.message
          : 'Unable to load the selected signature image.',
      )
    }
  }

  const handleSaveProfile = async () => {
    setProfileError('')
    setNotice('')
    setIsSavingProfile(true)

    try {
      const response = await fetch('/api/users/me/signature-profile', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(signatureForm),
      })
      const payload = await readJson<SignatureProfileResponse>(response)

      if (!response.ok || !payload?.profile) {
        throw new Error(
          payload?.error ||
            `Unable to save signature profile (${response.status}).`,
        )
      }

      setContext((current) =>
        current
          ? {
              ...current,
              signatureProfile: payload.profile ?? null,
            }
          : current,
      )
      setSignatureForm(defaultSignatureFormState(payload.profile))
      setSignaturePreviewUrl(payload.profile.signatureImageUrl)
      setIsEditingProfile(false)
      setNotice('Signature profile saved.')
      toast.success('Signature profile saved')
    } catch (error) {
      setProfileError(
        error instanceof Error
          ? error.message
          : 'Unable to save signature profile.',
      )
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handleSign = async ({ resign = false }: { resign?: boolean } = {}) => {
    if (!context) {
      return
    }
    const targetsToSign = resign ? context.targets : pendingTargets

    if (resign && workspaceLabel !== 'batch') {
      setSignError('Re-signing is available from upload batches only.')
      return
    }

    if (targetsToSign.length === 0) {
      setSignError(
        resign
          ? 'No certificates are available to re-sign.'
          : 'All certificates are already signed.',
      )
      return
    }

    if (!signatureProfileComplete) {
      setSignError('Save a complete signature profile before signing.')
      return
    }

    if (
      !targetsToSign.every(
        (target) => placementReadyByTarget[target.documentResultId],
      )
    ) {
      setSignError(
        resign
          ? 'Every certificate page needs a saved placement before re-signing.'
          : 'Place the text block on each unsigned page first.',
      )
      return
    }

    setIsSigning(true)
    setSignError('')
    setNotice('')

    try {
      const response = await fetch(signEndpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          resign,
          targets: targetsToSign.map((target) => ({
            documentResultId: target.documentResultId,
            pageNumber: target.previewPageNumber,
            signatureRect: getAutoTextBlockRect(
              placements[target.documentResultId] ?? getTargetPlacement(target),
              buildSignatureCaption(signatureForm),
            ),
            signatureImageRect:
              signatureImageRectByTarget[target.documentResultId] ??
              getDefaultSignatureImageRect(
                getAutoTextBlockRect(
                  placements[target.documentResultId] ??
                    getTargetPlacement(target),
                  buildSignatureCaption(signatureForm),
                ),
                signatureForm.signatureImageWidth ??
                  context.signatureProfile?.signatureImageWidth ??
                  1,
                signatureForm.signatureImageHeight ??
                  context.signatureProfile?.signatureImageHeight ??
                  1,
              ),
          })),
        }),
      })
      const payload = await readJson<SignResponse>(response)

      if (!response.ok || !payload?.signedArtifacts?.length) {
        throw new Error(
          payload?.error ||
            `Unable to sign ${workspaceLabel} (${response.status}).`,
        )
      }

      const signedArtifactById = new Map(
        payload.signedArtifacts.map((artifact) => [
          artifact.documentResultId,
          artifact,
        ]),
      )

      setContext((current) =>
        current
          ? {
              ...current,
              targets: current.targets.map((target) => {
                const signedArtifact = signedArtifactById.get(
                  target.documentResultId,
                )
                if (!signedArtifact) {
                  return target
                }

                return {
                  ...target,
                  signingStatus: signedArtifact.status,
                  signedAt: signedArtifact.signedAt,
                  signedByName: signedArtifact.signedByName,
                  signedPdfUrl:
                    signedArtifact.signedPdfUrl ?? target.signedPdfUrl,
                  hasSavedTemplatePlacement: true,
                  templatePlacement:
                    signedArtifact.templatePlacement ??
                    target.templatePlacement,
                }
              }),
            }
          : current,
      )
      setPlacements((current) => ({
        ...current,
        ...Object.fromEntries(
          payload.signedArtifacts.flatMap((artifact) =>
            artifact.templatePlacement
              ? [
                  [
                    artifact.documentResultId,
                    getAutoTextBlockRect(
                      artifact.templatePlacement.signatureRect,
                      buildSignatureCaption(signatureForm),
                    ),
                  ],
                ]
              : [],
          ),
        ),
      }))
      setSignatureImageRectByTarget((current) => ({
        ...current,
        ...Object.fromEntries(
          payload.signedArtifacts.flatMap((artifact) =>
            artifact.templatePlacement?.signatureImageRect
              ? [
                  [
                    artifact.documentResultId,
                    artifact.templatePlacement.signatureImageRect,
                  ],
                ]
              : [],
          ),
        ),
      }))
      setPlacementReadyByTarget((current) => ({
        ...current,
        ...Object.fromEntries(
          payload.signedArtifacts.map((artifact) => [
            artifact.documentResultId,
            true,
          ]),
        ),
      }))
      setPreviewModeByTarget((current) => ({
        ...current,
        ...Object.fromEntries(
          payload.signedArtifacts.map((artifact) => [
            artifact.documentResultId,
            artifact.signedPdfUrl
              ? 'signed'
              : (current[artifact.documentResultId] ?? 'source'),
          ]),
        ),
      }))
      setNotice(
        payload.signedArtifacts.length === 1
          ? resign
            ? 'Re-signed 1 certificate.'
            : 'Signed 1 certificate.'
          : resign
            ? `Re-signed ${payload.signedArtifacts.length} certificates.`
            : `Signed ${payload.signedArtifacts.length} certificates.`,
      )
      toast.success(
        resign
          ? 'Batch re-signed'
          : payload.signedArtifacts.length === 1
            ? 'Certificate signed'
            : 'Certificates signed',
        {
          description: resign
            ? `Replaced the signed PDFs for ${payload.signedArtifacts.length} certificates.`
            : payload.signedArtifacts.length === 1
              ? 'The signed PDF is now available in the document workspace.'
              : `Signed ${payload.signedArtifacts.length} certificates and updated the document workspace.`,
        },
      )
      if (resign) {
        setIsResigningBatch(false)
        setIsResignDialogOpen(false)
      }
    } catch (error) {
      setSignError(
        error instanceof Error ? error.message : 'Unable to sign the document.',
      )
    } finally {
      setIsSigning(false)
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Loading signing workspace…
        </CardContent>
      </Card>
    )
  }

  if (loadError || !context || !activeTarget) {
    return (
      <Alert variant="destructive">
        <IconAlertCircle />
        <AlertTitle>Unable to open signing workspace</AlertTitle>
        <AlertDescription>
          {loadError ?? 'Document not found.'}
        </AlertDescription>
      </Alert>
    )
  }

  const profileView = context.signatureProfile

  return (
    <div className="overflow-hidden rounded-[32px] border border-border/60 bg-card shadow-xs">
      <div className="flex flex-col gap-6 p-4 sm:p-5 lg:p-6">
        <section className="flex flex-col gap-5 border-b border-border/50 pb-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 flex-col gap-4">
              <div className="min-w-0">
                <p className="truncate text-lg font-medium">
                  {context.fileName}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <IconFileDescription />
                    {context.certificateCount} certificates
                  </span>
                  {latestSignedTarget && latestSignedTarget.signedAt ? (
                    <span className="inline-flex items-center gap-2">
                      <IconCalendarEvent />
                      Signed {latestSignedTarget.signedAt}
                    </span>
                  ) : null}
                  {latestSignedTarget && latestSignedTarget.signedByName ? (
                    <span className="inline-flex items-center gap-2">
                      <IconUser />
                      Signed by {latestSignedTarget.signedByName}
                    </span>
                  ) : null}
                  <Badge variant="outline">
                    {documentIsSigned
                      ? 'Signed'
                      : `${pendingTargetCount} unsigned`}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {documentIsSigned &&
              workspaceLabel === 'batch' &&
              !isResigningBatch ? (
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => {
                    setIsResigningBatch(true)
                    setSignError('')
                    setNotice(
                      'Move the placement on the source PDF, then apply the re-sign.',
                    )
                    setPreviewModeByTarget((current) => ({
                      ...current,
                      ...Object.fromEntries(
                        context.targets.map((target) => [
                          target.documentResultId,
                          'source' as const,
                        ]),
                      ),
                    }))
                  }}
                >
                  <IconSignature data-icon="inline-start" />
                  Re-sign batch
                </Button>
              ) : documentIsSigned &&
                workspaceLabel === 'batch' &&
                isResigningBatch ? (
                <AlertDialog
                  open={isResignDialogOpen}
                  onOpenChange={setIsResignDialogOpen}
                >
                  <AlertDialogTrigger
                    render={
                      <Button
                        size="lg"
                        disabled={!canApplyResignBatch || isSigning}
                      />
                    }
                  >
                    <IconSignature data-icon="inline-start" />
                    {isSigning ? 'Re-signing batch...' : 'Apply re-sign'}
                  </AlertDialogTrigger>
                  <AlertDialogContent size="sm">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Re-sign this batch?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will generate new signed PDFs for every certificate
                        page in the closed batch and make the latest signed
                        versions active.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={isSigning}>
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction
                        disabled={!canApplyResignBatch || isSigning}
                        onClick={() => {
                          setIsResignDialogOpen(false)
                          void handleSign({ resign: true })
                        }}
                      >
                        Re-sign batch
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : documentIsSigned ? (
                <Button size="lg" disabled>
                  <IconCheck data-icon="inline-start" />
                  {workspaceLabel === 'batch'
                    ? 'Batch signed'
                    : 'Document signed'}
                </Button>
              ) : (
                <AlertDialog
                  open={isSignDialogOpen}
                  onOpenChange={setIsSignDialogOpen}
                >
                  <AlertDialogTrigger
                    render={
                      <Button
                        size="lg"
                        disabled={!canSubmitSignature || isSigning}
                      />
                    }
                  >
                    <IconSignature data-icon="inline-start" />
                    {isSigning
                      ? `Signing ${workspaceLabel}...`
                      : signActionLabel}
                  </AlertDialogTrigger>
                  <AlertDialogContent size="sm">
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {pendingTargetCount === 1
                          ? 'Sign this page?'
                          : `Sign ${pendingTargetCount} pages?`}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {signConfirmationDescription}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={isSigning}>
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction
                        disabled={!canSubmitSignature || isSigning}
                        onClick={() => {
                          setIsSignDialogOpen(false)
                          void handleSign()
                        }}
                      >
                        {signActionLabel}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              {canDownloadSignedPdf && activeTarget.signedPdfUrl ? (
                <a
                  href={`/api/documents/${encodeURIComponent(
                    activeTarget.documentResultId,
                  )}/signed-pdf`}
                  className={buttonVariants({
                    size: 'lg',
                    variant: 'outline',
                  })}
                >
                  <IconDownload data-icon="inline-start" />
                  Download signed PDF
                </a>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="outline">
                    <IconDots />
                    <span className="sr-only">Open signing actions</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => setIsEditingProfile(true)}>
                      Edit signature profile
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        setPreviewModeByTarget((current) => ({
                          ...current,
                          [activeTarget.documentResultId]: 'source',
                        }))
                      }
                    >
                      View source PDF
                    </DropdownMenuItem>
                    {activeTarget.signedPdfUrl ? (
                      <DropdownMenuItem
                        onClick={() =>
                          setPreviewModeByTarget((current) => ({
                            ...current,
                            [activeTarget.documentResultId]: 'signed',
                          }))
                        }
                      >
                        View signed PDF
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              {isResigningBatch ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  disabled={isSigning}
                  onClick={() => {
                    setIsResigningBatch(false)
                    setIsResignDialogOpen(false)
                    setNotice('')
                    setSignError('')
                  }}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[17rem_minmax(0,1fr)_18.5rem]">
          <Card className="rounded-[28px] border-border/60 shadow-none">
            <CardHeader className="gap-2">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">Certificates</CardTitle>
                <Badge variant="outline">{pageCount}</Badge>
              </div>
              <CardDescription>
                {isResigningBatch
                  ? 'Adjust placement for the re-signed PDFs.'
                  : documentIsSigned
                    ? 'All certificates are signed.'
                    : `${placedPendingTargetCount} of ${pendingTargetCount} unsigned pages are ready.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-4">
                {context.targets.map((target) => {
                  const isSelected =
                    target.documentResultId === activeTarget.documentResultId
                  const placementReady =
                    placementReadyByTarget[target.documentResultId] ?? false
                  const targetThumbnail =
                    thumbnailByTarget[target.documentResultId]
                  const targetStateLabel =
                    isResigningBatch && target.signingStatus === 'signed'
                      ? 'Ready to re-sign'
                      : target.signingStatus === 'signed'
                        ? 'Signed'
                        : placementReady
                          ? 'Ready'
                          : 'Needs placement'
                  const identityLabel = getTargetIdentityLabel(target)
                  const secondaryLabel = getTargetSecondaryLabel(target)

                  return (
                    <button
                      key={target.documentResultId}
                      type="button"
                      onClick={() => {
                        setSelectedTargetId(target.documentResultId)
                        setSignError('')
                        if (isResigningBatch) {
                          setPreviewModeByTarget((current) => ({
                            ...current,
                            [target.documentResultId]: 'source',
                          }))
                        }
                      }}
                      className={cn(
                        'min-w-0 rounded-[24px] border p-3 text-left transition-colors',
                        isSelected
                          ? 'border-primary/60 bg-primary/5'
                          : 'border-border/60 bg-background hover:bg-muted/20',
                      )}
                    >
                      <div className="flex min-w-0 items-start gap-2.5">
                        <div className="shrink-0 overflow-hidden rounded-2xl border border-border/60 bg-muted/20">
                          {targetThumbnail ? (
                            <img
                              src={targetThumbnail}
                              alt={`Preview for ${identityLabel}`}
                              className="h-24 w-16 object-cover"
                            />
                          ) : (
                            <div className="flex h-24 w-16 items-center justify-center">
                              <IconFileDescription className="text-muted-foreground" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="break-words text-base leading-6 font-medium">
                                {identityLabel}
                              </div>
                              {secondaryLabel ? (
                                <p className="mt-1 break-all text-xs leading-5 text-muted-foreground">
                                  {secondaryLabel}
                                </p>
                              ) : null}
                            </div>
                            <span
                              className={cn(
                                'inline-flex size-5 shrink-0 items-center justify-center rounded-full border',
                                target.signingStatus === 'signed'
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : isSelected
                                    ? 'border-primary/40 text-primary'
                                    : 'border-border/60 text-muted-foreground',
                              )}
                            >
                              {target.signingStatus === 'signed' ? (
                                <IconCheck />
                              ) : (
                                <IconPencil />
                              )}
                            </span>
                          </div>
                          <div className="mt-2.5 flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{targetStateLabel}</Badge>
                            <Badge variant="outline">
                              Source page {target.certificatePageNumber}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>

              <Button
                type="button"
                variant="outline"
                className="justify-start"
                disabled={!isResigningBatch && pendingTargetCount === 0}
                onClick={() => {
                  const nextTarget =
                    (isResigningBatch
                      ? context.targets[0]
                      : context.targets.find(
                          (target) => target.signingStatus !== 'signed',
                        )) ?? context.targets[0]
                  setSelectedTargetId(nextTarget.documentResultId)
                  if (isResigningBatch) {
                    setPreviewModeByTarget((current) => ({
                      ...current,
                      [nextTarget.documentResultId]: 'source',
                    }))
                  }
                }}
              >
                <IconPencil data-icon="inline-start" />
                {isResigningBatch
                  ? 'Review all pages'
                  : pendingTargetCount === 0
                    ? 'All pages signed'
                    : 'Review unsigned pages'}
              </Button>
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-[28px] border-border/60 shadow-none">
            <CardHeader className="gap-4 border-b border-border/50 pb-4">
              <Tabs
                value={activePreviewMode}
                onValueChange={(value) =>
                  setPreviewModeByTarget((current) => ({
                    ...current,
                    [activeTarget.documentResultId]:
                      value === 'signed' ? 'signed' : 'source',
                  }))
                }
                className="gap-4"
              >
                <TabsList variant="line" className="gap-5 px-1">
                  <TabsTrigger value="source">Source PDF</TabsTrigger>
                  <TabsTrigger
                    value="signed"
                    disabled={!activeTarget.signedPdfUrl}
                  >
                    Signed PDF
                  </TabsTrigger>
                </TabsList>
                <TabsContent value={activePreviewMode} className="hidden" />
              </Tabs>

              <div className="flex flex-wrap items-center gap-2">
                <Button size="icon-sm" variant="outline" disabled>
                  <IconFileDescription />
                  <span className="sr-only">PDF tools</span>
                </Button>
                <div className="flex items-center gap-2 rounded-2xl border border-border/60 px-2 py-1.5">
                  <Input
                    type="number"
                    min={1}
                    max={pageCount}
                    value={currentPageIndicator}
                    onChange={(event) =>
                      handlePageNumberInput(event.target.value)
                    }
                    className="h-8 w-14 border-0 bg-transparent px-2 text-center shadow-none"
                  />
                  <span className="text-sm text-muted-foreground">
                    / {pageCount}
                  </span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={currentPageIndicator <= 1}
                    onClick={() => jumpToTargetIndex(activeTargetIndex - 1)}
                  >
                    <IconChevronLeft />
                    <span className="sr-only">Previous page</span>
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={currentPageIndicator >= pageCount}
                    onClick={() => jumpToTargetIndex(activeTargetIndex + 1)}
                  >
                    <IconChevronRight />
                    <span className="sr-only">Next page</span>
                  </Button>
                </div>
                <div className="flex items-center rounded-2xl border border-border/60">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => updateZoom(zoomPercent - 10)}
                  >
                    <IconMinus />
                    <span className="sr-only">Zoom out</span>
                  </Button>
                  <Separator orientation="vertical" className="h-6" />
                  <div className="min-w-16 px-3 text-center text-sm font-medium">
                    {zoomPercent}%
                  </div>
                  <Separator orientation="vertical" className="h-6" />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => updateZoom(zoomPercent + 10)}
                  >
                    <IconPlus />
                    <span className="sr-only">Zoom in</span>
                  </Button>
                </div>
                <Select
                  value={zoomPreset === 'custom' ? 'fit-width' : zoomPreset}
                  onValueChange={handleZoomPresetChange}
                >
                  <SelectTrigger size="sm">
                    <SelectValue placeholder="Fit width" />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectGroup>
                      <SelectItem value="fit-width">Fit width</SelectItem>
                      <SelectItem value="comfortable">Comfortable</SelectItem>
                      <SelectItem value="actual-size">Actual size</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button
                  size="icon-sm"
                  variant="outline"
                  onClick={() => {
                    if (previewRef.current) {
                      void previewRef.current.requestFullscreen()
                    }
                  }}
                >
                  <IconArrowsMaximize />
                  <span className="sr-only">Fullscreen preview</span>
                </Button>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {pdfError ? (
                <div className="p-6">
                  <Alert variant="destructive">
                    <IconAlertCircle />
                    <AlertTitle>Preview unavailable</AlertTitle>
                    <AlertDescription>{pdfError}</AlertDescription>
                  </Alert>
                </div>
              ) : null}

              <div
                ref={previewRef}
                className="relative overflow-auto bg-muted/10"
                onClick={handlePlacementClick}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                  }
                }}
              >
                <div className="flex min-h-[48rem] min-w-full items-start justify-center p-6">
                  <div
                    ref={pdfFrameRef}
                    className="relative"
                    style={{
                      width: zoomPercent === 100 ? '100%' : `${zoomPercent}%`,
                    }}
                  >
                    <div className="overflow-hidden rounded-[24px] border border-border/60 bg-background shadow-sm">
                      <canvas ref={canvasRef} className="block h-auto w-full" />
                    </div>
                    {activePreviewMode === 'source' ? (
                      <>
                        <div
                          className="pointer-events-none absolute rounded-xl border border-primary/60 bg-primary/5 shadow-sm"
                          style={{
                            left: `${activePlacement.x * 100}%`,
                            top: `${activePlacement.y * 100}%`,
                            width: `${activePlacement.width * 100}%`,
                            height: `${activePlacement.height * 100}%`,
                          }}
                        >
                          <div className="absolute inset-0 flex items-center justify-center overflow-hidden whitespace-pre px-3 text-center text-[6px] leading-none text-primary">
                            {buildSignatureCaption(signatureForm)}
                          </div>
                        </div>
                        <div
                          className={cn(
                            'pointer-events-none absolute rounded-lg border border-dashed bg-primary/5 shadow-sm',
                            placementStep === 'signature'
                              ? 'border-primary/70'
                              : 'border-primary/30',
                          )}
                          style={toPercentRect(activeSignatureImageRect)}
                        >
                          {signaturePreviewUrl ? (
                            <div
                              className="absolute"
                              style={toRelativePercentRect(
                                activeSignatureImageRect,
                                visibleSignatureImageRect,
                              )}
                            >
                              <img
                                src={signaturePreviewUrl}
                                alt="Signature preview"
                                className="block h-full w-full"
                              />
                            </div>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4">
            <Card className="rounded-[28px] border-border/60 shadow-none">
              <CardContent className="flex flex-col gap-5 p-5">
                <div className="flex items-start gap-3">
                  <span className="inline-flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <IconCircleCheckFilled />
                  </span>
                  <div>
                    <p className="font-semibold">
                      {isResigningBatch
                        ? 'Adjust placement'
                        : documentIsSigned
                          ? 'Document signed'
                          : 'Ready to sign'}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {isResigningBatch
                        ? `Move the signature placement across ${context.certificateCount} certificates, then apply the re-sign.`
                        : documentIsSigned
                          ? `All ${context.certificateCount} certificates have been signed.`
                          : pendingTargetCount === 1
                            ? '1 certificate still needs a signature.'
                            : `${pendingTargetCount} certificates still need signatures.`}
                    </p>
                  </div>
                </div>
                {latestSignedTarget && latestSignedTarget.signedAt ? (
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>Signed on {latestSignedTarget.signedAt}</p>
                    {latestSignedTarget.signedByName ? (
                      <p>Signed by {latestSignedTarget.signedByName}</p>
                    ) : null}
                  </div>
                ) : null}
                {!documentIsSigned ? (
                  <div className="text-sm text-muted-foreground">
                    {allPendingTargetsPlaced
                      ? 'The document is ready for signing.'
                      : 'Place the text block and signature on each unsigned page first.'}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="rounded-[28px] border-border/60 shadow-none">
              <CardHeader className="gap-2">
                <CardTitle className="text-base">
                  Placement
                  <span className="ml-1 text-muted-foreground">
                    {isActiveTargetPlacementLocked
                      ? '(read-only)'
                      : '(text + signature)'}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid gap-3 text-sm">
                  <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
                    <span className="text-muted-foreground">Text position</span>
                    <span>{placementPositionLabel}</span>
                  </div>
                  <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
                    <span className="text-muted-foreground">Text size</span>
                    <span>
                      Auto-fit ({toPercentValue(activePlacement.width)}% x{' '}
                      {toPercentValue(activePlacement.height)}%)
                    </span>
                  </div>
                  <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
                    <span className="text-muted-foreground">
                      Signature size
                    </span>
                    <span>
                      {toPercentValue(activeSignatureImageRect.width)}% x{' '}
                      {toPercentValue(activeSignatureImageRect.height)}%
                    </span>
                  </div>
                </div>
                {!isActiveTargetPlacementLocked ? (
                  <FieldGroup>
                    <Field>
                      <FieldLabel>Placement step</FieldLabel>
                      <FieldContent>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant={
                              placementStep === 'text' ? 'default' : 'outline'
                            }
                            onClick={() => setPlacementStep('text')}
                          >
                            Place text block
                          </Button>
                          <Button
                            type="button"
                            variant={
                              placementStep === 'signature'
                                ? 'default'
                                : 'outline'
                            }
                            onClick={() => setPlacementStep('signature')}
                          >
                            Place signature
                          </Button>
                        </div>
                        <FieldDescription>
                          Step 1: place the Name / Designation / TIN block. Step
                          2: place the e-signature separately.
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="signature-size">
                        Signature size
                      </FieldLabel>
                      <FieldContent>
                        <Input
                          id="signature-size"
                          type="number"
                          min={3}
                          max={50}
                          value={toPercentValue(activeSignatureImageRect.width)}
                          onChange={(event) =>
                            updateSignatureImageSize(event.target.value)
                          }
                        />
                        <FieldDescription>
                          Resizes the e-signature while keeping its current
                          proportions.
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                    <Field>
                      <FieldLabel>Reuse placement</FieldLabel>
                      <FieldContent>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-auto justify-start whitespace-normal text-left"
                          onClick={applyPlacementToEditablePages}
                          disabled={
                            isResigningBatch
                              ? context.targets.length <= 1
                              : pendingTargetCount <= 1
                          }
                        >
                          <IconCopy data-icon="inline-start" />
                          {isResigningBatch
                            ? 'Apply to all pages'
                            : 'Apply to all unsigned pages'}
                        </Button>
                        <FieldDescription>
                          Copies the current text block, signature placement,
                          and signature size to the rest of the{' '}
                          {isResigningBatch ? 'batch' : 'unsigned'}{' '}
                          certificates.
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                  </FieldGroup>
                ) : null}
                <p className="text-sm text-muted-foreground">
                  {notice ||
                    (isActiveTargetPlacementLocked
                      ? 'This placement is locked because the selected page is already signed.'
                      : placementStep === 'text'
                        ? 'Click the preview to place the Name / Designation / TIN block first. Its size updates automatically from the current value.'
                        : 'Click the preview again to place the e-signature anywhere on the page.')}
                </p>
              </CardContent>
            </Card>

            <Card className="rounded-[28px] border-border/60 shadow-none">
              <CardHeader className="gap-2">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Signature profile</CardTitle>
                  {profileView && !shouldShowProfileEditor ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsEditingProfile(true)}
                    >
                      Edit
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent>
                {shouldShowProfileEditor ? (
                  <FieldGroup>
                    <Field data-invalid={profileError ? true : undefined}>
                      <FieldLabel htmlFor="signer-name">Name</FieldLabel>
                      <FieldContent>
                        <Input
                          id="signer-name"
                          value={signatureForm.displayName}
                          onChange={(event) =>
                            setSignatureForm((current) => ({
                              ...current,
                              displayName: event.target.value,
                            }))
                          }
                          aria-invalid={profileError ? true : undefined}
                        />
                      </FieldContent>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="signer-designation">
                        Designation
                      </FieldLabel>
                      <FieldContent>
                        <Input
                          id="signer-designation"
                          value={signatureForm.designation}
                          onChange={(event) =>
                            setSignatureForm((current) => ({
                              ...current,
                              designation: event.target.value,
                            }))
                          }
                        />
                      </FieldContent>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="signer-tin">TIN</FieldLabel>
                      <FieldContent>
                        <Input
                          id="signer-tin"
                          value={signatureForm.tin}
                          onChange={(event) =>
                            setSignatureForm((current) => ({
                              ...current,
                              tin: event.target.value,
                            }))
                          }
                        />
                      </FieldContent>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="signature-image">
                        Signature image
                      </FieldLabel>
                      <FieldContent>
                        <Input
                          id="signature-image"
                          type="file"
                          accept="image/png,image/jpeg"
                          onChange={handleSignatureFileChange}
                        />
                        <FieldDescription>
                          Upload a transparent PNG or JPEG e-signature.
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                    {signaturePreviewUrl ? (
                      <div className="rounded-[24px] border border-border/60 bg-muted/20 p-4">
                        <img
                          src={signaturePreviewUrl}
                          alt="Saved signature preview"
                          className="max-h-28 max-w-full object-contain"
                        />
                      </div>
                    ) : null}
                    <FieldError>{profileError}</FieldError>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        onClick={handleSaveProfile}
                        disabled={isSavingProfile}
                      >
                        <IconDeviceFloppy data-icon="inline-start" />
                        {isSavingProfile ? 'Saving…' : 'Save profile'}
                      </Button>
                      {profileView ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setIsEditingProfile(false)
                            setProfileError('')
                            setSignatureForm(
                              defaultSignatureFormState(profileView),
                            )
                            setSignaturePreviewUrl(
                              profileView.signatureImageUrl,
                            )
                          }}
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </FieldGroup>
                ) : (
                  <div className="flex flex-col gap-5">
                    <div className="grid gap-4 text-sm">
                      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
                        <span className="text-muted-foreground">Name</span>
                        <span>{profileView?.displayName}</span>
                      </div>
                      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
                        <span className="text-muted-foreground">
                          Designation
                        </span>
                        <span>{profileView?.designation}</span>
                      </div>
                      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
                        <span className="text-muted-foreground">TIN</span>
                        <span>{profileView?.tin}</span>
                      </div>
                    </div>
                    <div>
                      <p className="mb-3 text-sm text-muted-foreground">
                        Signature
                      </p>
                      <div className="rounded-[24px] border border-border/60 bg-muted/20 p-4">
                        <img
                          src={profileView?.signatureImageUrl}
                          alt="Saved signature preview"
                          className="max-h-28 max-w-full object-contain"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex flex-col gap-3">
              {signError ? (
                <Alert variant="destructive">
                  <IconAlertCircle />
                  <AlertTitle>Unable to sign</AlertTitle>
                  <AlertDescription>{signError}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
