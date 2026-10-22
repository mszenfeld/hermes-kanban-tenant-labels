import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { plugin } from './helpers/load-plugin.mjs'

const { PALETTE, assignColours, hashTenant, pinOf, preferredColour, sanitisePins } = plugin

// Two pairs share a preferred hue: api/design and backend/ops.
const SAMPLE_TENANTS = ['api', 'backend', 'billing', 'design', 'docs', 'frontend', 'mobile', 'ops']

describe('palette', () => {
  test('has twelve distinct hues', () => {
    assert.equal(PALETTE.length, 12)
    assert.equal(new Set(PALETTE).size, 12)
  })
})

describe('hashTenant', () => {
  // Published FNV-1a 32-bit vectors: changing the hash would silently recolor
  // every tenant for every user.
  test('is 32-bit FNV-1a', () => {
    assert.equal(hashTenant(''), 0x811c9dc5)
    assert.equal(hashTenant('a'), 0xe40c292c)
    assert.equal(hashTenant('foobar'), 0xbf9cf968)
  })

  test('the preferred color depends only on the trimmed name', () => {
    assert.equal(preferredColour('frontend'), preferredColour('  frontend '))
    assert.ok(PALETTE.includes(preferredColour('frontend')))
  })
})

describe('assignColours', () => {
  test('gives 8 tenants 8 distinct palette colors, even when preferred hues collide', () => {
    assert.ok(new Set(SAMPLE_TENANTS.map(preferredColour)).size < SAMPLE_TENANTS.length)

    const colours = assignColours(SAMPLE_TENANTS)

    assert.equal(colours.size, 8)
    assert.equal(new Set(colours.values()).size, 8)

    for (const colour of colours.values()) {
      assert.ok(PALETTE.includes(colour), `${colour} is not a palette color`)
    }
  })

  test('is stable: input order, duplicates and whitespace do not matter', () => {
    const reference = assignColours(SAMPLE_TENANTS)
    const shuffled = assignColours([...SAMPLE_TENANTS].reverse().flatMap(name => [` ${name} `, name, '', null]))

    assert.deepEqual([...shuffled.entries()].sort(), [...reference.entries()].sort())
  })

  test('on a hue collision the later name takes the next free hue', () => {
    assert.equal(preferredColour('backend'), preferredColour('ops'))

    const colours = assignColours(['ops', 'backend'])
    const preferred = PALETTE.indexOf(preferredColour('backend'))

    assert.equal(colours.get('backend'), PALETTE[preferred])
    assert.equal(colours.get('ops'), PALETTE[(preferred + 1) % PALETTE.length])
  })

  test('adding a tenant that sorts last does not move existing colors', () => {
    const before = assignColours(SAMPLE_TENANTS)
    const after = assignColours([...SAMPLE_TENANTS, 'zzz-new-tenant'])

    for (const name of SAMPLE_TENANTS) {
      assert.equal(after.get(name), before.get(name), name)
    }
  })

  test('a pinned color wins and is reserved for its tenant', () => {
    const taken = preferredColour('frontend')
    const colours = assignColours(['frontend', 'docs'], { docs: taken })

    assert.equal(colours.get('docs'), taken)
    assert.notEqual(colours.get('frontend'), taken)
    assert.ok(PALETTE.includes(colours.get('frontend')))
  })

  test('pins of tenants not on the board still reserve their color', () => {
    const taken = preferredColour('frontend')
    const colours = assignColours(['frontend'], { 'not-on-board': taken })

    assert.deepEqual([...colours.keys()], ['frontend'])
    assert.notEqual(colours.get('frontend'), taken)
  })

  test('with more tenants than hues, the first twelve use every hue and the rest share', () => {
    const names = Array.from({ length: 15 }, (_, index) => `tenant-${String(index).padStart(2, '0')}`)
    const colours = assignColours(names)

    assert.equal(colours.size, 15)
    assert.equal(new Set(names.slice(0, 12).map(name => colours.get(name))).size, 12)

    for (const name of names.slice(12)) {
      assert.equal(colours.get(name), preferredColour(name))
    }
  })

  test('an overflow tenant never takes a pinned color while an unpinned hue exists', () => {
    const names = Array.from({ length: 15 }, (_, index) => `tenant-${String(index).padStart(2, '0')}`)

    for (const colour of PALETTE) {
      const colours = assignColours(names, { 'tenant-00': colour })
      const holders = names.filter(name => colours.get(name) === colour)

      assert.deepEqual(holders, ['tenant-00'], colour)
    }
  })

  test('tenants named like Object.prototype members get ordinary palette colors', () => {
    const names = ['__proto__', 'constructor', 'hasOwnProperty', 'toString', 'valueOf']
    const colours = assignColours(names)

    assert.equal(colours.size, names.length)
    assert.equal(new Set(colours.values()).size, names.length)

    for (const name of names) {
      assert.ok(PALETTE.includes(colours.get(name)), name)
    }
  })

  test('a pin for a tenant named __proto__ is honored', () => {
    const pins = sanitisePins(JSON.parse(`{"__proto__": "${PALETTE[4]}"}`))

    assert.equal(pinOf(pins, '__proto__'), PALETTE[4])
    assert.equal(assignColours(['__proto__'], pins).get('__proto__'), PALETTE[4])
  })
})

describe('sanitisePins', () => {
  test('keeps only palette colors for non-empty tenant names', () => {
    assert.deepEqual(
      Object.entries(
        sanitisePins({ ' a ': PALETTE[1], b: '#ff0000', c: 'red; background: url(x)', '': PALETTE[2], d: PALETTE[3] })
      ),
      [
        ['a', PALETTE[1]],
        ['d', PALETTE[3]]
      ]
    )
  })

  test('ignores anything that is not a plain object', () => {
    for (const value of [null, undefined, 'x', 42, [PALETTE[0]]]) {
      assert.deepEqual(Object.keys(sanitisePins(value)), [])
    }
  })

  test('reports no pin for inherited member names', () => {
    const pins = sanitisePins({})

    for (const name of ['constructor', 'toString', '__proto__']) {
      assert.equal(pinOf(pins, name), undefined, name)
    }
  })
})
