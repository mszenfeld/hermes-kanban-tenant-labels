/**
 * Kanban Tenant Labels for Hermes Desktop; README.md describes what it does.
 *
 * The plugin SDK has no contribution area for Kanban card tiles, so this
 * plugin decorates the board's DOM. When the markup or data does not match,
 * it logs one console warning per kind of mismatch and skips the cards it
 * cannot match; an exception in a host callback turns the labeler off.
 * Neither case affects the board.
 *
 * Disk plugins may import only `@hermes/plugin-sdk`, `react` and
 * `react/jsx-runtime`. The SDK is imported as a namespace so optional exports
 * can be feature-detected instead of failing the module load on older hosts.
 */

import * as sdk from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

export const PLUGIN_ID = 'hermes-kanban-tenant-labels'

const LOG_PREFIX = `[${PLUGIN_ID}]`

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

/** Twelve evenly spaced hues at the saturation and lightness of the app's
 *  identity colors (`PROFILE_SWATCHES` in the SDK), so tenant labels match
 *  profile tags. */
export const PALETTE = Object.freeze(Array.from({ length: 12 }, (_, index) => `hsl(${index * 30} 68% 58%)`))

const PALETTE_SET = new Set(PALETTE)

export function normaliseTenant(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 32-bit FNV-1a over UTF-16 code units. */
export function hashTenant(name) {
  let hash = 0x811c9dc5

  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash >>> 0
}

/** The hue a tenant gets when nothing else competes for it. */
export function preferredColour(tenant) {
  return PALETTE[hashTenant(normaliseTenant(tenant)) % PALETTE.length]
}

/** Keep only `{ tenant: color }` pairs whose color is a palette entry. The
 *  result has no prototype, so tenant names such as `constructor` or
 *  `__proto__` are plain keys, never inherited members or setters. */
export function sanitisePins(raw) {
  const pins = Object.create(null)

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return pins
  }

  for (const [key, colour] of Object.entries(raw)) {
    const tenant = normaliseTenant(key)

    if (tenant && PALETTE_SET.has(colour)) {
      pins[tenant] = colour
    }
  }

  return pins
}

export function pinOf(pins, tenant) {
  return pins && Object.hasOwn(pins, tenant) ? pins[tenant] : undefined
}

/**
 * Color per tenant. The result depends only on the tenant set and the pins,
 * never on input order.
 *
 * 1. Pinned tenants keep their pinned color, and every pinned color is
 *    reserved.
 * 2. The other tenants, in name order, take their preferred hue, or the next
 *    free hue after it if an earlier tenant or a pin holds it.
 * 3. With more tenants than hues, the overflow shares the first unpinned hue
 *    from its preferred one (its preferred hue if every hue is pinned).
 */
export function assignColours(tenants, pins = {}) {
  const safePins = sanitisePins(pins)
  const names = [...new Set([...tenants].map(normaliseTenant).filter(Boolean))].sort()
  const pinned = new Set(Object.values(safePins))
  const used = new Set(pinned)
  const colours = new Map()

  for (const name of names) {
    const pin = pinOf(safePins, name)

    if (pin) {
      colours.set(name, pin)
    }
  }

  const firstFrom = (start, isFree) => {
    for (let step = 0; step < PALETTE.length; step += 1) {
      const candidate = PALETTE[(start + step) % PALETTE.length]

      if (isFree(candidate)) {
        return candidate
      }
    }

    return null
  }

  for (const name of names) {
    if (colours.has(name)) {
      continue
    }

    const start = hashTenant(name) % PALETTE.length
    const colour =
      firstFrom(start, candidate => !used.has(candidate)) ??
      firstFrom(start, candidate => !pinned.has(candidate)) ??
      PALETTE[start]

    used.add(colour)
    colours.set(name, colour)
  }

  return colours
}

// ---------------------------------------------------------------------------
// Board data (the bundled Kanban plugin's React Query cache)
// ---------------------------------------------------------------------------

/** The bundled Kanban plugin keys board snapshots as
 *  `['kanban', 'board', connectionScope, boardSlug, includeArchived]`. */
export function isBoardQueryKey(key) {
  return Array.isArray(key) && key[0] === 'kanban' && key[1] === 'board'
}

function isBoardSnapshot(data) {
  return Boolean(data) && Array.isArray(data.columns)
}

/**
 * Board snapshots currently in the shared query cache, oldest first. Each one
 * carries its source (connection scope + board slug, so the archived and
 * unarchived variants of one board share it) and whether a mounted component
 * observes it (`null` when the cache cannot tell).
 */
