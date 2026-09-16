import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    './index.ts',
    './fiber/index.ts',
    './thread/index.ts',
    './fabric/index.ts',
    './plugins/index.ts',
  ],
  clean: true,
  dts: true,
  minify: true,
  // Emit `.js` + `.d.ts` (not `.mjs` + `.d.mts`): the `node` platform
  // defaults `fixedExtension` to true, and JSR's fast type check only
  // pairs `.d.ts` declarations with `.js` modules.
  fixedExtension: false,
  // Emit one module per source file so every `.js` has a sibling `.d.ts`
  // and declarations never reference chunked files that don't exist.
  unbundle: true,
  deps: {
    neverBundle: true
  }
})
