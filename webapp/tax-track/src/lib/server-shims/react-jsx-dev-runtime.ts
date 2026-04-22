import {
  Fragment,
  jsx as runtimeJsx,
  jsxs as runtimeJsxs,
} from 'react/jsx-runtime'

type JsxFactory = typeof runtimeJsx

export { Fragment }

export const jsxDEV: JsxFactory = (
  type,
  props,
  key,
) => runtimeJsx(type, props, key)

export const jsx = runtimeJsx
export const jsxs = runtimeJsxs
