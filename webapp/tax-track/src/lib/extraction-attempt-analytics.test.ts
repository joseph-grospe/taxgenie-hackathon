import { describe, expect, it } from 'vitest'

import { summarizeExtractionAttempts } from '@/lib/extraction-attempt-analytics'

describe('document extraction attempt analytics', () => {
  it('counts every cost-bearing execution while business reporting keeps one result', () => {
    const summary = summarizeExtractionAttempts([
      {
        status: 'failed',
        trigger: 'initial',
        providerAttemptCount: 3,
        latencyMs: 10_000,
        promptTokenCount: 1_000,
        outputTokenCount: 0,
        thoughtTokenCount: 0,
        totalTokenCount: 1_000,
      },
      {
        status: 'failed',
        trigger: 'manual_retry',
        providerAttemptCount: 3,
        latencyMs: 20_000,
        promptTokenCount: 1_100,
        outputTokenCount: 0,
        thoughtTokenCount: 0,
        totalTokenCount: 1_100,
      },
      {
        status: 'succeeded',
        trigger: 'manual_retry',
        providerAttemptCount: 1,
        latencyMs: 15_000,
        promptTokenCount: 1_200,
        outputTokenCount: 600,
        thoughtTokenCount: 2_200,
        totalTokenCount: 4_000,
      },
    ])

    expect(summary).toEqual({
      executionCount: 3,
      initialExecutionCount: 1,
      manualRetryExecutionCount: 2,
      succeededCount: 1,
      failedCount: 2,
      processingCount: 0,
      providerHttpAttemptCount: 7,
      totalLatencyMs: 45_000,
      averageLatencyMs: 15_000,
      promptTokenCount: 3_300,
      outputTokenCount: 600,
      thoughtTokenCount: 2_200,
      totalTokenCount: 6_100,
    })
  })
})
