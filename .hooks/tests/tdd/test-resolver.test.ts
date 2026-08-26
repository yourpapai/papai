import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  isTestFile,
  isGateableImplFile,
  suggestTestPath,
  findTestFile,
  resolveImplPath,
} from '../../tdd/test-resolver.mjs'

describe('test-resolver', () => {
  describe('isTestFile', () => {
    test('returns true for .test.ts', () => {
      expect(isTestFile('src/config.test.ts')).toBe(true)
    })

    test('returns true for .test.js', () => {
      expect(isTestFile('lib/utils.test.js')).toBe(true)
    })

    test('returns true for .spec.ts', () => {
      expect(isTestFile('tests/foo.spec.ts')).toBe(true)
    })

    test('returns true for .spec.tsx', () => {
      expect(isTestFile('components/Button.spec.tsx')).toBe(true)
    })

    test('returns true for .test.jsx', () => {
      expect(isTestFile('components/Card.test.jsx')).toBe(true)
    })

    test('returns false for .ts', () => {
      expect(isTestFile('src/config.ts')).toBe(false)
    })

    test('returns false for .js', () => {
      expect(isTestFile('src/utils.js')).toBe(false)
    })

    test('returns false for plain filenames', () => {
      expect(isTestFile('Makefile')).toBe(false)
    })

    test('returns false for .md files', () => {
      expect(isTestFile('README.md')).toBe(false)
    })
  })

  describe('isGateableImplFile', () => {
    const projectRoot = '/project'

    test('returns true for src/config.ts', () => {
      expect(isGateableImplFile('src/config.ts', projectRoot)).toBe(true)
    })

    test('returns true for src/providers/kaneo/client.ts', () => {
      expect(isGateableImplFile('src/providers/kaneo/client.ts', projectRoot)).toBe(true)
    })

    test('returns false for test files outside src', () => {
      expect(isGateableImplFile('tests/config.test.ts', projectRoot)).toBe(false)
    })

    test('returns false for non-src paths', () => {
      expect(isGateableImplFile('docs/readme.md', projectRoot)).toBe(false)
    })

    test('returns false for test files in src', () => {
      expect(isGateableImplFile('src/foo.test.ts', projectRoot)).toBe(false)
    })

    test('returns false for non-code files in src', () => {
      expect(isGateableImplFile('src/data.json', projectRoot)).toBe(false)
    })

    test('returns false for CSS files in src', () => {
      expect(isGateableImplFile('src/style.css', projectRoot)).toBe(false)
    })

    test('returns true for client/debug/helpers.ts', () => {
      expect(isGateableImplFile('client/debug/helpers.ts', projectRoot)).toBe(true)
    })

    test('returns false for client test files', () => {
      expect(isGateableImplFile('client/debug/helpers.test.ts', projectRoot)).toBe(false)
    })

    test('returns false for scripts/foo.ts (scripts/ is not a gateable source root)', () => {
      expect(isGateableImplFile('scripts/foo.ts', projectRoot)).toBe(false)
    })

    test('returns true for review-loop/src/cli.ts', () => {
      expect(isGateableImplFile('review-loop/src/cli.ts', projectRoot)).toBe(true)
    })

    test('returns false for review-loop/src/cli.test.ts', () => {
      expect(isGateableImplFile('review-loop/src/cli.test.ts', projectRoot)).toBe(false)
    })

    test('returns true for afk-runner/src/kernel/machine.ts', () => {
      expect(isGateableImplFile('afk-runner/src/kernel/machine.ts', projectRoot)).toBe(true)
    })

    test('returns false for afk-runner/src/kernel/machine.test.ts', () => {
      expect(isGateableImplFile('afk-runner/src/kernel/machine.test.ts', projectRoot)).toBe(false)
    })

    test('returns false for afk-runner/config.json (non-code)', () => {
      expect(isGateableImplFile('afk-runner/config.json', projectRoot)).toBe(false)
    })
  })

  describe('suggestTestPath', () => {
    test('src/config.ts -> tests/config.test.ts', () => {
      expect(suggestTestPath('src/config.ts')).toBe('tests/config.test.ts')
    })

    test('src/providers/kaneo/client.ts -> tests/providers/kaneo/client.test.ts', () => {
      expect(suggestTestPath('src/providers/kaneo/client.ts')).toBe('tests/providers/kaneo/client.test.ts')
    })

    test('src/utils/format.tsx -> tests/utils/format.test.tsx', () => {
      expect(suggestTestPath('src/utils/format.tsx')).toBe('tests/utils/format.test.tsx')
    })

    test('client/debug/helpers.ts -> tests/client/debug/helpers.test.ts', () => {
      expect(suggestTestPath('client/debug/helpers.ts')).toBe('tests/client/debug/helpers.test.ts')
    })

    test('client/index.ts -> tests/client/index.test.ts (flat)', () => {
      expect(suggestTestPath('client/index.ts')).toBe('tests/client/index.test.ts')
    })

    test('review-loop/src/cli.ts -> tests/review-loop/cli.test.ts', () => {
      expect(suggestTestPath('review-loop/src/cli.ts')).toBe('tests/review-loop/cli.test.ts')
    })

    test('afk-runner/src/legacy-fold.ts -> tests/afk-runner/legacy-fold.test.ts', () => {
      expect(suggestTestPath('afk-runner/src/legacy-fold.ts')).toBe('tests/afk-runner/legacy-fold.test.ts')
    })

    test('afk-runner/src/kernel/machine.ts -> tests/afk-runner/kernel/machine.test.ts (nested)', () => {
      expect(suggestTestPath('afk-runner/src/kernel/machine.ts')).toBe(
        path.join('tests', 'afk-runner', 'kernel', 'machine.test.ts'),
      )
    })
  })

  describe('findTestFile', () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-resolver-'))
    })

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    test('finds test file in parallel tests/ directory', () => {
      const testsDir = path.join(tmpDir, 'tests')
      fs.mkdirSync(testsDir, { recursive: true })
      const testFile = path.join(testsDir, 'foo.test.ts')
      fs.writeFileSync(testFile, '')

      const implFile = path.join(tmpDir, 'src', 'foo.ts')
      const result = findTestFile(implFile, tmpDir)

      expect(result).toBe(testFile)
    })

    test('finds .spec.ts test file in nested directory', () => {
      const testsDir = path.join(tmpDir, 'tests', 'deep')
      fs.mkdirSync(testsDir, { recursive: true })
      const testFile = path.join(testsDir, 'bar.spec.ts')
      fs.writeFileSync(testFile, '')

      const implFile = path.join(tmpDir, 'src', 'deep', 'bar.ts')
      const result = findTestFile(implFile, tmpDir)

      expect(result).toBe(testFile)
    })

    test('returns null when no test file exists', () => {
      const implFile = path.join(tmpDir, 'src', 'missing.ts')
      const result = findTestFile(implFile, tmpDir)

      expect(result).toBeNull()
    })

    test('finds colocated test file as fallback', () => {
      const srcDir = path.join(tmpDir, 'src')
      fs.mkdirSync(srcDir, { recursive: true })
      fs.writeFileSync(path.join(srcDir, 'baz.ts'), '')
      const colocatedTest = path.join(srcDir, 'baz.test.ts')
      fs.writeFileSync(colocatedTest, '')

      const implFile = path.join(tmpDir, 'src', 'baz.ts')
      const result = findTestFile(implFile, tmpDir)

      expect(result).toBe(colocatedTest)
    })

    test('returns null for non-src file without colocated test', () => {
      const libDir = path.join(tmpDir, 'lib')
      fs.mkdirSync(libDir, { recursive: true })
      const implFile = path.join(libDir, 'util.ts')
      const result = findTestFile(implFile, tmpDir)

      expect(result).toBeNull()
    })

    test('finds parallel test for client/foo.ts at tests/client/foo.test.ts', () => {
      const testsDir = path.join(tmpDir, 'tests', 'client')
      fs.mkdirSync(testsDir, { recursive: true })
      const testFile = path.join(testsDir, 'foo.test.ts')
      fs.writeFileSync(testFile, '')

      const implFile = path.join(tmpDir, 'client', 'foo.ts')
      const result = findTestFile(implFile, tmpDir)

      expect(result).toBe(testFile)
    })

    test('falls back to colocated test for client/foo.ts when no parallel test exists', () => {
      const clientDir = path.join(tmpDir, 'client')
      fs.mkdirSync(clientDir, { recursive: true })
      fs.writeFileSync(path.join(clientDir, 'foo.ts'), '')
      const colocatedTest = path.join(clientDir, 'foo.test.ts')
      fs.writeFileSync(colocatedTest, '')

      const implFile = path.join(tmpDir, 'client', 'foo.ts')
      const result = findTestFile(implFile, tmpDir)

      expect(result).toBe(colocatedTest)
    })

    test('finds parallel test for review-loop/src/cli.ts at tests/review-loop/cli.test.ts', () => {
      const testsDir = path.join(tmpDir, 'tests', 'review-loop')
      fs.mkdirSync(testsDir, { recursive: true })
      const testFile = path.join(testsDir, 'cli.test.ts')
      fs.writeFileSync(testFile, '')

      const implFile = path.join(tmpDir, 'review-loop', 'src', 'cli.ts')
      const result = findTestFile(implFile, tmpDir)

      expect(result).toBe(testFile)
    })

    test('finds parallel test for afk-runner/src/legacy-fold.ts at tests/afk-runner/legacy-fold.test.ts', () => {
      const testsDir = path.join(tmpDir, 'tests', 'afk-runner')
      fs.mkdirSync(testsDir, { recursive: true })
      const testFile = path.join(testsDir, 'legacy-fold.test.ts')
      fs.writeFileSync(testFile, '')

      const implFile = path.join(tmpDir, 'afk-runner', 'src', 'legacy-fold.ts')
      const result = findTestFile(implFile, tmpDir)

      expect(result).toBe(testFile)
    })
  })

  describe('resolveImplPath', () => {
    test('tests/foo/bar.test.ts -> src/foo/bar.ts (src/ fallback)', () => {
      expect(resolveImplPath('tests/foo/bar.test.ts')).toBe(path.join('src', 'foo', 'bar.ts'))
    })

    test('tests/client/debug/helpers.test.ts -> client/debug/helpers.ts (nested)', () => {
      expect(resolveImplPath('tests/client/debug/helpers.test.ts')).toBe(path.join('client', 'debug', 'helpers.ts'))
    })

    test('tests/client/foo.test.ts -> client/foo.ts (flat — regression test for critical bug)', () => {
      expect(resolveImplPath('tests/client/foo.test.ts')).toBe(path.join('client', 'foo.ts'))
    })

    test('tests/scripts/build-client.test.ts -> scripts/build-client.ts (flat)', () => {
      expect(resolveImplPath('tests/scripts/build-client.test.ts')).toBe(path.join('scripts', 'build-client.ts'))
    })

    test('tests/scripts/deep/a.test.ts -> scripts/deep/a.ts (nested)', () => {
      expect(resolveImplPath('tests/scripts/deep/a.test.ts')).toBe(path.join('scripts', 'deep', 'a.ts'))
    })

    test('tests/review-loop/cli.test.ts -> review-loop/src/cli.ts', () => {
      expect(resolveImplPath('tests/review-loop/cli.test.ts')).toBe(path.join('review-loop', 'src', 'cli.ts'))
    })

    test('tests/afk-runner/legacy-fold.test.ts -> afk-runner/src/legacy-fold.ts', () => {
      expect(resolveImplPath('tests/afk-runner/legacy-fold.test.ts')).toBe(
        path.join('afk-runner', 'src', 'legacy-fold.ts'),
      )
    })

    test('tests/afk-runner/kernel/machine.test.ts -> afk-runner/src/kernel/machine.ts (nested)', () => {
      expect(resolveImplPath('tests/afk-runner/kernel/machine.test.ts')).toBe(
        path.join('afk-runner', 'src', 'kernel', 'machine.ts'),
      )
    })
  })
})
