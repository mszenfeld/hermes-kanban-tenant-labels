import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'

import { plugin, sdk } from './helpers/load-plugin.mjs'

const { PALETTE, PLUGIN_ID, assignColours, preferredColour } = plugin
const definition = plugin.default

const BADGE_KEY = 'kanban.card.badges:tenant'
const TENANTS = ['backend', 'frontend', 'mobile']

/** The parts of the plugin context the plugin uses. `register` replaces a
 *  contribution with the same area and id, like the host registry. */
function fakeContext() {
  const contributions = new Map()
  const pages = []
  const stored = new Map()
  const timeouts = new Set()

  return {
    contributions,
    flushTimeouts() {
      for (const fn of [...timeouts]) {
        timeouts.delete(fn)
        fn()
      }
    },
    pages,
    register(contribution) {
      const key = `${contribution.area}:${contribution.id}`

      contributions.set(key, contribution)

      return () => contributions.delete(key)
    },
    registerSettingsPage(page) {
      pages.push(page)

      return () => pages.splice(pages.indexOf(page), 1)
    },
    setTimeout(fn) {
      timeouts.add(fn)

      return () => timeouts.delete(fn)
    },
    storage: {
      get: (key, fallback) => (stored.has(key) ? JSON.parse(stored.get(key)) : fallback),
      remove: key => stored.delete(key),
      set: (key, value) => stored.set(key, JSON.stringify(value))
    },
    stored
  }
}

/** What the board would get from decorate() for a card with `tenant` on a
 *  board whose tenant list is `tenants`, with the host's frozen views. */
function badgeFor(ctx, tenant, tenants = TENANTS) {
  const { decorate } = ctx.contributions.get(BADGE_KEY).data

  return decorate(
    Object.freeze({ assignee: null, id: 't_1f2e3d4c', status: 'todo', tenant }),
    Object.freeze({ tenants: Object.freeze([...tenants]) })
  )
}

const toneOf = colour => sdk.KANBAN_CARD_BADGE_HUES[PALETTE.indexOf(colour)]
const rows = ctx => ctx.pages[0].render().props.children[1]

afterEach(() => sdk.setBadgeSlot(true))

/** Render one settings row a level deep and return its ColorSwatches props. */
function swatchesOf(row) {
  const find = node => {
    if (!node || typeof node !== 'object') {
      return null
    }

    if (Array.isArray(node)) {
      return node.map(find).find(Boolean) ?? null
    }

    if (node.type === sdk.ColorSwatches) {
      return node.props
    }

    return find(node.props?.children) ?? find(node.props?.action)
  }

  return find(row.type(row.props))
}

describe('plugin module', () => {
  test('default-exports a HermesPlugin whose id matches the install folder name', () => {
    assert.equal(definition.id, PLUGIN_ID)
    assert.equal(PLUGIN_ID, 'hermes-kanban-tenant-labels')
    assert.equal(typeof definition.name, 'string')
    assert.equal(typeof definition.register, 'function')
  })

  test('register() adds the tenant badge to the Kanban card badge area and a settings page', () => {
    const ctx = fakeContext()

    definition.register(ctx)

    assert.deepEqual([...ctx.contributions.keys()], [BADGE_KEY])
    assert.equal(ctx.pages.length, 1)
    assert.equal(ctx.pages[0].title, 'Kanban Tenant Labels')
  })

  test('on a Hermes without the card badge slot, register() adds nothing and warns once', t => {
    const ctx = fakeContext()
    const warn = t.mock.method(console, 'warn', () => {})

    sdk.setBadgeSlot(false)
    definition.register(ctx)

    assert.equal(ctx.contributions.size, 0)
    assert.equal(ctx.pages.length, 0)
    assert.equal(warn.mock.callCount(), 1)
    assert.ok(warn.mock.calls[0].arguments[0].startsWith('[hermes-kanban-tenant-labels] '))
  })

  test('register() on a host without registerSettingsPage still adds the badge', () => {
    const ctx = fakeContext()

    delete ctx.registerSettingsPage
    definition.register(ctx)

    assert.equal(badgeFor(ctx, 'backend').label, 'backend')
  })
})

