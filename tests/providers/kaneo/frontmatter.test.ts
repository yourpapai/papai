import { describe, expect, test } from 'bun:test'

import {
  addRelation,
  parseRelationsFromDescription,
  removeRelation,
  updateRelation,
} from '../../../src/providers/kaneo/frontmatter.js'
import { buildDescriptionWithRelations } from '../../helpers/build-description.js'

describe('parseRelationsFromDescription', () => {
  test('returns empty for undefined', () => {
    const result = parseRelationsFromDescription(undefined)
    expect(result).toEqual({ relations: [], body: '' })
  })

  test('returns empty for null', () => {
    const nullDescription: string | null = null
    const result = parseRelationsFromDescription(nullDescription)
    expect(result).toEqual({ relations: [], body: '' })
  })

  test('returns empty for non-frontmatter text', () => {
    const result = parseRelationsFromDescription('Just text')
    expect(result).toEqual({ relations: [], body: 'Just text' })
  })

  test('returns empty for empty string', () => {
    const result = parseRelationsFromDescription('')
    expect(result).toEqual({ relations: [], body: '' })
  })

  test('parses all relation types', () => {
    const desc = '---\nblocks: task-1, task-2\nrelated: task-3\n---\nBody text'
    const result = parseRelationsFromDescription(desc)
    expect(result.relations).toHaveLength(3)
    expect(result.body).toBe('Body text')
  })

  test('parses all 6 relation type variants', () => {
    const desc = `---
blocks: task-1
blocked_by: task-2
duplicate: task-3
duplicate_of: task-4
related: task-5
parent: task-6
---
Body`
    const result = parseRelationsFromDescription(desc)
    expect(result.relations).toHaveLength(6)
    expect(result.relations.map((r) => r.type)).toContain('blocks')
    expect(result.relations.map((r) => r.type)).toContain('blocked_by')
    expect(result.relations.map((r) => r.type)).toContain('duplicate')
    expect(result.relations.map((r) => r.type)).toContain('duplicate_of')
    expect(result.relations.map((r) => r.type)).toContain('related')
    expect(result.relations.map((r) => r.type)).toContain('parent')
  })

  test('trims whitespace from task IDs', () => {
    const desc = '---\nblocks: task-1 , task-2 ,  task-3  \n---\nBody'
    const result = parseRelationsFromDescription(desc)
    expect(result.relations).toHaveLength(3)
    expect(result.relations[0]?.taskId).toBe('task-1')
    expect(result.relations[1]?.taskId).toBe('task-2')
    expect(result.relations[2]?.taskId).toBe('task-3')
  })

  test('handles unclosed frontmatter', () => {
    const desc = '---\nblocks: task-1\nBody without closing'
    const result = parseRelationsFromDescription(desc)
    expect(result.relations).toEqual([])
    expect(result.body).toBe(desc)
  })

  test('filters out invalid relation types', () => {
    const desc = '---\nblocks: task-1\ninvalid_type: task-2\nrelated: task-3\n---\nBody'
    const result = parseRelationsFromDescription(desc)
    expect(result.relations).toHaveLength(2)
    expect(result.relations.map((r) => r.type)).not.toContain('invalid_type')
  })

  test('handles empty relation values', () => {
    const desc = '---\nblocks:\nrelated: task-1\n---\nBody'
    const result = parseRelationsFromDescription(desc)
    expect(result.relations).toHaveLength(1)
    expect(result.relations[0]?.type).toBe('related')
  })

  test('handles multiple comma-separated IDs', () => {
    const desc = '---\nblocks: task-1,task-2, task-3 ,task-4\n---\nBody'
    const result = parseRelationsFromDescription(desc)
    expect(result.relations).toHaveLength(4)
  })

  test('preserves body content with newlines', () => {
    const desc = '---\nblocks: task-1\n---\nLine 1\n\nLine 2\n\nLine 3'
    const result = parseRelationsFromDescription(desc)
    expect(result.body).toBe('Line 1\n\nLine 2\n\nLine 3')
  })

  test('handles frontmatter with extra whitespace', () => {
    const desc = '---  \n  blocks: task-1  \n  related: task-2  \n  ---  \nBody'
    const result = parseRelationsFromDescription(desc)
    expect(result.relations).toHaveLength(2)
    expect(result.body).toBe('Body')
  })
})

describe('buildDescriptionWithRelations', () => {
  test('builds description with relations', () => {
    const relations = [
      { type: 'blocks' as const, taskId: 'task-1' },
      { type: 'related' as const, taskId: 'task-2' },
    ]
    const result = buildDescriptionWithRelations('Body text', relations)
    expect(result).toContain('blocks: task-1')
    expect(result).toContain('related: task-2')
    expect(result).toContain('Body text')
  })

  test('returns body only when no relations', () => {
    const result = buildDescriptionWithRelations('Body text', [])
    expect(result).toBe('Body text')
  })

  test('groups multiple relations of same type', () => {
    const relations = [
      { type: 'blocks' as const, taskId: 'task-1' },
      { type: 'blocks' as const, taskId: 'task-2' },
      { type: 'related' as const, taskId: 'task-3' },
    ]
    const result = buildDescriptionWithRelations('Body', relations)
    expect(result).toContain('blocks: task-1, task-2')
    expect(result).toContain('related: task-3')
  })

  test('handles empty body', () => {
    const relations = [{ type: 'blocks' as const, taskId: 'task-1' }]
    const result = buildDescriptionWithRelations('', relations)
    expect(result).toContain('blocks: task-1')
  })

  test('handles all relation types', () => {
    const relations = [
      { type: 'blocks' as const, taskId: 't1' },
      { type: 'blocked_by' as const, taskId: 't2' },
      { type: 'duplicate' as const, taskId: 't3' },
      { type: 'duplicate_of' as const, taskId: 't4' },
      { type: 'related' as const, taskId: 't5' },
      { type: 'parent' as const, taskId: 't6' },
    ]
    const result = buildDescriptionWithRelations('Body', relations)
    expect(result).toContain('blocks:')
    expect(result).toContain('blocked_by:')
    expect(result).toContain('duplicate:')
    expect(result).toContain('duplicate_of:')
    expect(result).toContain('related:')
    expect(result).toContain('parent:')
  })
})

