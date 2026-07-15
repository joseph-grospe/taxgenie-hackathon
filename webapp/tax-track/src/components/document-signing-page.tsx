import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker, useNavigate } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
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
  IconDotsVertical,
  IconDownload,
  IconFileDescription,
  IconLoader2,
  IconMinus,
  IconPencil,
  IconPlus,
  IconSignature,
  IconUser,
  IconX,
} from '@tabler/icons-react'
import {
  formatTinForDisplay,
  normalizeTinDigits,
} from '@taxtrack/shared/utils/tin'
import { toast } from 'sonner'

import type {
  SignaturePlacementTemplate,
  SignatureProfileView,
  SignatureRect,
  SigningContextView,
  SigningTargetView,
} from '@/lib/signing-module'
import {
  getAutoTextBlockRect,
  getAutoTextBlockSize,
  getDefaultSignatureImageRect,
  getSignatureCaptionLayoutRects,
  getSignatureTextFontSize,
} from '@/lib/signing-placement'
import {
  SIGNING_TOUR_RESTART_EVENT,
  getProductTourTargetProps,
} from '@/lib/product-tours'
import { cn } from '@/lib/utils'
import { SigningTour } from '@/components/product-tour'
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const DEFAULT_SIGNATURE_RECT: SignatureRect = {
  x: 0.58,
  y: 0.66,
  width: 0.24,
  height: 0.16,
}
const DEFAULT_SIGNATURE_PLACEMENT_SCALE = 1
const MIN_SIGNATURE_PLACEMENT_SCALE = 0.85
const MAX_SIGNATURE_PLACEMENT_SCALE = 1.4
const SIGNATURE_PLACEMENT_SCALE_STEP = 0.05
const SIGNING_CHUNK_SIZE = 20
const SIGNING_LEAVE_WARNING =
  'Signing is still in progress. Leaving this page will stop the current signing run. Leave anyway?'

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

type SignedArtifactResult = NonNullable<SignResponse['signedArtifacts']>[number]

