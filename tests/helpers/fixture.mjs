// DOM fixtures that mirror the markup of the bundled Kanban board (Desktop
// `plugins/kanban/board.tsx`: KanbanBoardPage → Column → Card → CardFooter),
// plus fakes for the plugin context's tracked timers and listeners.
import { parseHTML } from 'linkedom'

const escape = value =>
  String(value).replace(/[&<>"']/g, char => ({ '"': '&quot;', '&': '&amp;', "'": '&#39;', '<': '&lt;', '>': '&gt;' })[char])

/** Same derivation as the board's `shortId()`. */
export const shortId = id => id.replace(/^t_/, '').slice(0, 6)

/** One card tile, as `Card` renders it. */
export function tileHtml(task) {
  const summary = task.summary
    ? `<span class="line-clamp-2 text-[0.6875rem] leading-snug text-(--ui-text-tertiary)">${escape(task.summary)}</span>`
    : ''

  return `
    <div class="group relative flex cursor-grab flex-col gap-2 rounded-md border border-(--ui-stroke-tertiary) border-l-2 bg-(--ui-bg-elevated) p-2.5"
         draggable="true" style="--kanban-tone: #8b5cf6; border-left-color: #8b5cf6;">
      <span class="line-clamp-2 text-[0.8125rem] font-medium leading-snug text-foreground">${escape(task.title || task.id)}</span>
      ${summary}
      <div class="flex items-center gap-2 whitespace-nowrap text-[0.625rem] text-(--ui-text-tertiary)">
        <span class="inline-flex min-w-0 cursor-help items-center gap-1 font-medium">
          <span class="avatar">D</span><span class="truncate">→ default</span>
        </span>
        <div class="ml-auto flex min-w-0 shrink items-center gap-2">
          <span class="text-(--ui-text-quaternary)">2h</span>
          <span class="min-w-0 truncate font-mono text-(--ui-text-quaternary)">${escape(shortId(task.id))}</span>
        </div>
      </div>
    </div>`
}

/** One column with its header (no <h1>) and its tiles. */
export function columnHtml(name, tasks) {
  return `
    <div class="group/col flex h-full w-64 shrink-0 flex-col rounded-lg p-2 transition-colors" data-fixture-column="${escape(name)}">
      <header class="mb-1.5 flex h-5 items-center gap-1.5 px-1">
        <span class="cursor-help text-[0.6875rem] font-medium uppercase">${escape(name)}</span>
        <span class="text-[0.625rem] tabular-nums">${tasks.length}</span>
      </header>
      <div class="relative flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">${tasks.map(tileHtml).join('')}</div>
    </div>`
}

/** The whole page: the route wrapper, the page root with its <h1> header and
 *  the lanes container. `withTitle: false` drops the <h1> (markup changed). */
export function boardDocument(board, { withTitle = true } = {}) {
  const columns = board.columns.map(column => columnHtml(column.name, column.tasks)).join('')
  const title = withTitle ? '<h1 class="text-sm font-semibold text-foreground">Kanban</h1>' : '<span>Kanban</span>'

  const { document, window } = parseHTML(`<!doctype html><html><body>
    <nav id="sidebar"><span>Sessions</span></nav>
    <main id="workspace">
      <div class="contents">
        <div class="relative flex h-full flex-col overflow-hidden bg-(--ui-surface-background)" id="page">
          <header class="flex shrink-0 flex-wrap items-center gap-2 px-4 py-2">${title}<span>${board.columns.length}</span></header>
          <div class="flex flex-1 gap-2 overflow-x-auto px-4 pt-1 pb-3" id="lanes">${columns}</div>
        </div>
      </div>
    </main>
  </body></html>`)

  return { document, window }
}

/** A board snapshot as `/api/plugins/kanban/board` returns it. */
export function boardSnapshot(columns) {
  const tenants = [...new Set(columns.flatMap(column => column.tasks.map(task => task.tenant)).filter(Boolean))].sort()

  return {
    assignees: [],
    columns: columns.map(column => ({
      name: column.name,
      tasks: column.tasks.map(task => ({ assignee: null, body: null, status: column.name, ...task }))
    })),
    latest_event_id: 1,
    now: 0,
    tenants
  }
}

/** The bundled Kanban plugin's board query key. */
export const boardKey = (slug = '', archived = false) => ['kanban', 'board', 'local', slug, archived]

/** A window stand-in: linkedom has no `location`, and the route is a hash. */
export function fakeWindow(window, hash = '#/kanban') {
  const listeners = new Map()

  return {
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    },
    listenerCount: () => [...listeners.values()].reduce((sum, list) => sum + list.length, 0),
    location: { hash },
    MutationObserver: window.MutationObserver,
    removeEventListener(type, listener) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter(item => item !== listener)
      )
    }
  }
}

/** Manual stand-ins for ctx.setTimeout / ctx.setInterval / ctx.addEventListener:
 *  each returns a disposer, and `pending()` reports what is still live. */
export function fakeTimers() {
  const timeouts = new Set()
  const intervals = new Set()
  const listeners = new Set()

  return {
    addEventListener(target, type, listener) {
      target.addEventListener(type, listener)

      const entry = { listener, target, type }

      listeners.add(entry)

      return () => {
        if (listeners.delete(entry)) {
          target.removeEventListener(type, listener)
        }
      }
    },
    /** Run every queued timeout (and the ones they queue) until none is left. */
    flushTimeouts() {
      for (let guard = 0; timeouts.size > 0 && guard < 100; guard += 1) {
        for (const entry of [...timeouts]) {
          timeouts.delete(entry)
          entry.fn()
        }
      }
    },
    pending: () => ({ intervals: intervals.size, listeners: listeners.size, timeouts: timeouts.size }),
    runIntervals() {
      for (const entry of [...intervals]) {
        entry.fn()
      }
    },
    setInterval(fn, ms) {
      const entry = { fn, ms }

      intervals.add(entry)

      return () => intervals.delete(entry)
    },
    setTimeout(fn, ms) {
      const entry = { fn, ms }

      timeouts.add(entry)

      return () => timeouts.delete(entry)
    }
  }
}

/** Let linkedom deliver MutationObserver records, then run queued passes. */
export async function settle(timers) {
  for (let round = 0; round < 3; round += 1) {
    await new Promise(resolve => setTimeout(resolve, 0))
    timers.flushTimeouts()
  }
}

export const badgesIn = (root, attr) => [...root.querySelectorAll(`[${attr}]`)]
