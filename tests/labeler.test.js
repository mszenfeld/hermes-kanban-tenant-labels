import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  badgesIn,
  boardDocument,
  boardKey,
  boardSnapshot,
  fakeTimers,
  fakeWindow,
  settle,
  tileHtml
} from './helpers/fixture.mjs'
import { plugin, sdk } from './helpers/load-plugin.mjs'

const { BADGE_ATTR, PALETTE, TILE_SELECTOR, applyBadge, assignColours, createTenantLabeler } = plugin

const COLUMNS = [
  {
    name: 'todo',
    tasks: [
      { id: 't_1f2e3d4c', tenant: 'backend', title: 'Fix login timeout' },
      { id: 't_11aa22bb', tenant: 'frontend', title: 'Landing page' }
    ]
  },
  { name: 'running', tasks: [{ id: 't_9a1b2c3d', tenant: null, title: 'No tenant here' }] }
]

/** A board page on `#/kanban`, its cache entry and a labeler wired to fakes. */
function setup({
  columns = COLUMNS,
  hash = '#/kanban',
  withTitle = true,
  pins = {},
  getPins = () => pins,
  onTenants
} = {}) {
  const board = boardSnapshot(columns)
  const { document, window } = boardDocument(board, { withTitle })
  const win = fakeWindow(window, hash)
  const timers = fakeTimers()
  const client = sdk.createFakeQueryClient()
  const logs = []
  const observed = []
  const live = new Set()

  // Record what the labeler observes, and which observers are still
  // connected, so scope and teardown can be asserted.
  win.MutationObserver = class extends window.MutationObserver {
    observe(target, options) {
      observed.push(target)
      live.add(this)
      super.observe(target, options)
    }

    disconnect() {
      live.delete(this)
      super.disconnect()
    }
  }

  client.setQueryData(boardKey(), board)

  const labeler = createTenantLabeler({
    addEventListener: timers.addEventListener,
    doc: document,
    getPins,
    log: message => logs.push(message),
    onTenants,
    queryClient: client,
    setInterval: timers.setInterval,
    setTimeout: timers.setTimeout,
    win
  })

  return { board, client, document, labeler, live, logs, observed, timers, win }
}

const labelsOf = document =>
  [...document.querySelectorAll(TILE_SELECTOR)].map(tile => {
    const badges = [...tile.children].filter(child => child.hasAttribute(BADGE_ATTR))

    return badges.map(badge => badge.textContent)
  })

describe('applyBadge', () => {
  const tile = () => boardDocument(boardSnapshot(COLUMNS)).document.querySelector(TILE_SELECTOR)

  test('is idempotent: applying the same label twice leaves one badge', () => {
    const element = tile()
    const label = { colour: PALETTE[3], tenant: 'frontend' }

    assert.equal(applyBadge(element, label), 'added')
    assert.equal(applyBadge(element, label), 'unchanged')
    assert.equal(badgesIn(element, BADGE_ATTR).length, 1)
    assert.equal(element.firstElementChild.textContent, 'frontend')
  })

  test('updates the badge in place when the tenant or color changes', () => {
    const element = tile()

    applyBadge(element, { colour: PALETTE[3], tenant: 'frontend' })
    const badge = element.firstElementChild

    assert.equal(applyBadge(element, { colour: PALETTE[5], tenant: 'docs' }), 'updated')
    assert.equal(element.firstElementChild, badge)
    assert.equal(badge.textContent, 'docs')
    assert.equal(badge.style.getPropertyValue('--kanban-tenant-hue'), PALETTE[5])
  })

  test('collapses duplicates left behind (e.g. by a reload) into one badge', () => {
    const element = tile()

    applyBadge(element, { colour: PALETTE[3], tenant: 'frontend' })
    element.append(element.firstElementChild.cloneNode(true))

    assert.equal(applyBadge(element, { colour: PALETTE[3], tenant: 'frontend' }), 'updated')
    assert.equal(badgesIn(element, BADGE_ATTR).length, 1)
  })

  test('removes the badge when the card has no tenant', () => {
    const element = tile()

    applyBadge(element, { colour: PALETTE[3], tenant: 'frontend' })

    assert.equal(applyBadge(element, null), 'removed')
    assert.equal(applyBadge(element, null), 'unchanged')
    assert.equal(badgesIn(element, BADGE_ATTR).length, 0)
  })
})

