// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { isNavigationFailure, NavigationFailureType } from 'vue-router'
import { router } from './index'

describe('page title after navigation', () => {
  let removeGuard: (() => void) | null = null

  afterEach(() => {
    removeGuard?.()
    removeGuard = null
  })

  it('keeps the current title when an unsaved-answer guard cancels navigation', async () => {
    await router.push('/about')
    expect(document.title).toBe('关于与方法说明 · TypeMe')
    removeGuard = router.beforeEach((to) => (to.path === '/quiz' ? false : true))

    const result = await router.push('/quiz')
    expect(isNavigationFailure(result, NavigationFailureType.aborted)).toBe(true)
    expect(router.currentRoute.value.path).toBe('/about')
    expect(document.title).toBe('关于与方法说明 · TypeMe')
  })
})
