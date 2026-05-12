/** One section of the LLM context window, with an optional nested breakdown. */
export type ContextSection = {
  label: string
  tokens: number
} & Partial<{
  detail: string
  children: ContextSection[]
}>

/** Snapshot of the LLM context window for a given conversation. */
export type ContextSnapshot = {
  modelName: string
  sections: ContextSection[]
  totalTokens: number
  /** Model's context window if known, null for unrecognized models. */
  maxTokens: number | null
  /** True when token counts came from a char/4 fallback because tokenization failed. */
  approximate: boolean
}