describe('labeler', () => {
  test('labels every tenant card with its assigned color and leaves tenant-less cards alone', async () => {
    const { board, document, labeler, timers } = setup()

    labeler.start()
    await settle(timers)

    assert.deepEqual(labelsOf(document), [['backend'], ['frontend'], []])

    const colours = assignColours(board.tenants)

    for (const badge of badgesIn(document, BADGE_ATTR)) {
      assert.equal(badge.style.getPropertyValue('--kanban-tenant-hue'), colours.get(badge.textContent))
    }

    // Card titles are untouched.
    assert.equal(
      document.querySelector(TILE_SELECTOR).querySelector('span:not([data-kanban-tenant-label])').textContent,
      'Fix login timeout'
    )
  })

  test('running the decorator again does not duplicate badges', async () => {
    const { document, labeler, timers } = setup()

    labeler.start()
    await settle(timers)
    labeler.refresh()
    timers.runIntervals()
    await settle(timers)

    assert.deepEqual(labelsOf(document), [['backend'], ['frontend'], []])
  })

  test('observes the board page root only, never document.body', async () => {
    const { document, labeler, observed, timers } = setup()

    labeler.start()
    await settle(timers)

    assert.deepEqual(
      observed.map(target => target.id),
      ['page']
    )
    assert.ok(!observed.includes(document.body))
  })

  test('labels the board in the same task as start(), without waiting for a timer', () => {
    const { document, labeler, timers } = setup()

    labeler.start()

    assert.deepEqual(labelsOf(document), [['backend'], ['frontend'], []])
    assert.equal(timers.pending().timeouts, 0)
  })

  test('labels a tile that mounts with no cache event (filter cleared) from the observer alone', async () => {
    const added = { id: 't_cafe0001', tenant: 'mobile', title: 'New card' }
    const { client, document, labeler, timers } = setup()

    client.setQueryData(boardKey(), boardSnapshot([{ ...COLUMNS[0], tasks: [...COLUMNS[0].tasks, added] }, COLUMNS[1]]))
    labeler.start()
    await settle(timers)

    document.querySelector('[data-fixture-column="todo"] .overflow-y-auto').insertAdjacentHTML('beforeend', tileHtml(added))
    // Only let the observer deliver; no delayed pass is run.
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.deepEqual(labelsOf(document), [['backend'], ['frontend'], ['mobile'], []])
  })

  test('keeps watching a board whose cards are all filtered out, and labels the next tile before paint', async () => {
    const { document, labeler, live, logs, timers } = setup()

    labeler.start()
    await settle(timers)

    // Search matches nothing: every tile unmounts, the page root stays.
    const lists = [...document.querySelectorAll('.overflow-y-auto')]
    const kept = lists.map(list => list.innerHTML)

    for (const list of lists) {
      list.replaceChildren()
    }

    for (let tick = 0; tick < 10; tick += 1) {
      timers.runIntervals()
      await settle(timers)
    }

    assert.equal(live.size, 1)
    assert.deepEqual(logs, [])

    // Search cleared: tiles mount again; only the observer may label them.
    lists.forEach((list, index) => list.insertAdjacentHTML('beforeend', kept[index].replace(/<span [^>]*data-kanban-tenant-label[^>]*>[^<]*<\/span>/g, '')))
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.deepEqual(labelsOf(document), [['backend'], ['frontend'], []])
  })

  test('follows a tenant change that only reaches the cache', async () => {
    const { client, document, labeler, timers } = setup()

    labeler.start()
    await settle(timers)

    const moved = COLUMNS.map(column => ({
      ...column,
      tasks: column.tasks.map(task => (task.id === 't_11aa22bb' ? { ...task, tenant: 'docs' } : task))
    }))

    client.setQueryData(boardKey(), boardSnapshot(moved))
    await settle(timers)

    assert.deepEqual(labelsOf(document), [['backend'], ['docs'], []])
  })

  test('re-attaches when the board page re-mounts, with one badge per tile', async () => {
    const { board, document, labeler, observed, timers } = setup()

    labeler.start()
    await settle(timers)

    const holder = document.createElement('div')

    holder.innerHTML = boardDocument(board).document.getElementById('page').outerHTML
    document.getElementById('page').replaceWith(holder.firstElementChild)
    timers.runIntervals()
    await settle(timers)

    assert.deepEqual(labelsOf(document), [['backend'], ['frontend'], []])
    assert.equal(observed.at(-1), document.getElementById('page'))
  })

  test('labels a second board on screen (split tile) as well, including one that appears later', async () => {
    const { board, document, labeler, timers } = setup()
    const splitBoard = () => {
      const page = boardDocument(board).document.getElementById('page')

      page.id = 'split-page'
      document.body.insertAdjacentHTML('beforeend', `<aside class="split-tile">${page.outerHTML}</aside>`)
    }

    splitBoard()
    labeler.start()
    await settle(timers)

    const expected = [['backend'], ['frontend'], []]

    assert.deepEqual(labelsOf(document), [...expected, ...expected])

    splitBoard()
    timers.runIntervals()
    await settle(timers)

    assert.deepEqual(labelsOf(document), [...expected, ...expected, ...expected])
  })

  test('does nothing off the Kanban route and cleans up when the route is left', async () => {
    const { document, labeler, live, timers, win } = setup({ hash: '#/settings' })

    labeler.start()
    await settle(timers)
    assert.equal(badgesIn(document, BADGE_ATTR).length, 0)
    assert.equal(live.size, 0)

    win.location.hash = '#/kanban'
    timers.runIntervals()
    await settle(timers)
    assert.equal(badgesIn(document, BADGE_ATTR).length, 2)
    assert.equal(live.size, 1)

    win.location.hash = '#/'
    timers.runIntervals()
    await settle(timers)
    assert.equal(badgesIn(document, BADGE_ATTR).length, 0)
    assert.equal(live.size, 0)
  })

  test('a board event opens the route gate without waiting for the poll', async () => {
    const { board, client, document, labeler, timers, win } = setup({ hash: '#/settings' })

    labeler.start()
    // The sidebar navigates with history.pushState: no hashchange, no popstate.
    win.location.hash = '#/kanban'
    client.setQueryData(boardKey(), board)

    assert.equal(badgesIn(document, BADGE_ATTR).length, 2)
    await settle(timers)
  })

  test('applies pinned colors', async () => {
    const pins = { frontend: PALETTE[0] }
    const { document, labeler, timers } = setup({ pins })

    labeler.start()
    await settle(timers)

    const frontend = badgesIn(document, BADGE_ATTR).find(badge => badge.textContent === 'frontend')

    assert.equal(frontend.style.getPropertyValue('--kanban-tenant-hue'), PALETTE[0])
  })

  test('teardown removes every badge, the observer, the cache subscription, timers and listeners', async () => {
    const { client, document, labeler, live, timers, win } = setup()

    labeler.start()
    await settle(timers)
    assert.equal(badgesIn(document, BADGE_ATTR).length, 2)

    labeler.dispose()

    assert.equal(badgesIn(document, BADGE_ATTR).length, 0)
    assert.equal(live.size, 0)
    assert.equal(client.listenerCount(), 0)
    assert.deepEqual(timers.pending(), { intervals: 0, listeners: 0, timeouts: 0 })
    assert.equal(win.listenerCount(), 0)

    // The disconnected observer must not bring labels back.
    document
      .querySelector('[data-fixture-column="todo"] .overflow-y-auto')
      .insertAdjacentHTML('beforeend', tileHtml({ id: 't_cafe0002', tenant: 'frontend', title: 'Late card' }))
    client.setQueryData(boardKey(), boardSnapshot(COLUMNS))
    await settle(timers)

    assert.equal(badgesIn(document, BADGE_ATTR).length, 0)
  })

  test('stays a silent no-op (one log line) when the page root markup is missing', async () => {
    const { document, labeler, logs, timers } = setup({ withTitle: false })

    labeler.start()

    for (let tick = 0; tick < 5; tick += 1) {
      timers.runIntervals()
      await settle(timers)
    }

    assert.equal(badgesIn(document, BADGE_ATTR).length, 0)
    assert.equal(logs.length, 1)
    assert.match(logs[0], /page root/)
  })

  test('logs once after eight data-bearing ticks even when board data arrives late', async () => {
    const { board, client, document, labeler, logs, timers } = setup()

    client.clear()

    for (const tile of document.querySelectorAll(TILE_SELECTOR)) {
      tile.removeAttribute('draggable')
    }

    labeler.start()

    for (let tick = 0; tick < 12; tick += 1) {
      timers.runIntervals()
      await settle(timers)
      assert.deepEqual(logs, [])
    }

    client.setQueryData(boardKey(), board)
    await settle(timers)
    assert.deepEqual(logs, [])

    for (let tick = 0; tick < 7; tick += 1) {
      timers.runIntervals()
      await settle(timers)
      assert.deepEqual(logs, [])
    }

    timers.runIntervals()
    await settle(timers)

    assert.equal(logs.length, 1)
    assert.match(logs[0], /No Kanban card tile matched/)
    assert.equal(badgesIn(document, BADGE_ATTR).length, 0)

    for (let tick = 0; tick < 40; tick += 1) {
      timers.runIntervals()
      await settle(timers)
    }

    assert.equal(logs.length, 1)
    labeler.dispose()
  })

  test('logs once when tiles lose the Kanban tone, even if board data lands late', async () => {
    const { board, client, document, labeler, logs, timers } = setup()

    client.clear()

    for (const tile of document.querySelectorAll(TILE_SELECTOR)) {
      tile.removeAttribute('style')
    }

    labeler.start()

    for (let tick = 0; tick < 10; tick += 1) {
      timers.runIntervals()
      await settle(timers)
    }

    assert.deepEqual(logs, [])
    client.setQueryData(boardKey(), board)

    for (let tick = 0; tick < 10; tick += 1) {
      timers.runIntervals()
      await settle(timers)
    }

    assert.equal(badgesIn(document, BADGE_ATTR).length, 0)
    assert.equal(logs.length, 1)
    assert.match(logs[0], /No Kanban card tile matched/)
    labeler.dispose()
  })

  test('logs once when no tile shows a known short id (tile text changed)', async () => {
    const { document, labeler, logs, timers } = setup()

    for (const id of document.querySelectorAll('.font-mono')) {
      id.textContent = `#${id.textContent}`
    }

    labeler.start()
    await settle(timers)

    assert.equal(badgesIn(document, BADGE_ATTR).length, 0)
    assert.equal(logs.length, 1)
    assert.match(logs[0], /could be matched/)

    for (let tick = 0; tick < 10; tick += 1) {
      timers.runIntervals()
      labeler.refresh()
      await settle(timers)
    }

    assert.equal(badgesIn(document, BADGE_ATTR).length, 0)
    assert.equal(logs.length, 1)
    labeler.dispose()
  })

  test('stays a silent no-op (one log line) when tiles exist but the board data is gone', async () => {
    const { client, document, labeler, logs, timers } = setup()

    client.clear()
    labeler.start()

    for (let tick = 0; tick < 5; tick += 1) {
      timers.runIntervals()
      labeler.refresh()
      await settle(timers)
    }

    assert.equal(badgesIn(document, BADGE_ATTR).length, 0)
    assert.equal(logs.length, 1)
    assert.match(logs[0], /no board data/)
  })

  test('logs once and labels nothing when the board data has no tenant field', async () => {
    const columns = COLUMNS.map(column => ({
      ...column,
      tasks: column.tasks.map(({ tenant, ...task }) => ({ ...task, project: tenant }))
    }))
    const { document, labeler, logs, timers } = setup({ columns })

    labeler.start()
    labeler.refresh()
    await settle(timers)

    assert.equal(badgesIn(document, BADGE_ATTR).length, 0)
    assert.deepEqual(logs.length, 1)
    assert.match(logs[0], /no `tenant` field/)
  })
})

