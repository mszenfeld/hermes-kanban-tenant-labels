import assert from 'node:assert/strict'
import { after, afterEach, describe, test } from 'node:test'

import { badgesIn, boardDocument, boardKey, boardSnapshot, fakeTimers, fakeWindow, settle } from './helpers/fixture.mjs'
import { plugin, sdk } from './helpers/load-plugin.mjs'

const { BADGE_ATTR, PALETTE, PLUGIN_ID, preferredColour } = plugin
const definition = plugin.default

const COLUMNS = [
  {
    name: 'todo',
    tasks: [
      { id: 't_1f2e3d4c', tenant: 'backend', title: 'Fix login timeout' },
      { id: 't_11aa22bb', tenant: 'frontend', title: 'Landing page' },
      { id: 't_9a1b2c3d', tenant: null, title: 'No tenant here' }
    ]
  }
]

/** The parts of the plugin context the plugin uses, with host-like unload. */
function fakeContext(timers) {
  const disposers = []
  const pages = []
  const stored = new Map()

  return {
    addEventListener: (target, type, listener) => timers.addEventListener(target, type, listener),
    onDispose: fn => disposers.push(fn),
    pages,
    registerSettingsPage(page) {
      pages.push(page)

      return () => pages.splice(pages.indexOf(page), 1)
    },
    setInterval: (fn, ms) => timers.setInterval(fn, ms),
    setTimeout: (fn, ms) => timers.setTimeout(fn, ms),
    storage: {
      get: (key, fallback) => (stored.has(key) ? JSON.parse(stored.get(key)) : fallback),
      remove: key => stored.delete(key),
      set: (key, value) => stored.set(key, JSON.stringify(value))
    },
    stored,
    unload() {
      for (const dispose of disposers.splice(0)) {
        dispose()
      }
    }
  }
}

function installGlobals(hash = '#/kanban', columns = COLUMNS) {
  const board = boardSnapshot(columns)
  const { document, window } = boardDocument(board)
  const win = fakeWindow(window, hash)

  globalThis.document = document
  globalThis.window = win
  sdk.queryClient.setQueryData(boardKey(), board)

  return { board, document, win }
}

afterEach(() => {
  delete globalThis.document
  delete globalThis.window
  sdk.queryClient.clear()
})

after(() => {
  assert.equal(sdk.queryClient.listenerCount(), 0, 'a test left a cache subscription behind')
})

describe('plugin module', () => {
  test('default-exports a HermesPlugin whose id matches the install folder name', () => {
    assert.equal(definition.id, PLUGIN_ID)
    assert.equal(PLUGIN_ID, 'hermes-kanban-tenant-labels')
    assert.equal(typeof definition.name, 'string')
    assert.equal(typeof definition.register, 'function')
  })

  test('register() does not throw outside a browser and contributes nothing', () => {
    const timers = fakeTimers()
    const ctx = fakeContext(timers)

    assert.doesNotThrow(() => definition.register(ctx))
    assert.equal(ctx.pages.length, 0)
    assert.deepEqual(timers.pending(), { intervals: 0, listeners: 0, timeouts: 0 })
  })

  test('register() does not throw in the app and registers a settings page', () => {
    installGlobals()

    const timers = fakeTimers()
    const ctx = fakeContext(timers)

    assert.doesNotThrow(() => definition.register(ctx))
    assert.equal(ctx.pages.length, 1)
    assert.equal(ctx.pages[0].title, 'Kanban Tenant Labels')

    ctx.unload()
  })

  test('register() on a host without registerSettingsPage still labels cards', async () => {
    const { document } = installGlobals()
    const timers = fakeTimers()
    const ctx = fakeContext(timers)

    delete ctx.registerSettingsPage
    assert.doesNotThrow(() => definition.register(ctx))
    await settle(timers)

    assert.equal(badgesIn(document, BADGE_ATTR).length, 2)

    ctx.unload()
  })
})

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

