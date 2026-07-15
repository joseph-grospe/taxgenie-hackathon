/* @vitest-environment jsdom */

import { act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { preserveScrollDuringNavigation } from './use-preserved-route-search'

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('preserveScrollDuringNavigation', () => {
  it('restores window and ancestor scroll after navigation changes layout', () => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'scrollX', {
      configurable: true,
      value: 12,
    })
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 240,
    })
    const scrollTo = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined)

    const scroller = document.createElement('div')
    const input = document.createElement('input')
    input.scrollIntoView = vi.fn()
    scroller.append(input)
    document.body.append(scroller)

    Object.defineProperty(scroller, 'scrollHeight', {
      configurable: true,
      value: 400,
    })
    Object.defineProperty(scroller, 'clientHeight', {
      configurable: true,
      value: 100,
    })
    scroller.scrollTop = 64
    scroller.scrollLeft = 8
    input.focus()

    preserveScrollDuringNavigation(() => {
      scroller.scrollTop = 0
      scroller.scrollLeft = 0
    })

    expect(scroller.scrollTop).toBe(64)
    expect(scroller.scrollLeft).toBe(8)
    expect(scrollTo).toHaveBeenCalledWith({ left: 12, top: 240 })

    scroller.scrollTop = 0
    act(() => {
      vi.advanceTimersByTime(50)
    })
    expect(scroller.scrollTop).toBe(64)
  })
})
