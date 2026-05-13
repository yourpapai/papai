/**
 * plan-adr-workflow-schemas.ts
 *
 * Shared JSON schemas used by opencode structured outputs.
 */

export const IMPLEMENTATION_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: ['fully_implemented', 'partially_implemented', 'not_implemented', 'superseded', 'unclear'],
      description: 'Overall implementation status of the plan',
    },
    is_fully_implemented: {
      type: 'boolean',
      description:
        'True only when ALL key features, tasks, and file changes described in the plan exist in the codebase',
    },
    evidence: {
      type: 'string',
      description:
        'Concise evidence: list which key files are present or absent, mention checkbox completion ratio if applicable',
    },
    spec_path: {
      type: 'string',
      description:
        'Relative path to the design/spec document explicitly referenced in the plan (e.g. docs/superpowers/specs/...). Empty string if none found.',
    },
  },
  required: ['status', 'is_fully_implemented', 'evidence'],
} as const

export const REMAINING_WORK_SCHEMA = {
  type: 'object',
  properties: {
    completed_items: {
      type: 'array',
      items: { type: 'string' },
      description: 'Concise list of plan tasks or features that are already fully implemented in the codebase',
    },
    remaining_items: {
      type: 'array',
      items: { type: 'string' },
      description: 'Concise list of plan tasks or features that are not yet implemented or are incomplete',
    },
    suggested_next_steps: {
      type: 'array',
      items: { type: 'string' },
      description: 'Prioritised list of actionable next steps to fully implement the plan',
    },
  },
  required: ['completed_items', 'remaining_items', 'suggested_next_steps'],
} as const

export const REMAINING_WORK_ASSESSMENT_SCHEMA = {
  type: 'object',
  properties: {
    effort: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
      description: 'Estimated implementation effort for the remaining work',
    },
    worthiness: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
      description: 'Whether the remaining work is worth implementing relative to the plan goal',
    },
    practical_value: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
      description: 'Practical product or maintenance value of implementing the remaining work',
    },
    should_write_adr: {
      type: 'boolean',
      description:
        'True when the remaining work is not worth implementing and the plan should proceed to ADR/archive instead',
    },
    rationale: {
      type: 'string',
      description: 'Concise explanation for the recommendation',
    },
  },
  required: ['effort', 'worthiness', 'practical_value', 'should_write_adr', 'rationale'],
} as const
