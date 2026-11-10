/**
 * Kanban Tenant Labels for Hermes Desktop; README.md describes what it does.
 *
 * Cards are labeled through the SDK's Kanban card badge slot
 * (`KANBAN_CARD_AREAS.badges`): Desktop calls `decorate(card, board)` for each
 * card and paints the returned label itself. The plugin assigns the colors and
 * provides the settings page for pinning them; it never touches the board's
 * markup or data.
 *
 * Disk plugins may import only `@hermes/plugin-sdk`, `react` and
 * `react/jsx-runtime`. The SDK is imported as a namespace so the slot can be
 * feature-detected instead of failing the module load on older hosts.
 */

import * as sdk from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

export const PLUGIN_ID = 'hermes-kanban-tenant-labels'

const LOG_PREFIX = `[${PLUGIN_ID}]`

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

/** Twelve evenly spaced hues. `PALETTE[i]` is the color Desktop paints for the
 *  badge tone `KANBAN_CARD_BADGE_HUES[i]` (both follow the app's
 *  `PROFILE_SWATCHES`), and pins store these strings. */
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
// Card badges (`KANBAN_CARD_AREAS.badges`)
// ---------------------------------------------------------------------------

/** The contribution id. Registering it again replaces the contribution. */
const BADGE_ID = 'tenant'

function sameList(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/**
 * `decorate(card, board)` for the badge contribution. Desktop calls it for every
 * card while the board renders, so it only looks colors up: they come from
 * `assignColours(board.tenants, pins)` and are recomputed when the board's
 * tenant list changes, which also passes the trimmed, sorted list to
 * `onTenants`. `hues` is the SDK's `KANBAN_CARD_BADGE_HUES`: the same twelve
 * hues as `PALETTE`, in the same order.
 */
function createDecorator({ hues, onTenants, pins }) {
  let seen = null
  let colours = new Map()

  return (card, board) => {
    const listed = Array.isArray(board?.tenants) ? board.tenants : []

    if (!seen || !sameList(listed, seen)) {
      const names = [...new Set(listed.map(normaliseTenant).filter(Boolean))].sort()

      seen = listed
      colours = assignColours(names, pins)
      onTenants(names)
    }

    const tenant = normaliseTenant(card?.tenant)

    if (!tenant) {
      return null
    }

    const colour = colours.get(tenant) ?? preferredColour(tenant)

    return { label: tenant, tone: hues[PALETTE.indexOf(colour)], tooltip: `Tenant: ${tenant}` }
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
                description: 'Open a Kanban board that shows at least one card; its tenants show up here.',
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
    const { KANBAN_CARD_AREAS: areas, KANBAN_CARD_BADGE_HUES: hues, atom } = sdk

    if (
      typeof areas?.badges !== 'string' ||
      !Array.isArray(hues) ||
      hues.length !== PALETTE.length ||
      typeof atom !== 'function' ||
      typeof ctx.register !== 'function' ||
      typeof ctx.setTimeout !== 'function'
    ) {
      console.warn(`${LOG_PREFIX} This Hermes Desktop has no Kanban card badge slot (KANBAN_CARD_AREAS.badges); labels are off.`)

      return
    }

    const $pins = atom(sanitisePins(ctx.storage?.get('pins', {})))
    const $tenants = atom([])
    let queued = null

    // decorate() runs while the board renders, so the settings page's tenant
    // list is updated after that render instead of during it.
    const publishTenants = names => {
      const idle = queued === null

      queued = names

      if (idle) {
        ctx.setTimeout(() => {
          const next = queued

          queued = null

          if (!sameList(next, $tenants.get())) {
            $tenants.set(next)
          }
        }, 0)
      }
    }

    // Registering the same id again replaces the contribution, so the board
    // repaints with the current pins.
    const registerBadges = () =>
      ctx.register({
        area: areas.badges,
        data: { decorate: createDecorator({ hues, onTenants: publishTenants, pins: $pins.get() }) },
        id: BADGE_ID
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
      registerBadges()
    }

    registerBadges()
    registerSettings(ctx, { $pins, $tenants, setPin })
  }
}
