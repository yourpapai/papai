<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# LLM Guidance for Large Codebases: Research Report

**Date:** 2026-03-29
**Context:** papai is ~40k TypeScript LOC (~50k with blanks). LLM drift to generic patterns (inline fetch mocks, reinventing helpers) is a recurring problem during AI-assisted development.

## Problem

At 40k+ LOC, the model can't see the whole codebase. It defaults to generic patterns (inline fetch mocks, reinventing helpers) because it doesn't know project-specific conventions exist. The current `CLAUDE.md` and `copilot-instructions.md` already cover some of this, but they're monolithic and not triggered contextually — they either bloat the context window or aren't present when needed.

## Two Complementary Strategies

### 1. Path-scoped instruction files (context-efficient, LLM-side)

Instead of one giant `CLAUDE.md` / `copilot-instructions.md`, use **path-specific `.instructions.md` files** that are auto-attached only when the model touches relevant files. This keeps the context window lean.

GitHub Copilot supports `.github/instructions/*.instructions.md` with YAML frontmatter `applyTo` globs. Claude Code supports `CLAUDE.md` files in subdirectories (they cascade). Both approaches give the same result: **conventions loaded only when relevant**.

**Example structure:**

```
.github/instructions/
  testing.instructions.md        # applyTo: "tests/**"
  providers.instructions.md      # applyTo: "src/providers/**"
  tools.instructions.md          # applyTo: "src/tools/**"
```

**Example** `.github/instructions/testing.instructions.md`:

```markdown
---
applyTo: 'tests/**'
---

# Testing Conventions

## Mocking

- Use `mockLogger()`, `mockDrizzle()`, `setupTestDb()` from `tests/utils/test-helpers.ts`
- Use `createMockProvider()` from `tests/tools/mock-provider.ts` for TaskProvider mocks
- Use `createMockTask()`, `createMockProject()`, `createMockLabel()` from `tests/test-helpers.ts`
- NEVER mock `globalThis.fetch` directly — use the helpers above
- NEVER use `spyOn().mockImplementation()` for module mocks — use mutable `let impl` pattern

## Mock pollution

- `mock.module()` is global and permanent — add `afterAll(() => { mock.restore() })` if mocking shared modules
- Mock the narrowest dependency (prefer mocking `db/drizzle.js` over `config.js`)
- Register mocks BEFORE importing code under test

## Schema validation

- Use `schemaValidates()` from `tests/test-helpers.ts` to test tool input schemas
- Use `getToolExecutor()` / `hasExecute()` to extract tool execute functions
```

**Example** `.github/instructions/providers.instructions.md`:

```markdown
---
applyTo: 'src/providers/**'
---

# Provider Conventions

- All providers implement `TaskProvider` from `src/providers/types.ts`
- Use Zod v4 schemas in `schemas/` subdirectory for all API request/response validation
- Classify HTTP errors via `classify-error.ts`
- Every function entry must have `logger.debug()` with all input parameters
- All operations return normalized domain types (`Task`, `Project`, `Comment`, `Label`, `Status`)
```

This is **zero-cost to context when not triggered** and precisely targeted when it is.

### 2. Static analysis enforcement (oxlint-side, catches drift at lint time)

This is the "hard guardrail" — violations fail the build regardless of who wrote the code (human or LLM).

#### a) `no-restricted-imports` rule (already supported in oxlint natively)

Ban specific import patterns in test files. Add to `.oxlintrc.json`:

```jsonc
{
  "overrides": [
    {
      "files": ["tests/**/*.ts"],
      "rules": {
        "no-restricted-imports": [
          "error",
          {
            "paths": [
              {
                "name": "undici",
                "message": "Use restoreFetch() from tests/test-helpers.ts instead of mocking fetch directly.",
              },
            ],
          },
        ],
      },
    },
  ],
}
```

#### b) Custom oxlint JS plugin (new alpha feature — March 2026)

Oxlint now supports JS plugins with an ESLint-compatible API. A **project-specific plugin** can enforce conventions statically:

```js
// lint-plugins/papai-conventions.js
import { definePlugin, defineRule } from '@oxlint/plugins'

const noInlineFetchMock = defineRule({
  meta: { messages: { found: "Don't mock fetch inline. Use restoreFetch() from tests/test-helpers.ts" } },
  create(context) {
    return {
      AssignmentExpression(node) {
        // Detect: globalThis.fetch = ... or global.fetch = ...
        if (
          node.left.type === 'MemberExpression' &&
          node.left.property.name === 'fetch' &&
          ['globalThis', 'global'].includes(node.left.object.name)
        ) {
          // Allow if in test-helpers.ts itself
          if (!context.filename.includes('test-helpers')) {
            context.report({ node, messageId: 'found' })
          }
        }
      },
    }
  },
})

export default definePlugin({
  meta: { name: 'papai-conventions' },
  rules: { 'no-inline-fetch-mock': noInlineFetchMock },
})
```

Then in `.oxlintrc.json`:

```jsonc
{
  "jsPlugins": ["./lint-plugins/papai-conventions.js"],
  "overrides": [
    {
      "files": ["tests/**/*.ts"],
      "rules": {
        "papai-conventions/no-inline-fetch-mock": "error",
      },
    },
  ],
}
```

#### c) `no-restricted-syntax` via `oxlint-plugin-eslint`

For AST-level bans without writing a full plugin, use the `oxlint-plugin-eslint` JS plugin to get `no-restricted-syntax`:

```jsonc
{
  "jsPlugins": ["oxlint-plugin-eslint"],
  "overrides": [
    {
      "files": ["tests/**/*.ts"],
      "rules": {
        "eslint-js/no-restricted-syntax": [
          "error",
          {
            "selector": "CallExpression[callee.object.name='mock'][callee.property.name='module'] > Literal[value=/config\\.js/]",
            "message": "Don't mock config.js directly. Mock db/drizzle.js or use setupTestDb() instead.",
          },
        ],
      },
    },
  ],
}
```

## Recommended Approach (ordered by impact/effort)

| Priority | What                                                     | Context cost              | Enforcement         | Effort     |
| -------- | -------------------------------------------------------- | ------------------------- | ------------------- | ---------- |
| **1**    | Path-scoped `.instructions.md` files                     | Minimal (loaded per-glob) | Soft (LLM guidance) | ~30 min    |
| **2**    | `no-restricted-imports` in oxlint overrides              | Zero                      | Hard (lint error)   | ~5 min     |
| **3**    | Custom oxlint JS plugin for project patterns             | Zero                      | Hard (lint error)   | ~1-2 hours |
| **4**    | Split `CLAUDE.md` testing section into `tests/CLAUDE.md` | Minimal                   | Soft (LLM guidance) | ~15 min    |

**Priority 1** is the highest ROI — immediately stops the most common drift patterns across all LLM tools. **Priority 2** is a one-line config change that catches the fetch mock pattern at lint time. **Priority 3** is for when enough patterns accumulate to justify a custom plugin. **Priority 4** leverages Claude Code's subdirectory `CLAUDE.md` cascade.

The key insight: **instructions guide the LLM, lint rules catch what slips through**. Neither alone is sufficient at 40k+ LOC.

## Sources

- [Addy Osmani — My LLM coding workflow going into 2026](https://addyosmani.com/blog/ai-coding-workflow/) — context packing, rules files, Claude Skills
- [Oxlint JS Plugins Alpha (March 2026)](https://oxc.rs/blog/2026-03-11-oxlint-js-plugins-alpha.html) — custom JS plugins with ESLint-compatible API
- [GitHub Copilot `.instructions.md` support](https://github.blog/changelog/2025-07-23-github-copilot-coding-agent-now-supports-instructions-md-custom-instructions) — path-scoped instruction files
- [AGENTS.md guide](https://vibecoding.app/blog/agents-md-guide) — cross-tool instruction file standard
- [Cursor Rules architecture](https://blog.promptxl.com/cursor-ai-rule-architecture-2026/) — scalable rule systems
- [Agent Patterns — instruction file ecosystem](https://agentpatterns.ai/instructions/instruction-file-ecosystem/) — CLAUDE.md, copilot-instructions, AGENTS.md comparison
- [oxlint `no-restricted-imports`](https://oxc-project.github.io/docs/guide/usage/linter/rules/eslint/no-restricted-imports.html) — native oxlint rule for banning imports