describe('addRelation', () => {
  test('adds relation to empty description', () => {
    const result = addRelation('', { type: 'blocks', taskId: 'task-1' })
    expect(result).toContain('blocks: task-1')
  })

  test('skips duplicate relations', () => {
    const initial = '---\nblocks: task-1\n---\n'
    const result = addRelation(initial, { type: 'blocks', taskId: 'task-1' })
    const matches = Array.from(result.matchAll(/blocks: task-1/g))
    expect(matches.length).toBe(1)
  })

  test('adds different relation type to existing', () => {
    const initial = '---\nblocks: task-1\n---\nBody'
    const result = addRelation(initial, { type: 'related', taskId: 'task-2' })
    expect(result).toContain('blocks: task-1')
    expect(result).toContain('related: task-2')
  })

  test('appends to existing relation type', () => {
    const initial = '---\nblocks: task-1\n---\nBody'
    const result = addRelation(initial, { type: 'blocks', taskId: 'task-2' })
    expect(result).toContain('blocks: task-1, task-2')
  })

  test('adds relation to plain text description', () => {
    const initial = 'Plain body text'
    const result = addRelation(initial, { type: 'related', taskId: 'task-1' })
    expect(result).toContain('---')
    expect(result).toContain('related: task-1')
    expect(result).toContain('Plain body text')
  })

  test('preserves body content when adding relation', () => {
    const initial = 'Existing body with multiple lines\nand content'
    const result = addRelation(initial, { type: 'blocks', taskId: 'task-1' })
    expect(result).toContain('Existing body with multiple lines')
    expect(result).toContain('and content')
    expect(result.indexOf('---')).toBeLessThan(result.indexOf('Existing'))
  })
})

describe('removeRelation', () => {
  test('removes specific task relation', () => {
    const desc = '---\nblocks: task-1, task-2\n---\nBody'
    const result = removeRelation(desc, 'task-1')
    expect(result).toContain('task-2')
    expect(result).not.toContain('task-1')
  })

  test('removes frontmatter when removing only relation', () => {
    const desc = '---\nblocks: task-1\n---\nBody'
    const result = removeRelation(desc, 'task-1')
    expect(result).not.toContain('---')
    expect(result).toBe('Body')
  })

  test('removes task from specific relation type only', () => {
    const desc = '---\nblocks: task-1\nrelated: task-1\n---\nBody'
    const result = removeRelation(desc, 'task-1')
    // Both should be removed since same taskId
    expect(result).not.toContain('task-1')
  })

  test('handles removing non-existent task', () => {
    const desc = '---\nblocks: task-1\n---\nBody'
    const result = removeRelation(desc, 'task-999')
    expect(result).toContain('blocks: task-1')
  })

  test('returns unchanged when no frontmatter exists', () => {
    const desc = 'Plain body text'
    const result = removeRelation(desc, 'task-1')
    expect(result).toBe('Plain body text')
  })

  test('removes task from middle of list', () => {
    const desc = '---\nblocks: task-1, task-2, task-3\n---\nBody'
    const result = removeRelation(desc, 'task-2')
    expect(result).toContain('blocks: task-1, task-3')
  })
})

describe('updateRelation', () => {
  test('changes relation type', () => {
    const desc = '---\nblocks: task-1\n---\nBody'
    const result = updateRelation(desc, 'task-1', 'related')
    expect(result).toContain('related: task-1')
    expect(result).not.toContain('blocks: task-1')
  })

  test('updates only specified relation type', () => {
    const desc = '---\nblocks: task-1, task-2\nrelated: task-1\n---\nBody'
    const result = updateRelation(desc, 'task-1', 'duplicate')
    // task-1 appears in both blocks and related
    // Should update one instance
    const blocksMatches = Array.from(result.matchAll(/blocks:/g)).length
    const relatedMatches = Array.from(result.matchAll(/related:/g)).length
    const duplicateMatches = Array.from(result.matchAll(/duplicate:/g)).length
    expect(blocksMatches + relatedMatches + duplicateMatches).toBe(2)
  })

  test('returns unchanged when task not found', () => {
    const desc = '---\nblocks: task-1\n---\nBody'
    const result = updateRelation(desc, 'task-999', 'related')
    expect(result).toContain('blocks: task-1')
    expect(result).not.toContain('related:')
  })

  test('handles updating to same type', () => {
    const desc = '---\nblocks: task-1\n---\nBody'
    const result = updateRelation(desc, 'task-1', 'blocks')
    expect(result).toContain('blocks: task-1')
  })

  test('supports all relation type updates', () => {
    const types = ['blocks', 'blocked_by', 'duplicate', 'duplicate_of', 'related', 'parent'] as const
    const pairs = types.flatMap((fromType) =>
      types.filter((toType) => toType !== fromType).map((toType) => ({ fromType, toType })),
    )

    for (const { fromType, toType } of pairs) {
      const desc = `---\n${fromType}: task-1\n---\nBody`
      const result = updateRelation(desc, 'task-1', toType)
      expect(result).toContain(`${toType}: task-1`)
    }
  })
})
