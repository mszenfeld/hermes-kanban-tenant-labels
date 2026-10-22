// Node module-resolution hook: the plugin imports the Desktop-provided
// specifiers `@hermes/plugin-sdk`, `react` and `react/jsx-runtime`, which only
// exist inside the app. Tests map them to small local stubs.
const STUBS = {
  '@hermes/plugin-sdk': new URL('./sdk-stub.mjs', import.meta.url).href,
  react: new URL('./react-stub.mjs', import.meta.url).href,
  'react/jsx-runtime': new URL('./react-stub.mjs', import.meta.url).href
}

/** Synchronous form, for `module.registerHooks()` (Node >= 22.15). */
export function resolveSync(specifier, context, nextResolve) {
  if (Object.hasOwn(STUBS, specifier)) {
    return { shortCircuit: true, url: STUBS[specifier] }
  }

  return nextResolve(specifier, context)
}

/** Asynchronous form, for the older `module.register()` loader thread. */
export async function resolve(specifier, context, nextResolve) {
  return resolveSync(specifier, context, nextResolve)
}
