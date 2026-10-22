import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { boardDocument, boardKey, boardSnapshot, tileHtml } from './helpers/fixture.mjs'
import { plugin, sdk } from './helpers/load-plugin.mjs'

const {
  BADGE_ATTR,
  TILE_SELECTOR,
  applyBadge,
  buildTaskIndex,
  findBoardRoot,
  isKanbanRoute,
  leafTexts,
  readBoardSnapshots,
  resolveTile
} = plugin

const COLUMNS = [
  {
    name: 'triage',
    tasks: [
      { id: 't_1f2e3d4c', tenant: 'backend', title: 'Fix login timeout' },
      { id: 't_9a1b2c3d', tenant: null, title: 'No tenant here' }
    ]
  },
  {
    name: 'done',
    tasks: [{ id: 't_00ff00aa', summary: 'Shipped', tenant: 'frontend', title: 'Landing page' }]
  }
]

const indexOf = columns => buildTaskIndex([{ data: boardSnapshot(columns), updatedAt: 1 }])

const tilesOf = document => [...document.querySelectorAll(TILE_SELECTOR)]

describe('tile → task mapping', () => {
  test('every tile on the board fixture resolves to its task and tenant', () => {
    const { document } = boardDocument(boardSnapshot(COLUMNS))
    const index = indexOf(COLUMNS)
    const resolved = tilesOf(document).map(tile => {
      const id = resolveTile(tile, index)

      return [id, index.byId.get(id).tenant]
    })

    assert.deepEqual(resolved, [
      ['t_1f2e3d4c', 'backend'],
      ['t_9a1b2c3d', ''],
      ['t_00ff00aa', 'frontend']
    ])
  })

  test('a task without a title is matched by the id the tile shows instead', () => {
    const columns = [{ name: 'todo', tasks: [{ id: 't_abcdef12', tenant: 'mobile', title: '' }] }]
    const { document } = boardDocument(boardSnapshot(columns))

    assert.equal(resolveTile(tilesOf(document)[0], indexOf(columns)), 't_abcdef12')
  })

  test('two tasks sharing the short id are told apart by title', () => {
    const columns = [
      {
        name: 'todo',
        tasks: [
          { id: 't_123456aa', tenant: 'docs', title: 'First' },
          { id: 't_123456bb', tenant: 'frontend', title: 'Second' }
        ]
      }
    ]
    const { document } = boardDocument(boardSnapshot(columns))
    const index = indexOf(columns)

    assert.deepEqual(
      tilesOf(document).map(tile => resolveTile(tile, index)),
      ['t_123456aa', 't_123456bb']
    )
  })

  test('a tile that matches two tasks (same short id and title) is left unresolved', () => {
    const columns = [
      {
        name: 'todo',
        tasks: [
          { id: 't_123456aa', tenant: 'docs', title: 'Same' },
          { id: 't_123456bb', tenant: 'frontend', title: 'Same' }
        ]
      }
    ]
    const { document } = boardDocument(boardSnapshot(columns))

    assert.equal(resolveTile(tilesOf(document)[0], indexOf(columns)), null)
  })

  test('a tile whose task is not in the board data is left unresolved', () => {
    const { document } = boardDocument(boardSnapshot(COLUMNS))

    assert.equal(resolveTile(tilesOf(document)[0], indexOf([{ name: 'todo', tasks: [] }])), null)
  })

  test("the plugin's own badge text never takes part in matching", () => {
    // A tenant named like a short id must not make a tile match another task.
    const columns = [{ name: 'todo', tasks: [{ id: 't_aaaaaa11', tenant: 'bbbbbb', title: 'Card' }] }]
    const { document } = boardDocument(boardSnapshot(columns))
    const [tile] = tilesOf(document)

    applyBadge(tile, { colour: plugin.PALETTE[0], tenant: 'bbbbbb' })

    assert.equal(leafTexts(tile).has('bbbbbb'), false)
    assert.equal(tile.querySelectorAll(`[${BADGE_ATTR}]`).length, 1)
  })
})

describe('board root', () => {
  test('is the page root holding the <h1> header, not a column (whose header has no <h1>)', () => {
    const { document } = boardDocument(boardSnapshot(COLUMNS))

    assert.equal(findBoardRoot(tilesOf(document)[0]).id, 'page')
  })

  test('is not found when the page title markup is missing', () => {
    const { document } = boardDocument(boardSnapshot(COLUMNS), { withTitle: false })

    assert.equal(findBoardRoot(tilesOf(document)[0]), null)
  })

  test('tile selector ignores draggable elements without the Kanban tone', () => {
    const { document } = boardDocument(boardSnapshot(COLUMNS))
    const other = document.createElement('div')

    other.setAttribute('draggable', 'true')
    other.innerHTML = tileHtml({ id: 't_ffffff00', title: 'x' }).replace(/style="[^"]*"/, '')
    document.body.append(other)

    assert.equal(tilesOf(document).length, 3)
  })
})

