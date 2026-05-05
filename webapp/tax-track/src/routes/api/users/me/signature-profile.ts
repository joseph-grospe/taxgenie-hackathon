import { Buffer } from 'node:buffer'

import { createFileRoute } from '@tanstack/react-router'

import { logAuditEvent } from '@/lib/audit'
import {
  getSignatureProfile,
  getSignatureProfileImage,
  upsertSignatureProfile,
} from '@/lib/signing-server'
import { signatureProfileUpsertSchema } from '@/lib/signing-module'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBodyWithDetails,
  resolveContextFromRequest,
} from '@/lib/user-admin-server'

const getHandler = async ({ request }: { request: Request }) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to load a signature profile.',
    )
  }

  const url = new URL(request.url)
  if (url.searchParams.get('image') === '1') {
    try {
      const image = await getSignatureProfileImage(context.userId)
      if (!image) {
        return new Response('Signature profile image not found.', {
          status: 404,
          headers: {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
          },
        })
      }

      return new Response(Buffer.from(image.bytes), {
        headers: {
          'content-type': image.contentType,
          'content-disposition': `inline; filename="${image.fileName.replaceAll('"', '_')}"`,
          'cache-control':
            'private, max-age=0, no-cache, no-store, must-revalidate',
        },
      })
    } catch (error) {
      return new Response(getErrorMessage(error), {
        status: 500,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        },
      })
    }
  }

  const profile = await getSignatureProfile(context.userId)
  return jsonResponse({ profile })
}

const putHandler = async ({ request }: { request: Request }) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to save a signature profile.',
    )
  }

  const parsed = await parseJsonBodyWithDetails(
    request,
    signatureProfileUpsertSchema,
  )
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    const profile = await upsertSignatureProfile(context.userId, parsed.data)

    await logAuditEvent(request, {
      eventType: 'signature_profile_updated',
      actorUserId: context.userId,
      targetId: context.userId,
      targetType: 'user',
      metadata: {
        designation: profile.designation,
        tin: profile.tin,
      },
    }).catch(() => undefined)

    return jsonResponse({ profile })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/users/me/signature-profile')({
  server: {
    handlers: {
      GET: getHandler,
      PUT: putHandler,
    },
  },
})
