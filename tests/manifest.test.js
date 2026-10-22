import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('plugin.yaml and package.json declare the same version', () => {
  const manifest = read('../plugin.yaml').match(/^version:\s*["']?([^"'\s#]+)/m)

  assert.ok(manifest, 'plugin.yaml has no top-level version field')
  assert.equal(manifest[1], JSON.parse(read('../package.json')).version)
})
