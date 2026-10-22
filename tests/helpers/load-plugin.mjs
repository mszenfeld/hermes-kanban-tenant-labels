// Import `desktop/plugin.js` the way the app would, but with the
// Desktop-provided specifiers resolved to local stubs. The hook must be in
// place before the plugin module is linked, hence the dynamic imports.
import * as nodeModule from 'node:module'

import { resolveSync } from './sdk-loader.mjs'

if (typeof nodeModule.registerHooks === 'function') {
  nodeModule.registerHooks({ resolve: resolveSync })
} else {
  nodeModule.register('./sdk-loader.mjs', import.meta.url)
}

export const plugin = await import('../../desktop/plugin.js')
export const sdk = await import('@hermes/plugin-sdk')