describe('plugin lifecycle', () => {
  test('labels the board, applies a pinned color from Settings and removes everything on unload', async () => {
    const { board, document } = installGlobals()
    const timers = fakeTimers()
    const ctx = fakeContext(timers)

    definition.register(ctx)
    await settle(timers)

    const hueOf = tenant =>
      badgesIn(document, BADGE_ATTR)
        .find(badge => badge.textContent === tenant)
        ?.style.getPropertyValue('--kanban-tenant-hue')

    // The Settings page lists the board's tenants with the colors the badges use.
    const rows = () => ctx.pages[0].render().props.children[1]
    const row = tenant => rows().find(item => item.props.tenant === tenant)

    assert.deepEqual(
      rows().map(item => item.props.tenant),
      board.tenants
    )

    for (const item of rows()) {
      assert.equal(item.props.colour, hueOf(item.props.tenant))
      assert.equal(item.props.pinned, false)
    }

    // The row's color picker offers the palette, with nothing pinned yet.
    assert.deepEqual(swatchesOf(row('frontend')).swatches, PALETTE)
    assert.equal(swatchesOf(row('frontend')).value, null)

    // Picking a swatch pins it: persisted through ctx.storage, badge recolored.
    const pinned = PALETTE.find(colour => colour !== hueOf('frontend'))

    swatchesOf(row('frontend')).onChange(pinned)
    await settle(timers)

    assert.deepEqual(JSON.parse(ctx.stored.get('pins')), { frontend: pinned })
    assert.equal(hueOf('frontend'), pinned)
    assert.equal(row('frontend').props.pinned, true)
    assert.equal(swatchesOf(row('frontend')).value, pinned)

    // "Automatic color" (onChange(null)) clears the pin.
    swatchesOf(row('frontend')).onChange(null)
    await settle(timers)

    assert.deepEqual(JSON.parse(ctx.stored.get('pins')), {})

    ctx.unload()

    assert.equal(badgesIn(document, BADGE_ATTR).length, 0)
    assert.deepEqual(timers.pending(), { intervals: 0, listeners: 0, timeouts: 0 })
    assert.equal(sdk.queryClient.listenerCount(), 0)
  })

  test('a stored pin is applied on load; an invalid stored value is ignored', async () => {
    const { document } = installGlobals()
    const timers = fakeTimers()
    const ctx = fakeContext(timers)

    assert.notEqual(preferredColour('frontend'), PALETTE[2])
    ctx.storage.set('pins', { backend: 'url(javascript:x)', frontend: PALETTE[2] })
    definition.register(ctx)
    await settle(timers)

    const hues = Object.fromEntries(
      badgesIn(document, BADGE_ATTR).map(badge => [badge.textContent, badge.style.getPropertyValue('--kanban-tenant-hue')])
    )

    assert.equal(hues.frontend, PALETTE[2])
    assert.ok(PALETTE.includes(hues.backend))

    ctx.unload()
  })

  test('a tenant named __proto__ starts unpinned and can be pinned and unpinned', async () => {
    const { document } = installGlobals('#/kanban', [
      { name: 'todo', tasks: [{ id: 't_0b0b0b0b', tenant: '__proto__', title: 'Odd tenant' }] }
    ])
    const timers = fakeTimers()
    const ctx = fakeContext(timers)

    definition.register(ctx)
    await settle(timers)

    const row = () => ctx.pages[0].render().props.children[1].find(item => item.props.tenant === '__proto__')
    const hue = () => document.querySelector(`[${BADGE_ATTR}]`).style.getPropertyValue('--kanban-tenant-hue')

    assert.equal(row().props.pinned, false)
    assert.ok(PALETTE.includes(hue()))

    const pinned = PALETTE.find(colour => colour !== hue())

    swatchesOf(row()).onChange(pinned)
    await settle(timers)

    assert.equal(Object.getOwnPropertyDescriptor(JSON.parse(ctx.stored.get('pins')), '__proto__')?.value, pinned)
    assert.equal(hue(), pinned)
    assert.equal(row().props.pinned, true)

    swatchesOf(row()).onChange(null)
    await settle(timers)

    assert.deepEqual(Object.keys(JSON.parse(ctx.stored.get('pins'))), [])
    assert.equal(row().props.pinned, false)

    ctx.unload()
  })
})
