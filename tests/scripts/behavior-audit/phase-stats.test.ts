import { describe, expect, test } from 'bun:test'

import {
  addAgentUsage,
  createPhaseStats,
  emptyAgentUsage,
  formatPhaseSummary,
  formatPerItemSuffix,
  recordItemDone,
  recordItemFailed,
  recordItemSkipped,
  type AgentUsage,
} from '../../../scripts/behavior-audit/phase-stats.js'

describe('phase-stats', () => {
  describe('createPhaseStats', () => {
    test('returns zeroed stats with wallStartMs set', () => {
      const stats = createPhaseStats()
      expect(stats.itemsDone).toBe(0)
      expect(stats.itemsFailed).toBe(0)
      expect(stats.itemsSkipped).toBe(0)
      expect(stats.totalInputTokens).toBe(0)
      expect(stats.totalOutputTokens).toBe(0)
      expect(stats.totalToolCalls).toBe(0)
      expect(Object.keys(stats.toolBreakdown).length).toBe(0)
      expect(stats.wallStartMs).toBeGreaterThan(0)
    })
  })

  describe('recordItemDone', () => {
    test('increments done count and accumulates usage', () => {
      const stats = createPhaseStats()
      const usage: AgentUsage = {
        inputTokens: 100,
        outputTokens: 50,
        toolCalls: 3,
        toolNames: ['readFile', 'grep', 'readFile'],
      }
      recordItemDone(stats, usage)
      expect(stats.itemsDone).toBe(1)
      expect(stats.totalInputTokens).toBe(100)
      expect(stats.totalOutputTokens).toBe(50)
      expect(stats.totalToolCalls).toBe(3)
      expect(stats.toolBreakdown).toEqual({ readFile: 2, grep: 1 })
    })

    test('accumulates across multiple items', () => {
      const stats = createPhaseStats()
      recordItemDone(stats, {
        inputTokens: 100,
        outputTokens: 50,
        toolCalls: 2,
        toolNames: ['readFile', 'grep'],
      })
      recordItemDone(stats, {
        inputTokens: 200,
        outputTokens: 80,
        toolCalls: 1,
        toolNames: ['readFile'],
      })
      expect(stats.itemsDone).toBe(2)
      expect(stats.totalInputTokens).toBe(300)
      expect(stats.totalOutputTokens).toBe(130)
      expect(stats.totalToolCalls).toBe(3)
      expect(stats.toolBreakdown).toEqual({ readFile: 2, grep: 1 })
    })
  })

  describe('recordItemFailed', () => {
    test('increments failed count without usage', () => {
      const stats = createPhaseStats()
      recordItemFailed(stats)
      expect(stats.itemsFailed).toBe(1)
      expect(stats.totalInputTokens).toBe(0)
    })

    test('increments failed count with partial usage', () => {
      const stats = createPhaseStats()
      recordItemFailed(stats, {
        inputTokens: 50,
        outputTokens: 10,
        toolCalls: 1,
        toolNames: ['readFile'],
      })
      expect(stats.itemsFailed).toBe(1)
      expect(stats.totalInputTokens).toBe(50)
      expect(stats.totalToolCalls).toBe(1)
    })
  })

  describe('recordItemSkipped', () => {
    test('increments skipped count', () => {
      const stats = createPhaseStats()
      recordItemSkipped(stats)
      expect(stats.itemsSkipped).toBe(1)
      expect(stats.totalInputTokens).toBe(0)
    })
  })

  describe('addAgentUsage', () => {
    test('sums all fields', () => {
      const a: AgentUsage = {
        inputTokens: 100,
        outputTokens: 50,
        toolCalls: 2,
        toolNames: ['readFile'],
      }
      const b: AgentUsage = {
        inputTokens: 200,
        outputTokens: 80,
        toolCalls: 1,
        toolNames: ['grep'],
      }
      const result = addAgentUsage(a, b)
      expect(result.inputTokens).toBe(300)
      expect(result.outputTokens).toBe(130)
      expect(result.toolCalls).toBe(3)
      expect(result.toolNames).toEqual(['readFile', 'grep'])
    })
  })

  describe('formatPerItemSuffix', () => {
    test('formats successful item with tools and tokens', () => {
      const usage: AgentUsage = {
        inputTokens: 1200,
        outputTokens: 647,
        toolCalls: 3,
        toolNames: ['readFile', 'grep', 'grep'],
      }
      const suffix = formatPerItemSuffix(usage, 4200)
      expect(suffix).toBe(' — 3 tools, 1,847 tok in 4.2s (154 tok/s) ✓')
    })

    test('formats item with zero tools', () => {
      const usage: AgentUsage = {
        inputTokens: 400,
        outputTokens: 200,
        toolCalls: 0,
        toolNames: [],
      }
      const suffix = formatPerItemSuffix(usage, 1100)
      expect(suffix).toBe(' — 0 tools, 600 tok in 1.1s (182 tok/s) ✓')
    })

    test('formats item with 1 tool (singular)', () => {
      const usage: AgentUsage = {
        inputTokens: 400,
        outputTokens: 200,
        toolCalls: 1,
        toolNames: ['readFile'],
      }
      const suffix = formatPerItemSuffix(usage, 1000)
      expect(suffix).toBe(' — 1 tool, 600 tok in 1.0s (200 tok/s) ✓')
    })
  })

  describe('formatPhaseSummary', () => {
    test('formats full summary with tools breakdown', () => {
      const stats = createPhaseStats()
      recordItemDone(stats, {
        inputTokens: 89421,
        outputTokens: 12847,
        toolCalls: 142,
        toolNames: Array<string>(89).fill('readFile').concat(Array<string>(53).fill('grep')),
      })
      recordItemFailed(stats)
      recordItemSkipped(stats)
      const ms = 272000
      const label = 'Phase 1 complete — 23 files, 1 behaviors extracted, 1 failed'
      const output = formatPhaseSummary(stats, ms, label)
      expect(output).toContain('Phase 1 complete — 23 files, 1 behaviors extracted, 1 failed')
      expect(output).toContain('Wall: 4m 32s')
      expect(output).toContain('Avg:')
      expect(output).toContain('tok/s')
      expect(output).toContain('Tokens: 89,421 in / 12,847 out')
      expect(output).toContain('Tools: 142 calls')
      expect(output).toContain('readFile: 89')
      expect(output).toContain('grep: 53')
    })

    test('formats wall time as seconds only when under a minute', () => {
      const stats = createPhaseStats()
      recordItemDone(stats, {
        inputTokens: 1000,
        outputTokens: 500,
        toolCalls: 2,
        toolNames: ['readFile', 'grep'],
      })
      const output = formatPhaseSummary(stats, 45000, 'Phase 2a complete — 5 done')
      expect(output).toContain('Wall: 45.0s')
    })

    test('omits tools line when no tool calls', () => {
      const stats = createPhaseStats()
      recordItemDone(stats, {
        inputTokens: 1000,
        outputTokens: 500,
        toolCalls: 0,
        toolNames: [],
      })
      const output = formatPhaseSummary(stats, 5000, 'Phase 2a complete — 1 done')
      expect(output).not.toContain('Tools:')
    })
  })

  describe('emptyAgentUsage', () => {
    test('is a zero-valued usage', () => {
      expect(emptyAgentUsage.inputTokens).toBe(0)
      expect(emptyAgentUsage.outputTokens).toBe(0)
      expect(emptyAgentUsage.toolCalls).toBe(0)
      expect(emptyAgentUsage.toolNames).toEqual([])
    })
  })
})
