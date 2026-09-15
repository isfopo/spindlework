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
  deps: {
    neverBundle: true
  }
})
