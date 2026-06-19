import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { enforceWritePolicy } from '../../../tdd/checks/enforce-write-policy.mjs'

const eslintDirective = ['eslint', 'disable'].join('-')
const oxlintDirective = ['oxlint', 'disable'].join('-')
const tsIgnoreDirective = ['@ts', 'ignore'].join('-')
const tsExpectErrorDirective = ['@ts', 'expect', 'error'].join('-')

const lineComment = (directive: string, suffix = ''): string => `// ${directive}${suffix}`
const blockComment = (directive: string, suffix = ''): string => `/* ${directive}${suffix} */`

describe('enforceWritePolicy', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enforce-write-policy-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const createCtx = (
    overrides: Partial<{
      tool_name: string
      tool_input: Record<string, unknown>
    }> = {},
  ) => ({
    tool_name: 'write',
    tool_input: {
      file_path: 'src/example.ts',
      content: 'export const answer = 42\n',
      ...overrides.tool_input,
    },
    cwd: tempDir,
    ...('tool_name' in overrides ? { tool_name: overrides.tool_name } : {}),
  })

  test('blocks edits to the protected lint config', () => {
    const result = enforceWritePolicy(
      createCtx({
        tool_input: {
          file_path: './.oxlintrc.json',
          content: '{}\n',
        },
      }),
    )

    expect(result?.decision).toBe('block')
    expect(result?.reason).toContain('.oxlintrc.json')
  })

  test('blocks write content that adds an inline suppression comment', () => {
    const result = enforceWritePolicy(
      createCtx({
        tool_input: {
          file_path: 'src/example.ts',
          content: `${lineComment(eslintDirective, '-next-line no-console')}\nconsole.log(answer)\n`,
        },
      }),
    )

    expect(result?.decision).toBe('block')
    expect(result?.reason).toContain(eslintDirective)
  })

  test('infers write payloads when tool_name is omitted', () => {
    const result = enforceWritePolicy({
      cwd: tempDir,
      tool_input: {
        file_path: 'src/example.ts',
        content: `${lineComment(eslintDirective, '-next-line no-console')}\nconsole.log(answer)\n`,
      },
    })

    expect(result?.decision).toBe('block')
    expect(result?.reason).toContain(eslintDirective)
  })

  test('blocks edit payloads that add a type suppression comment', () => {
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'src', 'example.ts'), 'callThing()\n')

    const result = enforceWritePolicy(
      createCtx({
        tool_name: 'edit',
        tool_input: {
          file_path: 'src/example.ts',
          oldString: 'callThing()',
          newString: `${lineComment(tsIgnoreDirective)}\ncallThing()`,
        },
      }),
    )

    expect(result?.decision).toBe('block')
    expect(result?.reason).toContain(tsIgnoreDirective)
  })

  test('blocks edit payloads that add a @ts-expect-error suppression comment', () => {
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'src', 'example.ts'), 'callThing()\n')

    const result = enforceWritePolicy(
      createCtx({
        tool_name: 'edit',
        tool_input: {
          file_path: 'src/example.ts',
          oldString: 'callThing()',
          newString: `${lineComment(tsExpectErrorDirective)}\ncallThing()`,
        },
      }),
    )

    expect(result?.decision).toBe('block')
    expect(result?.reason).toContain(tsExpectErrorDirective)
  })

  test('supports snake_case edit fields from Claude-style payloads', () => {
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'src', 'example.ts'), 'callThing()\n')

    const result = enforceWritePolicy({
      cwd: tempDir,
      tool_input: {
        file_path: 'src/example.ts',
        old_string: 'callThing()',
        new_string: `${lineComment(tsIgnoreDirective)}\ncallThing()`,
      },
    })

    expect(result?.decision).toBe('block')
    expect(result?.reason).toContain(tsIgnoreDirective)
  })

  test('blocks multiedit payloads that add an inline suppression comment', () => {
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'src', 'example.ts'), 'console.log(value)\n')

    const result = enforceWritePolicy(
      createCtx({
        tool_name: 'multiedit',
        tool_input: {
          file_path: 'src/example.ts',
          edits: [
            {
              oldString: 'console.log(value)',
              newString: `${blockComment(oxlintDirective, ' no-console')}\nconsole.log(value)`,
            },
          ],
        },
      }),
    )

    expect(result?.decision).toBe('block')
    expect(result?.reason).toContain(oxlintDirective)
  })

  test('allows edits that remove an existing suppression comment', () => {
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'src', 'example.ts'), `${lineComment(tsIgnoreDirective)}\ncallThing()\n`)

    const result = enforceWritePolicy(
      createCtx({
        tool_name: 'edit',
        tool_input: {
          file_path: 'src/example.ts',
          oldString: `${lineComment(tsIgnoreDirective)}\ncallThing()`,
          newString: 'callThing()',
        },
      }),
    )

    expect(result).toBeNull()
  })

  test('ignores matching text inside string literals', () => {
    const result = enforceWritePolicy(
      createCtx({
        tool_input: {
          file_path: 'src/example.ts',
          content: `const label = '${eslintDirective}'\n`,
        },
      }),
    )

    expect(result).toBeNull()
  })

  test('skips non-code files even if they mention a directive name', () => {
    const result = enforceWritePolicy(
      createCtx({
        tool_input: {
          file_path: 'docs/example.md',
          content: `${eslintDirective}\n`,
        },
      }),
    )

    expect(result).toBeNull()
  })

  test('falls back to scanning the payload when the edit cannot be reconstructed', () => {
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'src', 'example.ts'), 'callThing()\n')

    const result = enforceWritePolicy(
      createCtx({
        tool_name: 'edit',
        tool_input: {
          file_path: 'src/example.ts',
          oldString: 'missingCall()',
          newString: `${lineComment(tsIgnoreDirective)}\ncallThing()`,
        },
      }),
    )

    expect(result?.decision).toBe('block')
    expect(result?.reason).toContain(tsIgnoreDirective)
  })
})