describe('route gate', () => {
  test('matches the Kanban route only', () => {
    for (const hash of ['#/kanban', '#/kanban?task=t_1', '#/kanban/', '/kanban']) {
      assert.equal(isKanbanRoute(hash), true, hash)
    }

    for (const hash of ['', '#/', '#/kanbanx', '#/settings?tab=kanban', '#/s/kanban', undefined]) {
      assert.equal(isKanbanRoute(hash), false, String(hash))
    }
  })
})

describe('board data from the query cache', () => {
  test('reads only Kanban board snapshots', () => {
    const client = sdk.createFakeQueryClient()

    client.setQueryData(boardKey(), boardSnapshot(COLUMNS))
    client.setQueryData(['kanban', 'boards', 'local'], { boards: [], columns: [] })
    client.setQueryData(['kanban', 'task', 'local', '', 't_1f2e3d4c'], { columns: [] })
    client.setQueryData(['kanban', 'board', 'local', 'other', false], { error: 'not a board' })

    const snapshots = readBoardSnapshots(client)

    assert.equal(snapshots.length, 1)
    assert.equal(snapshots[0].data.columns.length, 2)
  })

  test('within one board, a task takes its tenant from the newest snapshot', () => {
    const client = sdk.createFakeQueryClient()
    const archived = [{ name: 'archived', tasks: [{ id: 't_1f2e3d4c', tenant: 'old-tenant', title: 'T' }] }]
    const current = [{ name: 'todo', tasks: [{ id: 't_1f2e3d4c', tenant: 'new-tenant', title: 'T' }] }]

    client.setQueryData(boardKey('', true), boardSnapshot(archived))
    client.setQueryData(boardKey('', false), boardSnapshot(current))

    const index = buildTaskIndex(readBoardSnapshots(client))

    assert.equal(index.byId.get('t_1f2e3d4c').tenant, 'new-tenant')
    assert.deepEqual(index.tenants, ['new-tenant', 'old-tenant'])
  })

  // An imported copy of a board keeps the original task ids.
  const copies = () => {
    const client = sdk.createFakeQueryClient()
    const original = [{ name: 'todo', tasks: [{ id: 't_123456aa', tenant: 'local-tenant', title: 'Shared task' }] }]
    const copy = [{ name: 'todo', tasks: [{ id: 't_123456aa', tenant: 'copy-tenant', title: 'Shared task' }] }]

    return { client, copy: boardSnapshot(copy), original: boardSnapshot(original) }
  }

  test('the board on screen wins over a newer cached board that shares task ids', () => {
    const { client, copy, original } = copies()

    client.setQueryData(boardKey('', false), original, { observers: 2 })
    client.setQueryData(boardKey('imported-copy', false), copy, { observers: 0 })

    const index = buildTaskIndex(readBoardSnapshots(client))

    assert.equal(index.byId.get('t_123456aa').tenant, 'local-tenant')
    assert.deepEqual(index.tenants, ['local-tenant'])
  })

  test('without observer information, a task whose tenant differs between boards gets no tenant', () => {
    const { client, copy, original } = copies()

    client.setQueryData(boardKey('', false), original)
    client.setQueryData(boardKey('imported-copy', false), copy)

    assert.equal(buildTaskIndex(readBoardSnapshots(client)).byId.get('t_123456aa').tenant, '')
  })

  test('a task with the same tenant on two boards keeps it', () => {
    const { client, original } = copies()

    client.setQueryData(boardKey('', false), original)
    client.setQueryData(['kanban', 'board', 'remote', '', false], original)

    assert.equal(buildTaskIndex(readBoardSnapshots(client)).byId.get('t_123456aa').tenant, 'local-tenant')
  })

  test('reports whether the board data carries a tenant field at all', () => {
    const withField = buildTaskIndex([{ data: boardSnapshot(COLUMNS), updatedAt: 1 }])
    const renamed = buildTaskIndex([
      { data: { columns: [{ name: 'todo', tasks: [{ id: 't_1f2e3d4c', project: 'x', title: 'T' }] }] }, updatedAt: 1 }
    ])

    assert.equal(withField.hasTenantField, true)
    assert.equal(renamed.hasTenantField, false)
  })

  test('a client without a query cache yields no data instead of throwing', () => {
    assert.deepEqual(readBoardSnapshots(undefined), [])
    assert.deepEqual(readBoardSnapshots({}), [])
  })
})
