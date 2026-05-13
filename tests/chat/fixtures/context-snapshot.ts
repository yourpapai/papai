import type { ContextSnapshot } from '../../../src/chat/types.js'

export const standardContextSnapshot: ContextSnapshot = {
  modelName: 'gpt-4o',
  totalTokens: 6_770,
  maxTokens: 128_000,
  approximate: false,
  sections: [
    {
      label: 'System prompt',
      tokens: 820,
      children: [
        { label: 'Base instructions', tokens: 650 },
        { label: 'Custom instructions', tokens: 120 },
        { label: 'Provider addendum', tokens: 50 },
      ],
    },
    {
      label: 'Memory context',
      tokens: 350,
      children: [
        { label: 'Summary', tokens: 180 },
        { label: 'Known entities', tokens: 170, detail: '12 facts' },
      ],
    },
    { label: 'Conversation history', tokens: 2_400, detail: '34 messages' },
    { label: 'Tools', tokens: 3_200, detail: '18 active, gated by kaneo' },
  ],
}
