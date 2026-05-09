import type { EvidenceRef } from './extract-trust-types.js'
import type { TestCase } from './test-parser.js'

function deriveImplPath(testPath: string): string {
  return testPath.replace(/^tests\//, 'src/').replace(/\.test\.ts$/, '.ts')
}

export interface EvidencePromptInput {
  readonly testCase: TestCase
  readonly testFilePath: string
  readonly behaviorEvidence: readonly EvidenceRef[]
  readonly contextEvidence: readonly EvidenceRef[]
}

function formatEvidenceEntry(ref: EvidenceRef, index: number): string {
  const location = `${ref.filePath}:${ref.startLine}-${ref.endLine}`
  const symbol = ref.qualifiedName === undefined ? '' : ` (${ref.qualifiedName})`
  return `[${index}] ${ref.kind}${symbol} — ${location}\n\`\`\`typescript\n${ref.snippet}\n\`\`\``
}

export function buildEvidenceBackedPrompt(input: EvidencePromptInput): string {
  const implPath = deriveImplPath(input.testFilePath)
  const header =
    `**Test file:** ${input.testFilePath}\n` +
    `**Test name:** ${input.testCase.fullPath}\n` +
    `**Likely implementation file:** ${implPath}\n\n` +
    `\`\`\`typescript\n${input.testCase.source}\n\`\`\``

  const contextLines = input.contextEvidence.map((ref, i) => formatEvidenceEntry(ref, i))
  const contextSection =
    contextLines.length > 0
      ? `\n\n## Evidence\n\nResolved implementation references:\n\n${contextLines.join('\n\n')}`
      : ''

  const behaviorLines = input.behaviorEvidence.map((ref, i) => formatEvidenceEntry(ref, i))
  const behaviorSection =
    behaviorLines.length > 0 ? `\n\n## Behavior Evidence\n\nTest-source evidence:\n\n${behaviorLines.join('\n\n')}` : ''

  const instructions = `\n\n## Output Requirements

For each claim you make, reference the evidence by its index number [N].
- behaviorClaimRefs: list each behavior claim with the evidence index that supports it
- contextClaimRefs: list each context claim with the evidence index that supports it
- uncertaintyNotes: explicitly note any claims not directly supported by provided evidence
- Distinguish between observed behavior (what the test directly demonstrates) and inferred context (what you deduce from implementation patterns)`

  return `${header}${contextSection}${behaviorSection}${instructions}`
}
