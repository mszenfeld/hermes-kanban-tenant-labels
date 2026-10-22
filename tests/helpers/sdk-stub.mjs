// Minimal stand-in for `@hermes/plugin-sdk`: only what the plugin touches.
// `queryClient` is a controllable fake of the app's shared React Query client.

export function atom(initial) {
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

/** Fake of the TanStack QueryClient surface the plugin reads: a query cache
 *  with `getAll()` and `subscribe()`. */
export function createFakeQueryClient() {
  const queries = new Map()
  const listeners = new Set()
  let clock = 0

  const cache = {
    getAll: () => [...queries.values()],
    subscribe(listener) {
      listeners.add(listener)

      return () => listeners.delete(listener)
    }
  }

  const emit = (type, query) => {
    for (const listener of [...listeners]) {
      listener({ action: { type: 'success' }, query, type })
    }
  }

  return {
    /** Like TanStack: remove the queries first, then notify. */
    clear() {
      const removed = [...queries.values()]

      queries.clear()

      for (const query of removed) {
        emit('removed', query)
      }
    },
    getQueryCache: () => cache,
    listenerCount: () => listeners.size,
    /** `observers` mimics TanStack's `query.getObserversCount()`; omit it to
     *  model a cache that cannot tell which queries are mounted. */
    setQueryData(queryKey, data, { observers } = {}) {
      clock += 1

      const query = { queryKey, state: { data, dataUpdatedAt: clock } }

      if (observers !== undefined) {
        query.getObserversCount = () => observers
      }

      queries.set(JSON.stringify(queryKey), query)
      emit('updated', query)
    }
  }
}

export const queryClient = createFakeQueryClient()

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
