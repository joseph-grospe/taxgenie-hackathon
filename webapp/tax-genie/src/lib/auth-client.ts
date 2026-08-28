import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  basePath: '/api/auth',
  fetchOptions: {
    credentials: 'include',
  },
})

type GetSessionInput = Parameters<typeof authClient.getSession>[0]

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export const getSessionWithRetry = async (
  input?: GetSessionInput,
  options: {
    attempts?: number
    delayMs?: number
  } = {},
) => {
  const attempts = options.attempts ?? 3
  const delayMs = options.delayMs ?? 250

  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await authClient.getSession(input)
    } catch (error) {
      lastError = error
      if (attempt === attempts) {
        throw error
      }
      await wait(delayMs * attempt)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unable to load session.')
}