describe('labeler exception isolation', () => {
  const assertStopped = ({ client, document, live, logs, timers, win }, message) => {
    assert.deepEqual(logs, [message])
    assert.equal(badgesIn(document, BADGE_ATTR).length, 0)
    assert.equal(live.size, 0)
    assert.equal(client.listenerCount(), 0)
    assert.deepEqual(timers.pending(), { intervals: 0, listeners: 0, timeouts: 0 })
    assert.equal(win.listenerCount(), 0)
  }

  test('a failing cache listener removes existing badges without skipping the board listener', async () => {
    let fail = false
    const fixture = setup({
      onTenants() {
        if (fail) {
          throw new Error('tenant publication failed')
        }
      }
    })
    const { board, client, document, labeler, timers } = fixture

    labeler.start()
    await settle(timers)
    assert.equal(badgesIn(document, BADGE_ATTR).length, 2)

    const events = []
    const unsubscribe = client.getQueryCache().subscribe(event => events.push(event))
    const changed = boardSnapshot([
      { name: 'todo', tasks: [{ ...COLUMNS[0].tasks[0], tenant: 'new-tenant' }] }
    ])

    // Shutdown must cancel an already queued pass as well as future events.
    labeler.refresh()
    assert.equal(timers.pending().timeouts, 1)
    fail = true
    assert.doesNotThrow(() => client.setQueryData(boardKey(), changed))
    assert.equal(events.length, 1)
    assert.equal(events[0].query.state.data, changed)
    unsubscribe()

    const message = 'cache listener failed (tenant publication failed); labels are off.'

    assertStopped(fixture, message)

    // A failed labeler stays off until the plugin is reloaded.
    fail = false
    labeler.start()
    labeler.refresh()
    client.setQueryData(boardKey(), board)
    timers.runIntervals()
    await settle(timers)
    labeler.dispose()
    assertStopped(fixture, message)
  })

  test('a failing pin lookup cannot escape a cache event opening the route gate', async () => {
    const fixture = setup({
      getPins() {
        throw new Error('pins unavailable')
      },
      hash: '#/settings'
    })
    const { board, client, labeler, timers, win } = fixture

    labeler.start()
    win.location.hash = '#/kanban'

    const events = []
    const unsubscribe = client.getQueryCache().subscribe(event => events.push(event))

    assert.doesNotThrow(() => client.setQueryData(boardKey(), board))
    assert.equal(events.length, 1)
    unsubscribe()
    await settle(timers)
    assertStopped(fixture, 'cache listener failed (pins unavailable); labels are off.')
  })

  test('a failing startup cleans up its partially registered callbacks', async () => {
    const fixture = setup({
      getPins() {
        throw new Error('pins unavailable')
      }
    })

    assert.doesNotThrow(() => fixture.labeler.start())
    await settle(fixture.timers)
    assertStopped(fixture, 'startup failed (pins unavailable); labels are off.')
  })

  for (const [entry, warning] of [
    ['observer', 'observer'],
    ['scheduled pass', 'scheduled pass'],
    ['route poll', 'route poll'],
    ['hashchange', 'route change'],
    ['popstate', 'route change']
  ]) {
    test(`a failing pin lookup is isolated in the ${entry} callback`, async () => {
      let fail = false
      const fixture = setup({
        getPins() {
          if (fail) {
            throw new Error('pins unavailable')
          }

          return {}
        }
      })
      const { board, document, labeler, timers, win } = fixture
      const routeCallbacks = new Map()
      const addEventListener = win.addEventListener

      win.addEventListener = (type, listener) => {
        routeCallbacks.set(type, listener)
        addEventListener(type, listener)
      }

      labeler.start()
      await settle(timers)
      assert.equal(badgesIn(document, BADGE_ATTR).length, 2)
      fail = true

      if (entry === 'observer') {
        document.getElementById('page').append(document.createElement('div'))
      } else if (entry === 'scheduled pass') {
        labeler.refresh()
        assert.doesNotThrow(() => timers.flushTimeouts())
      } else {
        // Discovering a second board forces the route check to run a pass
        // while badges still exist on the original board.
        const split = boardDocument(board).document.getElementById('page')

        split.id = 'split-page'
        document.body.insertAdjacentHTML('beforeend', `<aside class="split-tile">${split.outerHTML}</aside>`)

        if (entry === 'route poll') {
          assert.doesNotThrow(() => timers.runIntervals())
        } else {
          assert.doesNotThrow(() => routeCallbacks.get(entry)({ type: entry }))
        }
      }

      await settle(timers)
      assertStopped(fixture, `${warning} failed (pins unavailable); labels are off.`)
    })
  }
})