export function readBoardSnapshots(queryClient) {
  const cache = queryClient?.getQueryCache?.()
  const queries = typeof cache?.getAll === 'function' ? cache.getAll() : []
  const snapshots = []

  for (const query of queries) {
    const data = query?.state?.data

    if (!isBoardQueryKey(query?.queryKey) || !isBoardSnapshot(data)) {
      continue
    }

    const observers = typeof query.getObserversCount === 'function' ? query.getObserversCount() : null

    snapshots.push({
      active: observers === null ? null : observers > 0,
      data,
      source: JSON.stringify([query.queryKey[2] ?? null, query.queryKey[3] ?? null]),
      updatedAt: Number(query.state.dataUpdatedAt) || 0
    })
  }

  return snapshots.sort((a, b) => a.updatedAt - b.updatedAt)
}

/** Desktop's `shortId()`, the id a tile shows: the task id without `t_`,
 *  first 6 characters. */
export function shortTaskId(id) {
  return String(id ?? '')
    .replace(/^t_/, '')
    .slice(0, 6)
}

/** What a tile shows as its title. */
export function displayTitle(task) {
  return String(task.title || task.id).trim()
}

/**
 * Index the tasks of the board on screen.
 *
 * - When the cache reports observers, only observed snapshots count (the
 *   board the Kanban page and its status-bar count show); otherwise every
 *   cached snapshot counts.
 * - Within one source, a task takes its fields from the newest snapshot (the
 *   archived/unarchived variants of a board, a refetch).
 * - Across sources (two boards or connections sharing a task id, such as an
 *   imported copy of a board), a task whose tenant differs is ambiguous and
 *   gets no tenant rather than another board's.
 */