type SigningProgressState = {
  total: number
  completed: number
  currentChunkStart: number
  currentChunkEnd: number
  resign: boolean
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

type PreviewPageMetrics = {
  cssHeight: number
  pdfWidth: number
  pdfHeight: number
}

type DocumentSigningTourTargets = {
  certificateList?: string
  placement?: string
  preview?: string
  previewControls?: string
  previewTabs?: string
  profile?: string
  status?: string
  summary?: string
  toolbar?: string
}

const getOptionalTourTargetProps = (targetId?: string) =>
  targetId ? getProductTourTargetProps(targetId) : {}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const readJson = async <T,>(response: Response): Promise<T | null> => {
  return (await response.json().catch(() => null)) as T | null
}

const fetchSigningContext = async (contextEndpoint: string) => {
  const response = await fetch(contextEndpoint, {
    cache: 'no-store',
  })
  const payload = await readJson<SigningContextResponse>(response)

  if (!response.ok || !payload?.signingContext) {
    throw new Error(
      payload?.error || `Unable to load signing context (${response.status}).`,
    )
  }

  return payload.signingContext
}

const chunkItems = <T,>(items: Array<T>, size: number) => {
  const chunks: Array<Array<T>> = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
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
  tin: formatTinForDisplay(profile?.tin) || '',
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

const snapSignaturePlacementScale = (scale: number) => {
  const snappedScale =
    Math.round(scale / SIGNATURE_PLACEMENT_SCALE_STEP) *
    SIGNATURE_PLACEMENT_SCALE_STEP

  return clamp(
    snappedScale,
    MIN_SIGNATURE_PLACEMENT_SCALE,
    MAX_SIGNATURE_PLACEMENT_SCALE,
  )
}

const getSignaturePlacementScaleFromRect = (
  savedRect: SignatureRect | null | undefined,
  caption: string,
) => {
  if (!savedRect) {
    return DEFAULT_SIGNATURE_PLACEMENT_SCALE
  }

  const autoSize = getAutoTextBlockSize(caption)
  const widthScale = savedRect.width / autoSize.width

  return snapSignaturePlacementScale(widthScale)
}

const getTargetPlacementScale = (target: SigningTargetView, caption: string) =>
  getSignaturePlacementScaleFromRect(
    target.templatePlacement?.signatureRect,
    caption,
  )

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

const buildSignatureCaptionParts = (input: {
  displayName: string
  designation: string
  tin: string
}) => {
  const displayName = input.displayName.trim() || 'Name'
  const designation = input.designation.trim() || 'Designation'
  const tin = formatTinForDisplay(input.tin) || 'TIN'

  return { displayName, designation, tin }
}

const buildSignatureCaption = (input: {
  displayName: string
  designation: string
  tin: string
}) => {
  const { displayName, designation, tin } = buildSignatureCaptionParts(input)

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

export const buildSigningCompleteFlagModel = ({
  resign,
  signedCount,
}: {
  resign: boolean
  signedCount: number
}) => {
  const plural = signedCount !== 1

  return {
    title: resign
      ? plural
        ? 'Certificates re-signed'
        : 'Certificate re-signed'
      : plural
        ? 'Certificates signed'
        : 'Certificate signed',
    description: resign
      ? 'Next, merge the updated signed PDFs into EAFS-ready batches.'
      : plural
        ? 'Next, merge the signed PDFs into EAFS-ready batches.'
        : 'Next, merge the signed PDF into an EAFS-ready batch.',
    actionLabel: 'Merge PDFs',
    duration: 10_000,
    position: 'bottom-right' as const,
  }
}

export function SigningCompleteFlag({
  model,
  toastId,
  workspaceName,
  onOpenMerge,
}: {
  model: ReturnType<typeof buildSigningCompleteFlagModel>
  toastId: string | number
  workspaceName?: string
  onOpenMerge: () => void
}) {
  return (
    <div className="w-[23rem] max-w-[calc(100vw-2rem)] rounded-lg border border-border/70 bg-background p-3 text-foreground shadow-lg">
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
          <IconCheck className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{model.title}</p>
              {workspaceName ? (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {workspaceName}
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Dismiss signing next-step flag"
              className="-mr-1 -mt-1"
              onClick={() => toast.dismiss(toastId)}
            >
              <IconX />
            </Button>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {model.description}
          </p>
          <div className="mt-3 flex flex-nowrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-8 shrink-0 px-2.5"
              aria-label={model.actionLabel}
              onClick={() => {
                toast.dismiss(toastId)
                onOpenMerge()
              }}
            >
              <IconFileDescription data-icon="inline-start" />
              {model.actionLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function DocumentSigningPage({
  docId,
  batchId,
  canDownloadSignedPdf = false,
  isDownloadingSignedCertificates = false,
  onDownloadSignedCertificates,
  tourTargets,
}: {
  docId?: string
  batchId?: string
  canDownloadSignedPdf?: boolean
  isDownloadingSignedCertificates?: boolean
  onDownloadSignedCertificates?: () => void | Promise<void>
  tourTargets?: DocumentSigningTourTargets
}) {
  const navigate = useNavigate()
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
  const [placementScaleByTarget, setPlacementScaleByTarget] = useState<
    Record<string, number>
  >({})
  const [placementReadyByTarget, setPlacementReadyByTarget] = useState<
    Record<string, boolean>
  >({})
  const [previewModeByTarget, setPreviewModeByTarget] = useState<
    Record<string, PreviewMode>
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
  const [signingProgress, setSigningProgress] =
    useState<SigningProgressState | null>(null)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isSigning, setIsSigning] = useState(false)
  const [isSignDialogOpen, setIsSignDialogOpen] = useState(false)
  const [isResignDialogOpen, setIsResignDialogOpen] = useState(false)
  const [isResigningBatch, setIsResigningBatch] = useState(false)
  const [
    isDownloadingAllSignedCertificates,
    setIsDownloadingAllSignedCertificates,
  ] = useState(false)
  const [tourStartSignal, setTourStartSignal] = useState(0)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [previewPageMetrics, setPreviewPageMetrics] =
    useState<PreviewPageMetrics | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const pdfFrameRef = useRef<HTMLDivElement | null>(null)
  const certificateListRef = useRef<HTMLDivElement | null>(null)
  const signingStartedAtRef = useRef<Date | null>(null)
  const resignedTargetIdsRef = useRef<Set<string>>(new Set())

  const markSigningPlacementActivity = () => {
    signingStartedAtRef.current ??= new Date()
  }

  const resetSigningPlacementActivity = () => {
    signingStartedAtRef.current = null
  }

  const shouldBlockSigningNavigation = useCallback(() => {
    if (!isSigning) {
      return false
    }

    return !window.confirm(SIGNING_LEAVE_WARNING)
  }, [isSigning])

  useBlocker({
    shouldBlockFn: shouldBlockSigningNavigation,
    enableBeforeUnload: isSigning,
    disabled: !isSigning,
  })

  useEffect(() => {
    if (!tourTargets) {
      return
    }

    const handleTourRestart = (event: Event) => {
      const detail =
        event instanceof CustomEvent
          ? (event.detail as { signingId?: string } | null)
          : null

      if (detail?.signingId && detail.signingId !== signingId) {
        return
      }

      setTourStartSignal((current) => current + 1)
    }

    window.addEventListener(SIGNING_TOUR_RESTART_EVENT, handleTourRestart)

    return () => {
      window.removeEventListener(SIGNING_TOUR_RESTART_EVENT, handleTourRestart)
    }
  }, [signingId, tourTargets])

  const applySigningContext = useCallback((nextContext: SigningContextView) => {
    const nextSignatureForm = defaultSignatureFormState(
      nextContext.signatureProfile,
    )
    const nextSignatureCaption = buildSignatureCaption(nextSignatureForm)
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
    setPlacementScaleByTarget(
      Object.fromEntries(
        nextContext.targets.map((target) => [
          target.documentResultId,
          getTargetPlacementScale(target, nextSignatureCaption),
        ]),
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
    setSignatureForm(nextSignatureForm)
    setSignaturePreviewUrl(
      nextContext.signatureProfile?.signatureImageUrl ?? '',
    )
    setIsEditingProfile(!nextContext.signatureProfile)
    setZoomPreset('fit-width')
    setZoomPercent(getZoomPercentForPreset('fit-width'))
    signingStartedAtRef.current = null
  }, [])

  useEffect(() => {
    let active = true

    const loadContext = async () => {
      setIsLoading(true)
      setLoadError(null)
      resignedTargetIdsRef.current = new Set()

      try {
        const nextContext = await fetchSigningContext(contextEndpoint)

        if (!active) {
          return
        }

        applySigningContext(nextContext)
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
  }, [applySigningContext, contextEndpoint])

  const activeTarget = useMemo(
    () =>
      context?.targets.find(
        (target) => target.documentResultId === selectedTargetId,
      ) ??
      context?.targets[0] ??
      null,
    [context, selectedTargetId],
  )
  const activePlacementScale = activeTarget
    ? (placementScaleByTarget[activeTarget.documentResultId] ??
      DEFAULT_SIGNATURE_PLACEMENT_SCALE)
    : DEFAULT_SIGNATURE_PLACEMENT_SCALE

  const activePlacement = activeTarget
    ? getAutoTextBlockRect(
        placements[activeTarget.documentResultId] ??
          getTargetPlacement(activeTarget),
        buildSignatureCaption(signatureForm),
        activePlacementScale,
      )
    : DEFAULT_SIGNATURE_RECT
  const activeSignatureCaptionLayout =
    getSignatureCaptionLayoutRects(activePlacement)
  const activeSignatureCaptionValues = buildSignatureCaptionParts(signatureForm)
  const activeSignatureCaptionParts = [
    {
      key: 'name',
      text: activeSignatureCaptionValues.displayName,
      rect: activeSignatureCaptionLayout.nameRect,
    },
    {
      key: 'first-separator',
      text: '/',
      rect: activeSignatureCaptionLayout.firstSeparatorRect,
    },
    {
      key: 'designation',
      text: activeSignatureCaptionValues.designation,
      rect: activeSignatureCaptionLayout.designationRect,
    },
    {
      key: 'second-separator',
      text: '/',
      rect: activeSignatureCaptionLayout.secondSeparatorRect,
    },
    {
      key: 'tin',
      text: activeSignatureCaptionValues.tin,
      rect: activeSignatureCaptionLayout.tinRect,
    },
  ]
  const activePreviewTextSize = previewPageMetrics
    ? getSignatureTextFontSize(activePlacement, previewPageMetrics.pdfHeight) *
      (previewPageMetrics.cssHeight / previewPageMetrics.pdfHeight)
    : 7 * activePlacementScale
  const activePreviewMode = activeTarget
    ? (previewModeByTarget[activeTarget.documentResultId] ??
      getTargetPreviewMode(activeTarget))
    : 'source'
  const activeSignatureImageRect = getDefaultSignatureImageRect(
    activePlacement,
    signatureForm.signatureImageWidth ??
      context?.signatureProfile?.signatureImageWidth ??
      1,
    signatureForm.signatureImageHeight ??
      context?.signatureProfile?.signatureImageHeight ??
      1,
    previewPageMetrics?.pdfWidth,
    previewPageMetrics?.pdfHeight,
  )
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
        const baseViewport = page.getViewport({ scale: 1 })
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

        const canvasBounds = canvas.getBoundingClientRect()
        setPreviewPageMetrics({
          cssHeight:
            canvasBounds.height || canvas.clientHeight || viewport.height,
          pdfWidth: baseViewport.width,
          pdfHeight: baseViewport.height,
        })
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
      Boolean(normalizeTinDigits(signatureForm.tin)) &&
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
    pendingTargetCount === 1 ? 'Sign certificate' : 'Sign pending'
  const signingProgressLabel = signingProgress
    ? `${signingProgress.resign ? 'Re-signing' : 'Signing'} ${signingProgress.currentChunkEnd} of ${signingProgress.total}...`
    : null
  const signingActionLabel =
    signingProgressLabel ??
    (pendingTargetCount === 1 ? 'Signing certificate...' : 'Signing pending...')
  const signingProgressPercent = signingProgress
    ? Math.round((signingProgress.completed / signingProgress.total) * 100)
    : 0
  const signConfirmationDescription =
    pendingTargetCount === 1
      ? workspaceLabel === 'batch'
        ? 'This will apply the saved text and signature placement to the unsigned certificate page in this batch and generate a signed PDF.'
        : 'This will apply the saved text and signature placement to this document and generate a signed PDF.'
      : `This will apply the saved text and signature placements to ${pendingTargetCount} unsigned certificate pages and generate signed PDFs.`
  const signedTargets =
    context?.targets.filter((target) => target.signingStatus === 'signed') ?? []
  const signedTargetCount = signedTargets.length
  const canDownloadAllSignedCertificates = Boolean(
    batchId &&
    canDownloadSignedPdf &&
    signedTargetCount > 0 &&
    onDownloadSignedCertificates,
  )
  const isAllSignedCertificateDownloadBusy =
    isDownloadingSignedCertificates || isDownloadingAllSignedCertificates
  const handleDownloadAllSignedCertificates = async () => {
    if (!onDownloadSignedCertificates || isAllSignedCertificateDownloadBusy) {
      return
    }

    setIsDownloadingAllSignedCertificates(true)

    try {
      await onDownloadSignedCertificates()
    } finally {
      setIsDownloadingAllSignedCertificates(false)
    }
  }
  const documentIsSigned =
    Boolean(context) &&
    context.targets.length > 0 &&
    signedTargetCount === context.targets.length
  const canDownloadActiveSignedPdf =
    Boolean(canDownloadSignedPdf) && Boolean(activeTarget?.signedPdfUrl)
  const showPrimarySignedDownload =
    documentIsSigned && canDownloadActiveSignedPdf && !isResigningBatch
  const showSecondarySignedDownload =
    !documentIsSigned && canDownloadActiveSignedPdf && !isResigningBatch
  const showSignedUnavailableStatus =
    documentIsSigned && !showPrimarySignedDownload && !isResigningBatch
  const canStartBatchResign =
    workspaceLabel === 'batch' && documentIsSigned && !isResigningBatch
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
  const certificateListVirtualizer = useVirtualizer({
    count: context?.targets.length ?? 0,
    getScrollElement: () => certificateListRef.current,
    estimateSize: () => 112,
    overscan: 8,
  })
  const currentPageIndicator = activeTargetIndex + 1
  const placementPositionLabel = toPlacementPositionLabel(activePlacement)
  const profileView = context?.signatureProfile ?? null

  useEffect(() => {
    if (!context || !selectedTargetId) {
      return
    }

    const selectedIndex = context.targets.findIndex(
      (target) => target.documentResultId === selectedTargetId,
    )

    if (selectedIndex >= 0) {
      certificateListVirtualizer.scrollToIndex(selectedIndex, {
        align: 'center',
      })
    }
  }, [certificateListVirtualizer, context, selectedTargetId])

  const jumpToTargetIndex = (targetIndex: number) => {
    if (!context) {
      return
    }

    const nextTargetIndex = clamp(targetIndex, 0, context.targets.length - 1)
    const nextTarget = context.targets[nextTargetIndex]

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

  const handleSignaturePlacementScaleChange = (
    value: number | Array<number>,
  ) => {
    if (!activeTarget || isActiveTargetPlacementLocked) {
      return
    }

    const nextPercent = Array.isArray(value) ? value[0] : value

    if (typeof nextPercent !== 'number') {
      return
    }

    const nextScale = snapSignaturePlacementScale(nextPercent / 100)

    setPlacementScaleByTarget((current) => ({
      ...current,
      [activeTarget.documentResultId]: nextScale,
    }))
    markSigningPlacementActivity()
    setSignError('')
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

    const x = clamp(
      (event.clientX - bounds.left) / bounds.width - activePlacement.width / 2,
      0,
      1 - activePlacement.width,
    )
    const y = clamp(
      (event.clientY - bounds.top) / bounds.height - activePlacement.height / 2,
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
      `Placement set for certificate page ${activeTarget.certificatePageNumber}.`,
    )
    markSigningPlacementActivity()
    setPlacementReadyByTarget((current) => ({
      ...current,
      [activeTarget.documentResultId]: true,
    }))
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
    const nextPlacementScales = Object.fromEntries(
      editableTargets.map((target) => [
        target.documentResultId,
        activePlacementScale,
      ]),
    )
    const nextPlacementReady = Object.fromEntries(
      editableTargets.map((target) => [target.documentResultId, true]),
    )
    const otherPageCount = editableTargets.filter(
      (target) => target.documentResultId !== activeTarget.documentResultId,
    ).length

    markSigningPlacementActivity()
    setPlacements((current) => ({
      ...current,
      ...nextPlacements,
    }))
    setPlacementScaleByTarget((current) => ({
      ...current,
      ...nextPlacementScales,
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

  const resetSignatureProfileDraft = (profile: SignatureProfileView | null) => {
    setSignatureForm(defaultSignatureFormState(profile))
    setSignaturePreviewUrl(profile?.signatureImageUrl ?? '')
    setProfileError('')
  }

  const openSignatureProfileEditor = () => {
    if (profileView) {
      resetSignatureProfileDraft(profileView)
    } else {
      setProfileError('')
    }
    setIsEditingProfile(true)
  }

  const closeSignatureProfileEditor = () => {
    resetSignatureProfileDraft(profileView)
    setIsEditingProfile(false)
  }

  const handleSignatureProfileEditorOpenChange = (open: boolean) => {
    if (open) {
      openSignatureProfileEditor()
      return
    }

    closeSignatureProfileEditor()
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

  const showSigningCompleteFlag = ({
    resign,
    signedCount,
  }: {
    resign: boolean
    signedCount: number
  }) => {
    const flagModel = buildSigningCompleteFlagModel({ resign, signedCount })

    toast.custom(
      (toastId) => (
        <SigningCompleteFlag
          model={flagModel}
          toastId={toastId}
          workspaceName={context?.fileName}
          onOpenMerge={() => {
            void navigate({ to: '/merge-pdfs' })
          }}
        />
      ),
      {
        duration: flagModel.duration,
        position: flagModel.position,
      },
    )
  }

  const applySignedArtifacts = (
    signedArtifacts: Array<SignedArtifactResult>,
  ) => {
    if (signedArtifacts.length === 0) {
      return
    }

    const signatureCaption = buildSignatureCaption(signatureForm)
    const signedArtifactById = new Map(
      signedArtifacts.map((artifact) => [artifact.documentResultId, artifact]),
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
                  signedArtifact.templatePlacement ?? target.templatePlacement,
              }
            }),
          }
        : current,
    )
    setPlacements((current) => ({
      ...current,
      ...Object.fromEntries(
        signedArtifacts.flatMap((artifact) =>
          artifact.templatePlacement
            ? [
                [
                  artifact.documentResultId,
                  artifact.templatePlacement.signatureRect,
                ],
              ]
            : [],
        ),
      ),
    }))
    setPlacementScaleByTarget((current) => ({
      ...current,
      ...Object.fromEntries(
        signedArtifacts.flatMap((artifact) =>
          artifact.templatePlacement
            ? [
                [
                  artifact.documentResultId,
                  getSignaturePlacementScaleFromRect(
                    artifact.templatePlacement.signatureRect,
                    signatureCaption,
                  ),
                ],
              ]
            : [],
        ),
      ),
    }))
    setPlacementReadyByTarget((current) => ({
      ...current,
      ...Object.fromEntries(
        signedArtifacts.map((artifact) => [artifact.documentResultId, true]),
      ),
    }))
    setPreviewModeByTarget((current) => ({
      ...current,
      ...Object.fromEntries(
        signedArtifacts.map((artifact) => [
          artifact.documentResultId,
          artifact.signedPdfUrl
            ? 'signed'
            : (current[artifact.documentResultId] ?? 'source'),
        ]),
      ),
    }))
  }

  const handleSign = async ({ resign = false }: { resign?: boolean } = {}) => {
    if (!context) {
      return
    }
    const targetsToSign = resign
      ? context.targets.filter(
          (target) =>
            !resignedTargetIdsRef.current.has(target.documentResultId),
        )
      : pendingTargets

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
          : 'Place the text and signature block on each unsigned page first.',
      )
      return
    }

    setIsSigning(true)
    setSignError('')
    setNotice('')
    setSigningProgress({
      total: targetsToSign.length,
      completed: 0,
      currentChunkStart: 1,
      currentChunkEnd: Math.min(SIGNING_CHUNK_SIZE, targetsToSign.length),
      resign,
    })

    const signingStartedAt =
      signingStartedAtRef.current?.toISOString() ?? undefined
    const signingTargets = targetsToSign.map((target) => ({
      documentResultId: target.documentResultId,
      pageNumber: target.previewPageNumber,
      signatureRect: getAutoTextBlockRect(
        placements[target.documentResultId] ?? getTargetPlacement(target),
        buildSignatureCaption(signatureForm),
        placementScaleByTarget[target.documentResultId] ??
          DEFAULT_SIGNATURE_PLACEMENT_SCALE,
      ),
    }))
    const targetChunks = chunkItems(signingTargets, SIGNING_CHUNK_SIZE)
    const signedArtifacts: Array<SignedArtifactResult> = []
    let completedCount = 0

    try {
      for (const [chunkIndex, targetChunk] of targetChunks.entries()) {
        const currentChunkStart = chunkIndex * SIGNING_CHUNK_SIZE + 1
        const currentChunkEnd = Math.min(
          currentChunkStart + targetChunk.length - 1,
          signingTargets.length,
        )
        setSigningProgress({
          total: signingTargets.length,
          completed: completedCount,
          currentChunkStart,
          currentChunkEnd,
          resign,
        })

        const response = await fetch(signEndpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            resign,
            signingStartedAt,
            targets: targetChunk,
          }),
        })
        const payload = await readJson<SignResponse>(response)

        if (!response.ok || !payload?.signedArtifacts?.length) {
          throw new Error(
            payload?.error ||
              `Unable to sign ${workspaceLabel} (${response.status}).`,
          )
        }

        signedArtifacts.push(...payload.signedArtifacts)
        applySignedArtifacts(payload.signedArtifacts)

        if (resign) {
          for (const artifact of payload.signedArtifacts) {
            resignedTargetIdsRef.current.add(artifact.documentResultId)
          }
        }

        completedCount += payload.signedArtifacts.length
        setSigningProgress({
          total: signingTargets.length,
          completed: completedCount,
          currentChunkStart,
          currentChunkEnd,
          resign,
        })
      }

      setNotice(
        signedArtifacts.length === 1
          ? resign
            ? 'Re-signed 1 certificate.'
            : 'Signed 1 certificate.'
          : resign
            ? `Re-signed ${signedArtifacts.length} certificates.`
            : `Signed ${signedArtifacts.length} certificates.`,
      )
      showSigningCompleteFlag({
        resign,
        signedCount: signedArtifacts.length,
      })
      if (resign) {
        setIsResigningBatch(false)
        setIsResignDialogOpen(false)
        resignedTargetIdsRef.current = new Set()
      }
      resetSigningPlacementActivity()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to sign the document.'
      if (completedCount > 0) {
        const signedLabel = resign ? 'Re-signed' : 'Signed'
        const retryLabel = resign
          ? 'remaining certificates'
          : 'remaining unsigned certificates'
        setSignError(
          `${signedLabel} ${completedCount} of ${signingTargets.length} certificates before the error. Retry to continue with the ${retryLabel}. Last error: ${message}`,
        )
        await fetchSigningContext(contextEndpoint)
          .then(applySigningContext)
          .catch(() => undefined)
      } else {
        setSignError(message)
      }
    } finally {
      setSigningProgress(null)
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

  const profileEditorTitle = profileView
    ? 'Edit signature profile'
    : 'Create signature profile'
  const startBatchResign = () => {
    resignedTargetIdsRef.current = new Set()
    setIsResigningBatch(true)
    setSignError('')
    setNotice(
      'Move the text and signature placement on the source PDF, then apply the re-sign.',
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
  }
  const cancelBatchResign = () => {
    resignedTargetIdsRef.current = new Set()
    setIsResigningBatch(false)
    setIsResignDialogOpen(false)
    setNotice('')
    setSignError('')
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <div className="flex flex-col gap-6 p-4 sm:p-5 lg:p-6">
        <section
          className="flex flex-col gap-5 border-b border-border/50 pb-6"
          {...getOptionalTourTargetProps(tourTargets?.summary)}
        >
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

            <div
              className="flex w-full flex-row flex-nowrap items-center gap-2 overflow-x-auto pb-1 xl:w-auto xl:justify-end xl:overflow-visible xl:pb-0"
              aria-label="Signing toolbar"
              {...getOptionalTourTargetProps(tourTargets?.toolbar)}
            >
              {isResigningBatch ? (
                <AlertDialog
                  open={isResignDialogOpen}
                  onOpenChange={setIsResignDialogOpen}
                >
                  <AlertDialogTrigger
                    render={
                      <Button
                        size="lg"
                        className="shrink-0"
                        disabled={!canApplyResignBatch || isSigning}
                      />
                    }
                  >
                    <IconSignature data-icon="inline-start" />
                    {isSigning
                      ? (signingProgressLabel ?? 'Re-signing batch...')
                      : 'Apply re-sign'}
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
              ) : showPrimarySignedDownload ? (
                <a
                  href={`/api/documents/${encodeURIComponent(
                    activeTarget.documentResultId,
                  )}/signed-pdf`}
                  className={buttonVariants({
                    size: 'lg',
                    variant: 'default',
                    className: 'shrink-0',
                  })}
                >
                  <IconDownload data-icon="inline-start" />
                  Download signed
                </a>
              ) : showSignedUnavailableStatus ? (
                <Button size="lg" className="shrink-0" disabled>
                  <IconCheck data-icon="inline-start" />
                  Signed
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
                        className="shrink-0"
                        disabled={!canSubmitSignature || isSigning}
                      />
                    }
                  >
                    <IconSignature data-icon="inline-start" />
                    {isSigning ? signingActionLabel : signActionLabel}
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
              {showSecondarySignedDownload ? (
                <a
                  href={`/api/documents/${encodeURIComponent(
                    activeTarget.documentResultId,
                  )}/signed-pdf`}
                  className={buttonVariants({
                    size: 'lg',
                    variant: 'outline',
                    className: 'shrink-0',
                  })}
                >
                  <IconDownload data-icon="inline-start" />
                  Download signed
                </a>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="outline"
                      className="shrink-0"
                      aria-label="Open signing actions"
                    />
                  }
                >
                  <IconDotsVertical />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={openSignatureProfileEditor}>
                      <IconPencil />
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
                      <IconFileDescription />
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
                        <IconCircleCheckFilled />
                        View signed PDF
                      </DropdownMenuItem>
                    ) : null}
                    {canDownloadAllSignedCertificates ? (
                      <DropdownMenuItem
                        disabled={isAllSignedCertificateDownloadBusy}
                        onClick={handleDownloadAllSignedCertificates}
                      >
                        {isAllSignedCertificateDownloadBusy ? (
                          <IconLoader2 className="animate-spin" />
                        ) : (
                          <IconDownload />
                        )}
                        {isAllSignedCertificateDownloadBusy
                          ? 'Downloading...'
                          : 'Download all signed'}
                      </DropdownMenuItem>
                    ) : null}
                    {canStartBatchResign ? (
                      <DropdownMenuItem onClick={startBatchResign}>
                        <IconSignature />
                        Re-sign batch
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
                  className="shrink-0"
                  disabled={isSigning}
                  onClick={cancelBatchResign}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
          {signingProgress ? (
            <div className="grid gap-2 rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {signingProgress.resign ? 'Re-signing' : 'Signing'}{' '}
                  certificates
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {signingProgress.completed} of {signingProgress.total}{' '}
                  complete
                </span>
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label="Signing progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={signingProgressPercent}
              >
                <div
                  className="h-1.5 rounded-full bg-primary/70 transition-[width] duration-500 ease-out"
                  style={{
                    width: `${Math.max(signingProgressPercent, 4)}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Processing {signingProgress.currentChunkStart}-
                {signingProgress.currentChunkEnd} of {signingProgress.total}.
              </p>
            </div>
          ) : null}
        </section>

        <div className="grid gap-5 xl:grid-cols-[17rem_minmax(0,1fr)_18.5rem]">
          <Card
            className="flex max-h-[42rem] flex-col overflow-hidden rounded-lg border-border/60 shadow-none xl:max-h-[calc(100vh-9rem)]"
            {...getOptionalTourTargetProps(tourTargets?.certificateList)}
          >
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
            <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
              <div
                ref={certificateListRef}
                className="min-h-0 flex-1 overflow-y-auto pr-1"
              >
                <div
                  className="relative w-full"
                  style={{
                    height: `${certificateListVirtualizer.getTotalSize()}px`,
                  }}
                >
                  {certificateListVirtualizer
                    .getVirtualItems()
                    .map((virtualRow) => {
                      const target = context.targets[virtualRow.index]

                      const isSelected =
                        target.documentResultId ===
                        activeTarget.documentResultId
                      const placementReady =
                        placementReadyByTarget[target.documentResultId] ?? false
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
                        <div
                          key={virtualRow.key}
                          ref={certificateListVirtualizer.measureElement}
                          data-index={virtualRow.index}
                          className="absolute left-0 top-0 w-full py-1"
                          style={{
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          <button
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
                              'flex w-full min-w-0 items-start gap-2.5 rounded-lg border p-3 text-left transition-colors',
                              isSelected
                                ? 'border-primary/60 bg-primary/5'
                                : 'border-border/60 bg-background hover:bg-muted/20',
                            )}
                          >
                            <div
                              className={cn(
                                'flex size-9 shrink-0 items-center justify-center rounded-md border',
                                target.signingStatus === 'signed'
                                  ? 'border-primary/25 bg-primary/10 text-primary'
                                  : placementReady
                                    ? 'border-border/60 bg-muted/40 text-foreground'
                                    : 'border-border/60 bg-background text-muted-foreground',
                              )}
                            >
                              {target.signingStatus === 'signed' ? (
                                <IconCircleCheckFilled />
                              ) : placementReady ? (
                                <IconCheck />
                              ) : (
                                <IconPencil />
                              )}
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                              <div
                                className="min-w-0 whitespace-normal break-normal text-sm leading-5 font-medium"
                                title={identityLabel}
                              >
                                {identityLabel}
                              </div>
                              {secondaryLabel ? (
                                <p
                                  className="min-w-0 break-all text-xs leading-4 text-muted-foreground"
                                  title={secondaryLabel}
                                >
                                  {secondaryLabel}
                                </p>
                              ) : null}
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <Badge
                                  variant="outline"
                                  className="max-w-full truncate px-1.5"
                                >
                                  {targetStateLabel}
                                </Badge>
                              </div>
                            </div>
                          </button>
                        </div>
                      )
                    })}
                </div>
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

          <Card className="overflow-hidden rounded-lg border-border/60 shadow-none">
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
                <TabsList
                  variant="line"
                  className="gap-5 px-1"
                  {...getOptionalTourTargetProps(tourTargets?.previewTabs)}
                >
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

              <div
                className="flex flex-wrap items-center gap-2"
                {...getOptionalTourTargetProps(tourTargets?.previewControls)}
              >
                <Button size="icon-sm" variant="outline" disabled>
                  <IconFileDescription />
                  <span className="sr-only">PDF tools</span>
                </Button>
                <div className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5">
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
                <div className="flex items-center rounded-md border border-border/60">
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
                {...getOptionalTourTargetProps(tourTargets?.preview)}
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
                    <div className="overflow-hidden rounded-lg border border-border/60 bg-background">
                      <canvas ref={canvasRef} className="block h-auto w-full" />
                    </div>
                    {activePreviewMode === 'source' ? (
                      <div
                        className="pointer-events-none absolute rounded-lg border border-primary/60 bg-primary/5 shadow-sm"
                        style={{
                          left: `${activePlacement.x * 100}%`,
                          top: `${activePlacement.y * 100}%`,
                          width: `${activePlacement.width * 100}%`,
                          height: `${activePlacement.height * 100}%`,
                        }}
                      >
                        {activeSignatureCaptionParts.map((part) => (
                          <div
                            key={part.key}
                            data-signature-caption-part={part.key}
                            className="absolute flex items-center justify-center overflow-hidden whitespace-pre px-1 text-center text-primary"
                            style={{
                              ...toRelativePercentRect(
                                activePlacement,
                                part.rect,
                              ),
                              fontSize: `${activePreviewTextSize}px`,
                              lineHeight: 1,
                            }}
                          >
                            {part.text}
                          </div>
                        ))}
                        {signaturePreviewUrl ? (
                          <div
                            className="absolute"
                            style={toRelativePercentRect(
                              activePlacement,
                              activeSignatureImageRect,
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
                    ) : null}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4">
            <Card
              className="rounded-lg border-border/60 shadow-none"
              {...getOptionalTourTargetProps(tourTargets?.status)}
            >
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
                        ? `Move the text and signature placement across ${context.certificateCount} certificates, then apply the re-sign.`
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
                      : 'Place the text and signature block on each unsigned page first.'}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card
              className="rounded-lg border-border/60 shadow-none"
              {...getOptionalTourTargetProps(tourTargets?.placement)}
            >
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
                    <span className="text-muted-foreground">Position</span>
                    <span>{placementPositionLabel}</span>
                  </div>
                  <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
                    <span className="text-muted-foreground">Block size</span>
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
                <FieldGroup>
                  <Field
                    data-disabled={
                      isActiveTargetPlacementLocked ? true : undefined
                    }
                  >
                    <FieldLabel htmlFor="text-signature-scale">
                      Text and e-signature size
                    </FieldLabel>
                    <FieldContent>
                      <div className="flex items-center gap-3">
                        <Slider
                          id="text-signature-scale"
                          value={[toPercentValue(activePlacementScale)]}
                          min={toPercentValue(MIN_SIGNATURE_PLACEMENT_SCALE)}
                          max={toPercentValue(MAX_SIGNATURE_PLACEMENT_SCALE)}
                          step={toPercentValue(SIGNATURE_PLACEMENT_SCALE_STEP)}
                          onValueChange={handleSignaturePlacementScaleChange}
                          disabled={isActiveTargetPlacementLocked}
                          aria-label="Text and e-signature size"
                          className="flex-1"
                        />
                        <span className="w-12 text-right text-sm tabular-nums text-muted-foreground">
                          {toPercentValue(activePlacementScale)}%
                        </span>
                      </div>
                      <FieldDescription>
                        Resizes the placed text and e-signature together.
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                </FieldGroup>
                {!isActiveTargetPlacementLocked ? (
                  <FieldGroup>
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
                          Copies the current text and signature placement to the
                          rest of the {isResigningBatch ? 'batch' : 'unsigned'}{' '}
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
                      : 'Click the preview to place the Name / Designation / TIN and signature together.')}
                </p>
              </CardContent>
            </Card>

            <Card
              className="rounded-lg border-border/60 shadow-none"
              {...getOptionalTourTargetProps(tourTargets?.profile)}
            >
              <CardHeader className="gap-2">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Signature profile</CardTitle>
                  {profileView ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={openSignatureProfileEditor}
                    >
                      Edit
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent>
                {profileView ? (
                  <div className="flex flex-col gap-5">
                    <div className="grid gap-4 text-sm">
                      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
                        <span className="text-muted-foreground">Name</span>
                        <span>{profileView.displayName}</span>
                      </div>
                      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
                        <span className="text-muted-foreground">
                          Designation
                        </span>
                        <span>{profileView.designation}</span>
                      </div>
                      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
                        <span className="text-muted-foreground">TIN</span>
                        <span>
                          {formatTinForDisplay(profileView.tin) || '—'}
                        </span>
                      </div>
                    </div>
                    <div>
                      <p className="mb-3 text-sm text-muted-foreground">
                        Signature
                      </p>
                      <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                        <img
                          src={profileView.signatureImageUrl}
                          alt="Saved signature preview"
                          className="max-h-28 max-w-full object-contain"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 text-sm text-muted-foreground">
                    <p>No signature profile saved.</p>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-fit"
                      onClick={openSignatureProfileEditor}
                    >
                      <IconSignature data-icon="inline-start" />
                      Set up profile
                    </Button>
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

      {tourTargets ? <SigningTour startSignal={tourStartSignal} /> : null}

      <Sheet
        open={isEditingProfile}
        onOpenChange={handleSignatureProfileEditorOpenChange}
      >
        <SheetContent side="right" className="w-full sm:max-w-lg">
          <SheetHeader className="border-b border-border/60 p-4">
            <SheetTitle>{profileEditorTitle}</SheetTitle>
            <SheetDescription>
              Manage the signer details and e-signature used for generated PDFs.
            </SheetDescription>
          </SheetHeader>

          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSaveProfile()
            }}
          >
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
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
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                    <img
                      src={signaturePreviewUrl}
                      alt="Saved signature preview"
                      className="max-h-28 max-w-full object-contain"
                    />
                  </div>
                ) : null}
                <FieldError>{profileError}</FieldError>
              </FieldGroup>
            </div>

            <SheetFooter className="shrink-0 border-t border-border/60 bg-background p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button type="submit" disabled={isSavingProfile}>
                  <IconDeviceFloppy data-icon="inline-start" />
                  {isSavingProfile ? 'Saving…' : 'Save profile'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeSignatureProfileEditor}
                >
                  Cancel
                </Button>
              </div>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  )
}
