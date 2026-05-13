// Block test file writes that don't import their corresponding implementation module

import path from 'node:path'

import { isTestFile, resolveImplPath, testFileImportsImpl } from '../test-resolver.mjs'

/**
 * @typedef {Object} BlockResult
 * @property {'block'} decision
 * @property {string} reason
 */

/**
 * @param {{ tool_input: { file_path?: string, content?: string }, session_id: string, cwd: string }} ctx
 * @returns {BlockResult | null}
 */
export function verifyTestImport(ctx) {
  try {
    const { tool_input, cwd } = ctx
    const filePath = tool_input.file_path
    if (!filePath || !isTestFile(filePath)) return null

    const relPath = path.relative(cwd, path.resolve(cwd, filePath))

    // Only check tests under tests/ directory (convention: tests/foo/bar.test.ts → src/foo/bar.ts)
    if (!relPath.startsWith('tests/') && !relPath.startsWith('tests\\')) return null

    const implRelPath = resolveImplPath(relPath)
    const testAbsPath = path.resolve(cwd, filePath)
    const implAbsPath = path.resolve(cwd, implRelPath)

    // Skip the check when the corresponding implementation file does not exist.
    // This covers tests that cover multiple implementation modules by convention
    // (e.g. tests/tools/work-item-tools.test.ts tests list-work, log-work, etc.).
    if (!fs.existsSync(implAbsPath)) return null

    if (!testFileImportsImpl(testAbsPath, implAbsPath)) {
      const testDir = path.dirname(testAbsPath)
      const expectedImport = path
        .relative(testDir, implAbsPath)
        .replace(/\\/g, '/')
        .replace(/\.(ts|tsx)$/, '.js')
      return {
        decision: 'block',
        reason:
          `Test file \`${relPath}\` does not import its implementation module.\n\n` +
          `Expected import from \`${expectedImport}\`.\n\n` +
          `The test file must import the module it is named after (\`${implRelPath}\`) to enforce TDD coverage.`,
      }
    }
  } catch {
    // Fail open
  }
  return null
}
