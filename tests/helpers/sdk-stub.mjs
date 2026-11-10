// Minimal stand-in for `@hermes/plugin-sdk`: only what the plugin touches.

function createAtom(initial) {
  let value = initial
  const listeners = new Set()

  return {
    get: () => value,
    listen(listener) {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    set(next) {
      value = next

      for (const listener of [...listeners]) {
        listener(value)
      }
    }
  }
}

export function useValue(store) {
  return store.get()
}

const SLOT = {
  areas: Object.freeze({ badges: 'kanban.card.badges' }),
  atom: createAtom,
  hues: Object.freeze(['red', 'orange', 'yellow', 'lime', 'green', 'mint', 'cyan', 'sky', 'blue', 'violet', 'magenta', 'pink'])
}

// `let` exports are live bindings: the plugin reads them from the SDK
// namespace at register() time, so `setBadgeSlot(false)` models an older host.
export let KANBAN_CARD_AREAS = SLOT.areas
export let KANBAN_CARD_BADGE_HUES = SLOT.hues
export let atom = SLOT.atom

/** Test switch: `false` models an older host; overrides isolate SDK guards. */
export function setBadgeSlot(available, overrides = {}) {
  const slot = { ...SLOT, ...overrides }

  KANBAN_CARD_AREAS = available ? slot.areas : undefined
  KANBAN_CARD_BADGE_HUES = available ? slot.hues : undefined
  atom = slot.atom
}

const component = name => {
  const render = props => ({ props, type: name })

  Object.defineProperty(render, 'name', { value: name })

  return render
}

export const ColorSwatches = component('ColorSwatches')
export const ListRow = component('ListRow')
export const Popover = component('Popover')
export const PopoverContent = component('PopoverContent')
export const PopoverTrigger = component('PopoverTrigger')