export function buildTaskIndex(snapshots) {
  const observed = snapshots.filter(snapshot => snapshot.active === true)
  const bySource = new Map()
  const tenants = new Set()
  let tenantFields = 0

  for (const { data, source = '' } of observed.length > 0 ? observed : snapshots) {
    const records = bySource.get(source) ?? new Map()

    bySource.set(source, records)

    for (const name of Array.isArray(data.tenants) ? data.tenants : []) {
      const tenant = normaliseTenant(name)

      if (tenant) {
        tenants.add(tenant)
      }
    }

    for (const column of data.columns) {
      for (const task of Array.isArray(column?.tasks) ? column.tasks : []) {
        if (!task || typeof task.id !== 'string' || !task.id) {
          continue
        }

        const tenant = normaliseTenant(task.tenant)

        if (Object.hasOwn(task, 'tenant')) {
          tenantFields += 1
        }

        if (tenant) {
          tenants.add(tenant)
        }

        records.set(task.id, { id: task.id, tenant, title: displayTitle(task) })
      }
    }
  }

  const byId = new Map()

  for (const records of bySource.values()) {
    for (const [id, record] of records) {
      const seen = byId.get(id)

      byId.set(id, seen && seen.tenant !== record.tenant ? { ...record, tenant: '' } : record)
    }
  }

  const byShortId = new Map()

  for (const id of byId.keys()) {
    const short = shortTaskId(id)
    const ids = byShortId.get(short) ?? []

    ids.push(id)
    byShortId.set(short, ids)
  }

  return { byId, byShortId, hasTenantField: tenantFields > 0, tenants: [...tenants].sort() }
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

/** A Kanban card tile: the draggable element that carries the card's status
 *  color as the `--kanban-tone` custom property in its inline style. */
export const TILE_SELECTOR = '[draggable="true"][style*="--kanban-tone"]'

/** Marks the badge this plugin inserts (and nothing else). */
export const BADGE_ATTR = 'data-kanban-tenant-label'

const TENANT_ATTR = 'data-kanban-tenant'

function isBadge(node) {
  return node?.nodeType === 1 && node.hasAttribute(BADGE_ATTR)
}

/** Trimmed text of every leaf element in the tile (an element with no element
 *  children), ignoring this plugin's own badge. The title and the short id
 *  each sit in their own leaf `<span>`. */
export function leafTexts(tile) {
  const texts = new Set()

  for (const element of tile.querySelectorAll('*')) {
    if (element.childElementCount > 0 || isBadge(element)) {
      continue
    }

    const text = (element.textContent ?? '').trim()

    if (text) {
      texts.add(text)
    }
  }

  return texts
}

/**
 * The task a tile shows, or null when it cannot be told apart. A tile matches
 * a task when it shows both the task's short id and its title; anything
 * ambiguous (two tasks sharing both) is left alone.
 */
export function resolveTile(tile, index) {
  const texts = leafTexts(tile)
  const matches = new Set()

  for (const text of texts) {
    for (const id of index.byShortId.get(text) ?? []) {
      if (texts.has(index.byId.get(id).title)) {
        matches.add(id)
      }
    }
  }

  return matches.size === 1 ? [...matches][0] : null
}

/** Inline, so the badge needs no injected stylesheet and leaves nothing behind
 *  when removed. The hue tints the fill and the ring; the text is the theme's
 *  text color with 40% of the hue mixed in (OKLab). */
const BADGE_STYLE = [
  ['display', 'block'],
  ['align-self', 'flex-start'],
  ['box-sizing', 'border-box'],
  ['max-width', '100%'],
  ['overflow', 'hidden'],
  ['text-overflow', 'ellipsis'],
  ['white-space', 'nowrap'],
  ['padding', '0 0.375rem'],
  ['border-radius', '9999px'],
  ['font-size', '0.625rem'],
  ['font-weight', '500'],
  ['line-height', '1rem'],
  ['background-color', 'color-mix(in srgb, var(--kanban-tenant-hue) 16%, transparent)'],
  ['box-shadow', 'inset 0 0 0 1px color-mix(in srgb, var(--kanban-tenant-hue) 45%, transparent)'],
  ['color', 'color-mix(in oklab, var(--kanban-tenant-hue) 40%, var(--ui-text-primary, currentColor))']
]

function createBadge(doc) {
  const badge = doc.createElement('span')

  badge.setAttribute(BADGE_ATTR, '')

  for (const [property, value] of BADGE_STYLE) {
    badge.style.setProperty(property, value)
  }

  return badge
}

/**
 * Make the tile show exactly one badge for `label` (`{ tenant, colour }`), or
 * none when `label` is null. Writes only what differs, so running it again on
 * an up-to-date tile changes nothing (and wakes no observer).
 * Returns 'added' | 'updated' | 'removed' | 'unchanged'.
 */
export function applyBadge(tile, label) {
  const existing = [...tile.children].filter(isBadge)

  if (!label) {
    for (const badge of existing) {
      badge.remove()
    }

    return existing.length > 0 ? 'removed' : 'unchanged'
  }

  const [current, ...extra] = existing
  const added = !current
  const badge = current ?? createBadge(tile.ownerDocument)
  let changed = extra.length > 0

  for (const duplicate of extra) {
    duplicate.remove()
  }

  if (added) {
    tile.insertBefore(badge, tile.firstChild)
  }

  if (badge.getAttribute(TENANT_ATTR) !== label.tenant) {
    badge.setAttribute(TENANT_ATTR, label.tenant)
    badge.setAttribute('title', `Tenant: ${label.tenant}`)
    badge.textContent = label.tenant
    changed = true
  }

  if (badge.style.getPropertyValue('--kanban-tenant-hue') !== label.colour) {
    badge.style.setProperty('--kanban-tenant-hue', label.colour)
    changed = true
  }

  return added ? 'added' : changed ? 'updated' : 'unchanged'
}

/** The Kanban page root: the nearest ancestor of a tile with a direct
 *  `<header>` child that holds the page's `<h1>` title. (Columns also have a
 *  `<header>`, but without an `<h1>`.) */
export function findBoardRoot(tile, maxDepth = 16) {
  let element = tile.parentElement

  for (let depth = 0; element && depth < maxDepth; depth += 1) {
    if (element === element.ownerDocument.body) {
      return null
    }

    for (const child of element.children) {
      if (child.tagName === 'HEADER' && child.querySelector('h1')) {
        return element
      }
    }

    element = element.parentElement
  }

  return null
}

/** `#/kanban` (optionally with a sub-path or query string). Desktop uses a
 *  HashRouter, so the route is `location.hash`. */
export function isKanbanRoute(hash) {
  const path = String(hash ?? '')
    .replace(/^#/, '')
    .split(/[?#]/, 1)[0]

  return path === '/kanban' || path.startsWith('/kanban/')
}

// ---------------------------------------------------------------------------
// The labeler: route gate + scoped observer + idempotent passes
// ---------------------------------------------------------------------------

export const ROUTE_POLL_MS = 750
export const PASS_DELAY_MS = 50
/** Route ticks with board data but no tile on screen before logging once. */
const MISSING_TILE_TICKS = 8

function sameList(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/**
 * Everything environmental is injected so tests can drive the labeler with a
 * DOM fixture and a fake query cache. In the app, the timers and listeners are
 * the plugin context's tracked ones.
 */
export function createTenantLabeler({
  doc,
  win,
  queryClient,
  getPins = () => ({}),
  onTenants = () => {},
  setTimeout: schedule,
  setInterval: every,
  addEventListener: listen,
  log = message => console.warn(`${LOG_PREFIX} ${message}`)
}) {
  const badges = new Set()
  const bindings = new WeakMap()
  const roots = new Set()
  const warned = new Set()
  const stops = []

  let active = false
  let disposed = false
  let observer = null
  let pending = null
  let idleTicks = 0
  let tenants = []
  let indexCache = { index: buildTaskIndex([]), sources: [] }

  const warnOnce = (key, message) => {
    if (!warned.has(key)) {
      warned.add(key)
      log(message)
    }
  }

  const currentIndex = () => {
    const snapshots = readBoardSnapshots(queryClient)
    const sources = snapshots.flatMap(snapshot => [snapshot.data, snapshot.active])

    if (!sameList(sources, indexCache.sources)) {
      indexCache = { index: buildTaskIndex(snapshots), sources }
    }

    return indexCache.index
  }

  const publishTenants = index => {
    if (!sameList(index.tenants, tenants)) {
      tenants = index.tenants
      onTenants(tenants)
    }
  }

  const removeBadges = () => {
    for (const badge of badges) {
      badge.remove()
    }

    badges.clear()
  }

  const detach = () => {
    observer?.disconnect()
    observer = null
    roots.clear()
  }

  const shutdown = () => {
    if (disposed) {
      return
    }

    disposed = true
    active = false

    const cleanup = [...stops.splice(0), pending, detach, removeBadges]

    pending = null

    for (const stop of cleanup) {
      try {
        stop?.()
      } catch {
        // A failing disposer must not prevent the remaining cleanup.
      }
    }
  }

  // Host callbacks must never throw into the board's query or render work.
  const guarded = (name, fn) => (...args) => {
    if (disposed) {
      return
    }

    try {
      return fn(...args)
    } catch (error) {
      shutdown()

      try {
        warnOnce('error', `${name} failed (${error?.message ?? error}); labels are off.`)
      } catch {
        // Even a failing logger must not escape back into the host.
      }
    }
  }

  const taskFor = (tile, index) => {
    const bound = bindings.get(tile)

    // React keys tiles by task id, so a tile element keeps showing one task.
    // Re-check cheaply anyway before trusting the binding.
    if (bound && index.byId.has(bound) && (tile.textContent ?? '').includes(shortTaskId(bound))) {
      return bound
    }

    const id = resolveTile(tile, index)

    if (id) {
      bindings.set(tile, id)
    }

    return id
  }

  const pass = () => {
    if (disposed || !active) {
      return
    }

    // A board re-mounted: re-sync. A successful sync runs the pass itself.
    if (roots.size === 0 || [...roots].some(root => !root.isConnected)) {
      sync()

      return
    }

    const index = currentIndex()
    const tiles = [...roots].flatMap(root => [...root.querySelectorAll(TILE_SELECTOR)])

    publishTenants(index)

    if (tiles.length === 0) {
      return
    }

    if (index.byId.size === 0) {
      warnOnce('data', 'Kanban card tiles are on screen but no board data was found in the query cache; labels are off.')

      return
    }

    if (!index.hasTenantField) {
      warnOnce('fields', 'Board data has no `tenant` field on any task (renamed?); labels are off.')
    }

    const colours = assignColours(index.tenants, getPins())
    let resolved = 0

    for (const tile of tiles) {
      const id = taskFor(tile, index)

      // Unresolved (for example mid-update): leave the tile as it is.
      if (!id) {
        continue
      }

      resolved += 1

      const { tenant } = index.byId.get(id)

      applyBadge(tile, tenant ? { colour: colours.get(tenant) ?? preferredColour(tenant), tenant } : null)

      for (const child of tile.children) {
        if (isBadge(child)) {
          badges.add(child)
        }
      }
    }

    for (const badge of badges) {
      if (!badge.isConnected) {
        badges.delete(badge)
      }
    }

    if (resolved === 0) {
      warnOnce('match', 'No Kanban card tile could be matched to a task (id/title markup changed?); labels are off.')
    }
  }

  /** Delayed, coalesced pass for cache updates (data can land before React
   *  commits it; the observer catches the commit itself). */
  const requestPass = () => {
    if (disposed || pending || !active) {
      return
    }

    pending = schedule(guarded('scheduled pass', () => {
      pending = null
      pass()
    }), PASS_DELAY_MS)
  }

  const isOwnMutation = record => {
    const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement

    if (target?.closest?.(`[${BADGE_ATTR}]`)) {
      return true
    }

    const nodes = [...(record.addedNodes ?? []), ...(record.removedNodes ?? [])]

    return record.type === 'childList' && nodes.length > 0 && nodes.every(isBadge)
  }

  // Observer callbacks run as a microtask after React's commit and before the
  // next paint, so a new tile is labeled in the frame it first appears in.
  const onMutations = records => {
    if (!records.every(isOwnMutation)) {
      pass()
    }
  }

  /**
   * Observe the page root of every board on screen: the main page, plus a board
   * in a split tile while the main route is the board. A mounted board stays
   * observed when all its cards are filtered out, so its next tile is labeled
   * before paint. Returns 'observed', 'empty' (no tile on screen) or 'rootless'.
   */
  const sync = () => {
    const found = new Set([...roots].filter(root => root.isConnected))
    let tiles = 0

    for (const tile of doc.querySelectorAll(TILE_SELECTOR)) {
      tiles += 1

      if (![...found].some(root => root.contains(tile))) {
        const root = findBoardRoot(tile)

        if (root) {
          found.add(root)
        }
      }
    }

    if (tiles > 0 && found.size === 0) {
      warnOnce('root', 'Kanban page root (a <header> with an <h1>) not found around the card tiles; labels are off.')
    }

    const status = tiles === 0 ? 'empty' : found.size === 0 ? 'rootless' : 'observed'

    if (found.size === roots.size && [...found].every(root => roots.has(root))) {
      return status
    }

    detach()

    if (found.size === 0) {
      return status
    }

    observer = new win.MutationObserver(guarded('observer', onMutations))

    for (const root of found) {
      roots.add(root)
      observer.observe(root, { characterData: true, childList: true, subtree: true })
    }

    pass()

    return status
  }

  const tick = () => {
    if (disposed) {
      return
    }

    if (!isKanbanRoute(win.location?.hash)) {
      if (active) {
        active = false
        idleTicks = 0
        detach()
        removeBadges()
      }

      return
    }

    active = true

    // Tiles on screen, or a board already found on this route (its cards are
    // just filtered out): nothing to report.
    if (sync() !== 'empty' || roots.size > 0) {
      idleTicks = 0

      return
    }

    // On the board route with tasks in the cache but no tile ever found:
    // either every card is filtered out, or the tile markup changed.
    if (currentIndex().byId.size === 0) {
      return
    }

    idleTicks += 1

    if (idleTicks === MISSING_TILE_TICKS) {
      warnOnce(
        'tiles',
        `No Kanban card tile matched ${TILE_SELECTOR} (if cards are visible, the board markup changed); labels are off.`
      )
    }
  }

  const onCacheEvent = event => {
    if (disposed || !isBoardQueryKey(event?.query?.queryKey)) {
      return
    }

    // The board mounting (its query gains an observer) opens the route gate
    // at once, without waiting for the next poll.
    if (!active) {
      tick()
    }

    publishTenants(currentIndex())
    requestPass()
  }

  return {
    start: guarded('startup', () => {
      if (disposed || stops.length > 0) {
        return
      }

      const cache = queryClient?.getQueryCache?.()

      if (typeof cache?.subscribe === 'function') {
        stops.push(cache.subscribe(guarded('cache listener', onCacheEvent)))
      }

      const onRouteChange = guarded('route change', tick)

      stops.push(every(guarded('route poll', tick), ROUTE_POLL_MS))
      stops.push(listen(win, 'hashchange', onRouteChange))
      stops.push(listen(win, 'popstate', onRouteChange))
      publishTenants(currentIndex())
      tick()
    }),

    /** Pins changed: schedule a pass. */
    refresh: guarded('refresh', requestPass),

    dispose: shutdown
  }
}

// ---------------------------------------------------------------------------
// Settings → Plugins → Kanban Tenant Labels
// ---------------------------------------------------------------------------

const SETTINGS_EXPORTS = ['ColorSwatches', 'ListRow', 'Popover', 'PopoverContent', 'PopoverTrigger', 'useValue']

function swatch(colour) {
  return jsx('span', {
    'aria-hidden': true,
    style: {
      backgroundColor: colour,
      borderRadius: '9999px',
      display: 'inline-block',
      flex: 'none',
      height: '0.75rem',
      width: '0.75rem'
    }
  })
}

function TenantColourRow({ colour, onPin, pinned, tenant }) {
  const { ColorSwatches, ListRow, Popover, PopoverContent, PopoverTrigger } = sdk

  return jsx(ListRow, {
    action: jsxs(Popover, {
      children: [
        jsx(PopoverTrigger, {
          asChild: true,
          children: jsxs('button', {
            'aria-label': `Color for ${tenant}`,
            className:
              'inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background)',
            type: 'button',
            children: [swatch(colour), pinned ? 'Pinned' : 'Automatic']
          })
        }),
        jsx(PopoverContent, {
          className: 'w-auto p-3',
          children: jsx(ColorSwatches, {
            clearLabel: 'Automatic color',
            onChange: next => onPin(tenant, next),
            swatches: PALETTE,
            value: pinned ? colour : null
          })
        })
      ]
    }),
    description: pinned ? 'Pinned color.' : 'Automatic color from the tenant name.',
    title: jsxs('span', { className: 'inline-flex items-center gap-2', children: [swatch(colour), tenant] })
  })
}

function registerSettings(ctx, { $pins, $tenants, setPin }) {
  if (typeof ctx.registerSettingsPage !== 'function' || SETTINGS_EXPORTS.some(name => !sdk[name])) {
    return
  }

  ctx.registerSettingsPage({
    icon: 'tag',
    id: 'colours',
    render: function TenantColours() {
      const pins = sdk.useValue($pins)
      const tenants = sdk.useValue($tenants)
      const names = [...new Set([...tenants, ...Object.keys(pins)])].sort()
      const colours = assignColours(names, pins)
      const { ListRow } = sdk

      return jsxs('div', {
        children: [
          jsx(ListRow, {
            description:
              'Each tenant gets a color automatically, which can shift when tenants are added or removed. Pick a color to pin it: pinned colors stay fixed and other tenants avoid them.',
            title: 'Tenant colors'
          }),
          names.length === 0
            ? jsx(ListRow, {
                description: 'Open the Kanban board once; the tenants of its cards show up here.',
                title: 'No tenants yet'
              })
            : names.map(tenant =>
                jsx(
                  TenantColourRow,
                  { colour: colours.get(tenant), onPin: setPin, pinned: pinOf(pins, tenant) !== undefined, tenant },
                  tenant
                )
              )
        ]
      })
    },
    title: 'Kanban Tenant Labels'
  })
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default {
  id: PLUGIN_ID,
  name: 'Kanban Tenant Labels',
  register(ctx) {
    const { atom, queryClient } = sdk

    if (typeof document === 'undefined' || typeof window === 'undefined' || typeof atom !== 'function') {
      return
    }

    const tracked = [ctx.addEventListener, ctx.onDispose, ctx.setInterval, ctx.setTimeout]

    if (
      typeof queryClient?.getQueryCache !== 'function' ||
      typeof window.MutationObserver !== 'function' ||
      tracked.some(fn => typeof fn !== 'function')
    ) {
      console.warn(`${LOG_PREFIX} The SDK query cache, MutationObserver or tracked timers are unavailable; labels are off.`)

      return
    }

    const $pins = atom(sanitisePins(ctx.storage?.get('pins', {})))
    const $tenants = atom([])

    const labeler = createTenantLabeler({
      addEventListener: (target, type, listener) => ctx.addEventListener(target, type, listener),
      doc: document,
      getPins: () => $pins.get(),
      onTenants: list => $tenants.set(list),
      queryClient,
      setInterval: (fn, ms) => ctx.setInterval(fn, ms),
      setTimeout: (fn, ms) => ctx.setTimeout(fn, ms),
      win: window
    })

    const setPin = (tenant, colour) => {
      const next = sanitisePins($pins.get())

      if (colour && PALETTE_SET.has(colour)) {
        next[tenant] = colour
      } else {
        delete next[tenant]
      }

      $pins.set(next)
      ctx.storage?.set('pins', next)
      labeler.refresh()
    }

    ctx.onDispose(() => labeler.dispose())
    labeler.start()
    registerSettings(ctx, { $pins, $tenants, setPin })
  }
}
