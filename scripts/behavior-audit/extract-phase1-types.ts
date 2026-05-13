import type { ExtractedBehaviorRecord } from './extracted-store.js'
import type { IncrementalManifest } from './incremental.js'
import type { AgentUsage, PhaseStats } from './phase-stats.js'
import type { BehaviorAuditProgressReporter } from './progress-reporter.js'
import type { Progress } from './progress.js'
import type { ParsedTestFile, TestCase } from './test-parser.js'

export interface Phase1RunnerDeps {
  readonly extractWithRetry: (
    prompt: string,
    failedAttempts: number,
  ) => Promise<{
    readonly result: {
      readonly behavior: string
      readonly context: string
      readonly keywords: readonly string[]
      readonly behaviorClaimRefs: readonly { readonly evidenceIndex: number; readonly claim: string }[]
      readonly contextClaimRefs: readonly { readonly evidenceIndex: number; readonly claim: string }[]
      readonly uncertaintyNotes: readonly string[]
    }
    readonly usage: AgentUsage
  } | null>
  readonly updateManifestForExtractedTest: (input: {
    readonly manifest: IncrementalManifest
    readonly testFile: ParsedTestFile
    readonly testCase: TestCase
    readonly extractedBehavior: ExtractedBehaviorRecord
  }) => Promise<{
    readonly manifest: IncrementalManifest
    readonly phase1Changed: boolean
  }>
  readonly getFailedTestAttempts: (progress: Progress, testKey: string) => number
  readonly markTestDone: (progress: Progress, testFilePath: string, testKey: string) => void
  readonly markTestFailed: (progress: Progress, testKey: string, error: string) => void
  readonly getSelectedTests: (
    testFilePath: string,
    tests: readonly TestCase[],
    selectedTestKeys: ReadonlySet<string>,
  ) => readonly TestCase[]
  readonly shouldSkipCompletedFile: (input: {
    readonly progress: Progress
    readonly testFilePath: string
    readonly selectedTests: readonly TestCase[]
    readonly selectedTestKeys: ReadonlySet<string>
  }) => boolean
  readonly writeValidBehaviorsForFile: (
    testFilePath: string,
    selectedTests: readonly TestCase[],
    results: readonly SingleTestResult[],
  ) => Promise<string | null>
  readonly saveManifest: (manifest: IncrementalManifest) => Promise<void>
  readonly saveProgress: (progress: Progress) => Promise<void>
  readonly log: Pick<typeof console, 'log'>
  readonly reporter: BehaviorAuditProgressReporter | undefined
  readonly stats: PhaseStats | undefined
}

export type SingleTestResult = {
  readonly record: ExtractedBehaviorRecord
  readonly manifest: IncrementalManifest
  readonly phase1Changed: boolean
  readonly usage: AgentUsage
  readonly elapsedMs: number
} | null
