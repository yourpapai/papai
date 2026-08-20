// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ReviewerIssueSchema } from '../../review-loop/src/issue-schema.js'
import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import {
  buildFixPrompt,
  buildInspectPrompt,
  buildRetryFixPrompt,
  buildRetryFixWithInspectorFeedbackPrompt,
  buildReviewPrompt,
  MINIMALITY_LADDER,
} from '../../review-loop/src/prompt-templates.js'

const issue: ReviewerIssue = {
  title: 'Race condition in queue flush path',
  kind: 'defect',
  severity: 'high',
  summary: 'Two concurrent messages can bypass the intended lock.',
  whyItMatters: 'This can produce stale assistant replies.',
  evidence: 'src/message-queue/queue.ts lines 84-107',
  file: 'src/message-queue/queue.ts',
  lineStart: 84,
  lineEnd: 107,
  suggestedFix: 'Take the processing lock earlier.',
  confidence: 0.92,
}

describe('prompt-templates', () => {
  test('buildReviewPrompt includes plan path, output path, and schema', () => {
    const prompt = buildReviewPrompt('/path/to/plan.md', '/path/to/issues.json')
    expect(prompt).toContain('/path/to/plan.md')
    expect(prompt).toContain('/path/to/issues.json')
    expect(prompt).toContain('"issues"')
    expect(prompt).toContain('severity')
  })

  test('buildFixPrompt includes issue JSON, output path, and check command', () => {
    const prompt = buildFixPrompt(issue, '/path/to/result.json', 'npm test')
    expect(prompt).toContain('src/message-queue/queue.ts')
    expect(prompt).toContain('/path/to/result.json')
    expect(prompt).toContain('`npm test`')
    expect(prompt).not.toContain('bun check:full')
    expect(prompt).not.toContain('fix(review-loop):')
  })

  test('buildRetryFixPrompt includes error output and check command', () => {
    const prompt = buildRetryFixPrompt(issue, '/path/to/result.json', 'TypeError: x is not a function', 'npm test')
    expect(prompt).toContain('TypeError: x is not a function')
    expect(prompt).toContain('/path/to/result.json')
    expect(prompt).toContain('`npm test`')
  })

  test('reviewer prompt keeps sentinel + gains evidence/scope/severity/convention clauses', () => {
    const p = buildReviewPrompt('/plan.md', '/issues.json')
    expect(p).toContain('Review the current implementation')
    expect(p).toContain('AGENTS.md')
    expect(p).toContain('evidence')
    expect(p).toContain('critical')
    expect(p).toContain('low')
  })

  test('review prompt forbids running test suites and build checks', () => {
    const p = buildReviewPrompt('/plan.md', '/issues.json')
    expect(p).toContain('do NOT run')
    expect(p).toContain('git diff')
    expect(p).toContain('fixer')
  })

  test('pins confidence to a 0-1 probability range (regression: reviewer emitted 1-5 scale)', () => {
    const p = buildReviewPrompt('/plan.md', '/issues.json')
    expect(p).toContain('between 0 and 1')
    expect(p).toContain('NOT a 1-5 rating')
  })

  test('fixer prompt keeps sentinel, drops commit instruction, asks for commitMessage + severity', () => {
    const p = buildFixPrompt(issue, '/result.json', 'bun check:full')
    expect(p).toContain('Verify and fix')
    expect(p).toContain('commitMessage')
    expect(p).toContain('severity')
    expect(p).toContain('plan_drift')
    expect(p).not.toContain('commit with message')
  })

  test('retry prompt inlines schema (no "same schema as before") + final-attempt', () => {
    const p = buildRetryFixPrompt(issue, '/result.json', 'TypeError: x', 'bun check:full')
    expect(p).toContain('build error')
    expect(p).toContain('"verdict"')
    expect(p).not.toContain('same schema as before')
    expect(p).toContain('final attempt')
  })
})

describe('buildInspectPrompt', () => {
  const inspectorIssue: ReviewerIssue = {
    title: 'Race in queue',
    kind: 'defect',
    severity: 'high',
    summary: 's',
    whyItMatters: 'w',
    evidence: 'src/q.ts 1-2',
    file: 'src/q.ts',
    lineStart: 1,
    lineEnd: 2,
    suggestedFix: 'lock',
    confidence: 0.9,
  }

  test('includes issue JSON, diff, fixer reasoning, output path, and schema', () => {
    const prompt = buildInspectPrompt(inspectorIssue, 'diff content here', 'fixer reasoning', 'out.json')
    expect(prompt).toContain('You are an inspector')
    expect(prompt).toContain('Race in queue')
    expect(prompt).toContain('diff content here')
    expect(prompt).toContain('fixer reasoning')
    expect(prompt).toContain('out.json')
    expect(prompt).toContain('"addresses": boolean')
    expect(prompt).toContain('Do not flag unrelated problems')
  })

  test('pins confidence to a 0-1 probability range (regression: reviewer emitted 1-5 scale)', () => {
    const prompt = buildInspectPrompt(inspectorIssue, 'd', 'r', 'o.json')
    expect(prompt).toContain('between 0 and 1')
    expect(prompt).toContain('NOT a 1-5 rating')
  })
})