describe('tenant badges', () => {
  test('a card with a tenant gets its name, its assigned hue and a tooltip', () => {
    const ctx = fakeContext()

    definition.register(ctx)

    assert.deepEqual(badgeFor(ctx, 'frontend'), {
      label: 'frontend',
      tone: toneOf(assignColours(TENANTS).get('frontend')),
      tooltip: 'Tenant: frontend'
    })
  })

  test('a card without a tenant gets no badge', () => {
    const ctx = fakeContext()

    definition.register(ctx)

    for (const tenant of [null, '', '   ']) {
      assert.equal(badgeFor(ctx, tenant), null)
    }
  })

  test("tenant names are trimmed on the card and in the board's tenant list", () => {
    const ctx = fakeContext()

    definition.register(ctx)

    const badge = badgeFor(ctx, '  frontend ', [' frontend', 'backend'])

    assert.equal(badge.label, 'frontend')
    assert.equal(badge.tone, toneOf(assignColours(['backend', 'frontend']).get('frontend')))
  })

  test('tenants whose preferred hues collide get different hues', () => {
    const ctx = fakeContext()

    assert.equal(preferredColour('api'), preferredColour('design'))
    definition.register(ctx)

    assert.notEqual(badgeFor(ctx, 'api', ['api', 'design']).tone, badgeFor(ctx, 'design', ['api', 'design']).tone)
  })

  test("a change in the board's tenant list recolors the badges and replaces the settings list", () => {
    const ctx = fakeContext()

    assert.notEqual(assignColours(['design']).get('design'), assignColours(['api', 'design']).get('design'))
    definition.register(ctx)

    for (const list of [['design'], ['api', 'design'], ['design']]) {
      assert.equal(badgeFor(ctx, 'design', list).tone, toneOf(assignColours(list).get('design')))
      ctx.flushTimeouts()
      assert.deepEqual(rows(ctx).map(row => row.props.tenant), list)
    }
  })

  test('each palette color is painted as the SDK hue at the same index', () => {
    for (let index = 0; index < PALETTE.length; index += 1) {
      const ctx = fakeContext()

      ctx.storage.set('pins', { acme: PALETTE[index] })
      definition.register(ctx)

      assert.equal(badgeFor(ctx, 'acme', ['acme']).tone, sdk.KANBAN_CARD_BADGE_HUES[index])
    }
  })
})

describe('settings page', () => {
  test("lists the board's tenants once the board has rendered, with the badges' hues", () => {
    const ctx = fakeContext()

    definition.register(ctx)

    assert.equal(rows(ctx).props.title, 'No tenants yet')
    badgeFor(ctx, 'backend')
    assert.equal(rows(ctx).props.title, 'No tenants yet')
    ctx.flushTimeouts()
    assert.deepEqual(rows(ctx).map(row => row.props.tenant), TENANTS)

    for (const row of rows(ctx)) {
      assert.equal(row.props.pinned, false)
      assert.equal(toneOf(row.props.colour), badgeFor(ctx, row.props.tenant).tone)
      assert.deepEqual(swatchesOf(row).swatches, PALETTE)
    }
  })

  test('picking a color pins it and repaints the badges; Automatic color unpins', () => {
    const ctx = fakeContext()

    definition.register(ctx)
    badgeFor(ctx, 'backend')
    ctx.flushTimeouts()

    const row = tenant => rows(ctx).find(item => item.props.tenant === tenant)
    const before = ctx.contributions.get(BADGE_KEY)
    const automatic = badgeFor(ctx, 'frontend').tone
    const pinned = PALETTE.find(colour => toneOf(colour) !== automatic)

    swatchesOf(row('frontend')).onChange(pinned)

    assert.deepEqual(JSON.parse(ctx.stored.get('pins')), { frontend: pinned })
    assert.notEqual(ctx.contributions.get(BADGE_KEY), before)
    assert.equal(badgeFor(ctx, 'frontend').tone, toneOf(pinned))
    assert.equal(row('frontend').props.pinned, true)
    assert.equal(swatchesOf(row('frontend')).value, pinned)

    swatchesOf(row('frontend')).onChange(null)

    assert.deepEqual(JSON.parse(ctx.stored.get('pins')), {})
    assert.equal(badgeFor(ctx, 'frontend').tone, automatic)
  })

  test('a stored pin is applied on load; an invalid stored value is ignored', () => {
    const ctx = fakeContext()

    assert.notEqual(preferredColour('frontend'), PALETTE[2])
    ctx.storage.set('pins', { backend: 'url(javascript:x)', frontend: PALETTE[2] })
    definition.register(ctx)

    assert.equal(badgeFor(ctx, 'frontend').tone, sdk.KANBAN_CARD_BADGE_HUES[2])
    assert.equal(badgeFor(ctx, 'backend').tone, toneOf(assignColours(TENANTS, { frontend: PALETTE[2] }).get('backend')))
  })

  test('a tenant named __proto__ starts unpinned and can be pinned and unpinned', () => {
    const ctx = fakeContext()

    definition.register(ctx)
    badgeFor(ctx, '__proto__', ['__proto__'])
    ctx.flushTimeouts()

    const row = () => rows(ctx).find(item => item.props.tenant === '__proto__')
    const automatic = badgeFor(ctx, '__proto__', ['__proto__']).tone
    const pinned = PALETTE.find(colour => toneOf(colour) !== automatic)

    assert.equal(row().props.pinned, false)
    swatchesOf(row()).onChange(pinned)

    assert.equal(Object.getOwnPropertyDescriptor(JSON.parse(ctx.stored.get('pins')), '__proto__')?.value, pinned)
    assert.equal(badgeFor(ctx, '__proto__', ['__proto__']).tone, toneOf(pinned))
    assert.equal(row().props.pinned, true)

    swatchesOf(row()).onChange(null)

    assert.deepEqual(Object.keys(JSON.parse(ctx.stored.get('pins'))), [])
    assert.equal(row().props.pinned, false)
  })
})
