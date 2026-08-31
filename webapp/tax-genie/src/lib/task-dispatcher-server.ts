import { createHash } from 'node:crypto'

import { CloudTasksClient } from '@google-cloud/tasks'
import type {
  QueueMessage,
  TaskDispatcher,
  TaskDispatchResult,
} from '@taxgenie/shared'

type CloudTasksClientLike = Pick<
  CloudTasksClient,
  'createTask' | 'queuePath' | 'taskPath'
>

type CloudTasksDispatcherConfig = {
  projectId: string
  location: string
  queueId: string
  workerUrl: string
  invokerServiceAccount: string
}

const requiredEnv = (name: string) => {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is not configured.`)
  }
  return value
}

export const resolveCloudTasksConfig = (): CloudTasksDispatcherConfig => ({
  projectId: requiredEnv('GCP_PROJECT_ID'),
  location: process.env.GCP_REGION?.trim() || 'asia-southeast1',
  queueId: process.env.CLOUD_TASKS_QUEUE_ID?.trim() || 'document-extraction',
  workerUrl: requiredEnv('WORKER_SERVICE_URL').replace(/\/$/u, ''),
  invokerServiceAccount: requiredEnv('TASK_INVOKER_SERVICE_ACCOUNT'),
})

export const buildCloudTaskId = (eventId: string) =>
  createHash('sha256').update(eventId).digest('hex')

const isAlreadyExists = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  Number((error as { code: unknown }).code) === 6

export class GoogleCloudTaskDispatcher implements TaskDispatcher {
  constructor(
    private readonly config: CloudTasksDispatcherConfig,
    private readonly client: CloudTasksClientLike = new CloudTasksClient(),
  ) {}

  async dispatch(message: QueueMessage): Promise<TaskDispatchResult> {
    const parent = this.client.queuePath(
      this.config.projectId,
      this.config.location,
      this.config.queueId,
    )
    const taskId = buildCloudTaskId(message.event.eventId)
    const taskName = this.client.taskPath(
      this.config.projectId,
      this.config.location,
      this.config.queueId,
      taskId,
    )

    try {
      const [task] = await this.client.createTask({
        parent,
        task: {
          name: taskName,
          dispatchDeadline: { seconds: 1_800 },
          httpRequest: {
            httpMethod: 'POST',
            url: `${this.config.workerUrl}/tasks/document-extraction`,
            headers: { 'Content-Type': 'application/json' },
            body: Buffer.from(JSON.stringify(message)).toString('base64'),
            oidcToken: {
              serviceAccountEmail: this.config.invokerServiceAccount,
              audience: this.config.workerUrl,
            },
          },
        },
      })
      return { dispatchId: task.name || taskName, duplicate: false }
    } catch (error) {
      if (isAlreadyExists(error)) {
        return { dispatchId: taskName, duplicate: true }
      }
      throw error
    }
  }
}

let dispatcher: TaskDispatcher | undefined

export const getTaskDispatcher = (): TaskDispatcher => {
  if (!dispatcher) {
    dispatcher = new GoogleCloudTaskDispatcher(resolveCloudTasksConfig())
  }
  return dispatcher
}
