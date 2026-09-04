import { vi } from 'vitest'

// jsdom implements no matchMedia, and `test-setup.ts`'s stub answers `false` to
// everything — which is the right default, since almost every test wants the
// animated path. This is the opposite switch, inlined in three board tests
// before it was worth a module.
export function mockReducedMotion(reduce: boolean) {
  return vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  )
}