describe('buildRetryFixWithInspectorFeedbackPrompt', () => {
  const inspectorIssue: ReviewerIssue = {
    title: 'Race in queue',
    kind: 'defect',
    severity: 'high',
    summary: 's',
    whyItMatters: 'w',
    evidence: 'src/q.ts 1-2',
    file: 'src/q.ts',
    lineStart: 1,
    lineEnd: 2,
    suggestedFix: 'lock',
    confidence: 0.9,
  }

  test('includes inspector reasoning and the agree-with-inspector branch', () => {
    const prompt = buildRetryFixWithInspectorFeedbackPrompt(
      inspectorIssue,
      'inspector said: this is wrong',
      'out.json',
      'bun check:full',
    )
    expect(prompt).toContain('rejected by an inspector')
    expect(prompt).toContain('inspector said: this is wrong')
    expect(prompt).toContain('verdict "invalid", "needs_human", or "plan_drift"')
    expect(prompt).toContain('bun check:full')
    expect(prompt).toContain('final attempt')
  })
})

describe('exposure in prompts', () => {
  const reviewPrompt = (): string => buildReviewPrompt('/path/to/plan.md', '/path/to/issues.json')

  test('buildReviewPrompt asks for a cited caller or an explicit none', () => {
    const prompt = reviewPrompt()
    expect(prompt).toContain('exposure')
    expect(prompt).toContain('"kind": "caller"')
    expect(prompt).toContain('"kind": "none"')
  })

  test('buildReviewPrompt makes exposure mandatory: silence is not an answer', () => {
    const prompt = reviewPrompt()
    expect(prompt).toContain('MUST')
    expect(prompt).toMatch(/omit|silence|leaving it out/iu)
  })

  test('buildReviewPrompt asks for the caller as evidence, not as a rating', () => {
    const prompt = reviewPrompt()
    expect(prompt).toMatch(/quote/iu)
    expect(prompt).not.toMatch(/rate the (importance|reachability)/iu)
  })

  for (const [label, build] of [
    ['buildFixPrompt', (): string => buildFixPrompt(issue, '/p/result.json', 'npm test')],
    ['buildRetryFixPrompt', (): string => buildRetryFixPrompt(issue, '/p/result.json', 'boom', 'npm test')],
    [
      'buildRetryFixWithInspectorFeedbackPrompt',
      (): string => buildRetryFixWithInspectorFeedbackPrompt(issue, 'not addressed', '/p/result.json', 'npm test'),
    ],
  ] as const) {
    test(`${label} asks the fixer for its own exposure assessment`, () => {
      const prompt = build()
      expect(prompt).toContain('exposure')
      expect(prompt).toContain('"kind": "caller"')
      expect(prompt).toContain('"kind": "none"')
    })

    test(`${label} states the assessment is independent of the reviewer`, () => {
      expect(build()).toMatch(/independent|your own/iu)
    })
  }
})

describe('fix instruction contract', () => {
  const fixPrompts = [
    ['buildFixPrompt', (): string => buildFixPrompt(issue, '/p/result.json', 'npm test')],
    ['buildRetryFixPrompt', (): string => buildRetryFixPrompt(issue, '/p/result.json', 'boom', 'npm test')],
    [
      'buildRetryFixWithInspectorFeedbackPrompt',
      (): string => buildRetryFixWithInspectorFeedbackPrompt(issue, 'not addressed', '/p/result.json', 'npm test'),
    ],
  ] as const

  for (const [label, build] of fixPrompts) {
    test(`${label} carries the minimality ladder`, () => {
      const prompt = build()
      expect(prompt).toMatch(/need to exist/iu)
      expect(prompt).toMatch(/already/iu)
      expect(prompt).toMatch(/one line/iu)
    })

    test(`${label} applies the ladder after comprehension, not instead of it`, () => {
      expect(build()).toMatch(/after you understand/iu)
    })

    // Additive to the two obligation assertions above, which cover a different
    // failure: those keep a *reworded* ladder honest, this keeps every carrier
    // saying the same words. Losing the first leaves a rewrite untested; losing
    // this one lets one carrier drift from the constant the others share.
    test(`${label} carries the ladder constant verbatim`, () => {
      expect(build()).toContain(MINIMALITY_LADDER)
    })
  }

  test('buildFixPrompt requires a runnable check to remain in the tree', () => {
    const prompt = buildFixPrompt(issue, '/p/result.json', 'npm test')
    expect(prompt).toMatch(/runnable check/iu)
    expect(prompt).toMatch(/does not satisfy/iu)
  })

  test('buildFixPrompt forbids authoring architecture prose and asks for the gap instead', () => {
    const prompt = buildFixPrompt(issue, '/p/result.json', 'npm test')
    expect(prompt).toMatch(/architecture/iu)
    expect(prompt).toMatch(/report/iu)
    expect(prompt).toContain('do NOT edit the plan/spec')
  })
})

