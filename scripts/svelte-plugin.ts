// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { BunPlugin } from 'bun'
import type { Processed } from 'svelte/compiler'
import { compile, compileModule, preprocess } from 'svelte/compiler'

export interface SveltePluginOptions {
  collectCss?: (filename: string, css: string) => void
  dev?: boolean
}

function stripTs(source: string, filename: string): string {
  const transpiler = new Bun.Transpiler({
    loader: 'ts',
    target: 'browser',
    tsconfig: { compilerOptions: {} },
  })
  return transpiler.transformSync(source, { name: filename })
}

interface PreprocessorScriptArgs {
  content: string
  attributes: Record<string, string | boolean>
  filename?: string
}

const tsScriptPreprocessor = {
  script(args: PreprocessorScriptArgs): Processed | undefined {
    const lang = args.attributes['lang']
    if (lang !== 'ts' && lang !== 'typescript') return undefined
    return { code: stripTs(args.content, args.filename ?? 'component.svelte') }
  },
}

const SVELTE_FILE = /\.svelte$/u
const SVELTE_MODULE_FILE = /\.svelte\.(?:ts|js)$/u

export function sveltePlugin(options: SveltePluginOptions = {}): BunPlugin {
  const { collectCss, dev = false } = options

  return {
    name: 'svelte-loader',
    setup(build): void {
      build.onLoad({ filter: SVELTE_FILE }, async (args) => {
        const rawSource = await Bun.file(args.path).text()
        const processed = await preprocess(rawSource, tsScriptPreprocessor, {
          filename: args.path,
        })
        const result = compile(processed.code, {
          filename: args.path,
          generate: 'client',
          dev,
          css: 'external',
        })

        if (result.css !== null && collectCss !== undefined) {
          collectCss(args.path, result.css.code)
        }

        return { contents: result.js.code, loader: 'js' }
      })

      build.onLoad({ filter: SVELTE_MODULE_FILE }, async (args) => {
        const rawSource = await Bun.file(args.path).text()
        const source = args.path.endsWith('.ts') ? stripTs(rawSource, args.path) : rawSource
        const result = compileModule(source, {
          filename: args.path,
          generate: 'client',
          dev,
        })

        return { contents: result.js.code, loader: 'js' }
      })
    },
  }
}
