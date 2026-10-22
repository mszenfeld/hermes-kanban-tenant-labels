// Stand-in for `react` / `react/jsx-runtime`: elements become plain objects so
// tests can inspect what a render function returns without a React renderer.
export function jsx(type, props, key) {
  return { key: key ?? null, props: props ?? {}, type }
}

export const jsxs = jsx

export const Fragment = Symbol.for('react.fragment')

export default { Fragment, jsx, jsxs }
