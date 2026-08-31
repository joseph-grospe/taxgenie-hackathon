import { createHash } from 'node:crypto'

import type { QueueMessage } from '@taxgenie/shared'
import { describe, expect, it, vi } from 'vitest'

import {
  buildCloudTaskId,
  GoogleCloudTaskDispatcher,
} from '@/lib/task-dispatcher-server'

const message: QueueMessage = {
  event: {
    version: 'v1',
    eventId: 'event-123',
    traceId: 'trace-123',
    source: 'manual-upload',
    batchId: '11111111-1111-4111-8111-111111111111',
    uploadId: '22222222-2222-4222-8222-222222222222',
    sourceFileId: 'source-123',
    revision: '1720000000000000',
    originalFileName: 'sample.pdf',
    modifiedTime: '2026-08-28T00:00:00.000Z',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    artifactUri: 'gs://documents/v2/source/sample.pdf',
    uploadedByUserId: 'user-1',
    uploadedAt: '2026-08-28T00:00:00.000Z',
    receivedAt: '2026-08-28T00:00:00.000Z',
  },
}

const config = {
  projectId: 'taxgenie-prod',
  location: 'asia-southeast1',
  queueId: 'document-extraction',
  workerUrl: 'https://worker.run.app',
  invokerServiceAccount: 'tasks@taxgenie-prod.iam.gserviceaccount.com',
}

const taskName =
  'projects/taxgenie-prod/locations/asia-southeast1/queues/document-extraction/tasks/task-id'

const createClient = () => ({
  queuePath: vi.fn(() => 'queue-path'),
  taskPath: vi.fn(() => taskName),
  createTask: vi.fn().mockResolvedValue([{ name: taskName }]),
})

describe('GoogleCloudTaskDispatcher', () => {
  it('uses a deterministic SHA-256 task name', () => {
    expect(buildCloudTaskId(message.event.eventId)).toBe(
      createHash('sha256').update(message.event.eventId).digest('hex'),
    )
  })

  it('sends the event wrapper with deadline and exact OIDC audience', async () => {
    const client = createClient()
    const dispatcher = new GoogleCloudTaskDispatcher(config, client)

    await expect(dispatcher.dispatch(message)).resolves.toEqual({
      dispatchId: taskName,
      duplicate: false,
    })
    expect(client.createTask).toHaveBeenCalledOnce()
    expect(client.createTask.mock.calls[0]?.[0]).toEqual({
      parent: 'queue-path',
      task: {
        name: taskName,
        dispatchDeadline: { seconds: 1_800 },
        httpRequest: {
          httpMethod: 'POST',
          url: 'https://worker.run.app/tasks/document-extraction',
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.from(JSON.stringify(message)).toString('base64'),
          oidcToken: {
            serviceAccountEmail:
              'tasks@taxgenie-prod.iam.gserviceaccount.com',
            audience: 'https://worker.run.app',
          },
        },
      },
    })
  })

  it('treats Cloud Tasks ALREADY_EXISTS as idempotent success', async () => {
    const client = createClient()
    client.createTask.mockRejectedValueOnce(Object.assign(new Error('exists'), { code: 6 }))
    const dispatcher = new GoogleCloudTaskDispatcher(config, client)

    await expect(dispatcher.dispatch(message)).resolves.toEqual({
      dispatchId: taskName,
      duplicate: true,
    })
  })
})