describe('deletion findings in the reviewer prompt', () => {
  const reviewPrompt = (): string => buildReviewPrompt('/plan.md', '/issues.json')

  test('admits the five kinds by name', () => {
    const p = reviewPrompt()
    for (const tag of ['delete', 'stdlib', 'native', 'yagni', 'shrink']) expect(p).toContain(tag)
  })

  test('requires a named replacement for every cleanup', () => {
    const p = reviewPrompt()
    expect(p).toMatch(/replace/iu)
    expect(p).toMatch(/name/iu)
    // "nothing replaces it" is a complete answer for unused code, not a gap.
    expect(p).toMatch(/nothing replaces it/iu)
  })

  test('tells the reviewer to omit a cleanup it cannot name a replacement for', () => {
    expect(reviewPrompt()).toMatch(/omit/iu)
  })

  test('requires kind on every issue and states the two values', () => {
    const p = reviewPrompt()
    expect(p).toContain('"kind"')
    expect(p).toContain('"defect"')
    expect(p).toContain('"cleanup"')
  })

  test('states the medium ceiling on cleanups', () => {
    const p = reviewPrompt()
    expect(p).toMatch(/never above medium|at most medium|no higher than medium/iu)
  })

  test('keeps the existing exclusions: style, naming, and personal preference stay out', () => {
    // A deletion vocabulary is exactly the thing that could be read as licence
    // to report taste. The old exclusion has to survive it verbatim.
    const p = reviewPrompt()
    expect(p).toContain('correct but I would write it differently')
    expect(p).toMatch(/style\/formatting a linter owns/iu)
    expect(p).toMatch(/naming preferences/iu)
  })

  test("the prompt's inline issue schema still matches issue-schema.ts", () => {
    // The prompt embeds the schema as a string literal, so the two drift in
    // silence: a reviewer told to emit a field the parser rejects loses the
    // whole round to a validation error.
    const p = reviewPrompt()
    const shape = ReviewerIssueSchema.parse({
      title: 't',
      kind: 'cleanup',
      severity: 'medium',
      summary: 's',
      whyItMatters: 'w',
      evidence: 'e',
      file: 'f.ts',
      lineStart: 1,
      lineEnd: 2,
      suggestedFix: 'x',
      confidence: 0.5,
    })
    for (const key of Object.keys(shape)) expect(p).toContain(`"${key}"`)
  })
})

describe('spans in reviewer schema', () => {
  test('ReviewerIssueSchema accepts theme spans and legacy without spans', async () => {
    const { ReviewerIssueSchema: Schema } = await import('../../review-loop/src/issue-schema.js')
    const legacy = {
      title: 't',
      severity: 'low',
      summary: 's',
      whyItMatters: 'w',
      evidence: 'e',
      file: 'f.ts',
      lineStart: 1,
      lineEnd: 2,
      suggestedFix: 'x',
      confidence: 0.5,
    }
    expect(() => Schema.parse(legacy)).not.toThrow()
    expect(() =>
      Schema.parse({
        ...legacy,
        spans: [
          { file: 'src/a.ts', lineStart: 1, lineEnd: 2, evidence: 'e1' },
          { file: 'src/b.ts', lineStart: 3, lineEnd: 4, evidence: 'e2' },
        ],
      }),
    ).not.toThrow()
    expect(() => Schema.parse({ ...legacy, spans: [] })).toThrow()
  })
})

describe('reviewer coalescence', () => {
  test('review prompt tells reviewer to coalesce same-class repeats into theme spans', () => {
    const prompt = buildReviewPrompt('/plan.md', '/issues.json')
    expect(prompt).toMatch(/same class repeats/iu)
    expect(prompt).toContain('spans')
    expect(prompt).toMatch(/ONE theme issue/iu)
    expect(prompt).toMatch(/un-migrated English literals/iu)
  })
})
