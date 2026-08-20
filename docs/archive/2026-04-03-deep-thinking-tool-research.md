<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Deep-Thinking Tool — Research Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Research the feasibility, design options, and trade-offs for adding an `ask_llm` tool that forwards the user's question to a larger/more capable LLM when the bot's main model cannot provide a sufficiently complete answer.

**Architecture:** The bot's main LLM (`main_model`) would autonomously decide to invoke a new tool when the user asks a general-knowledge question outside task management. The tool calls a separate, more powerful model (configured per-user) and returns its response as the tool result.

**Tech Stack:** Vercel AI SDK (`generateText`), `@ai-sdk/openai-compatible`, Zod v4

---

## Scope

This plan covers **research only** — no implementation. The deliverable is a design document (`docs/plans/YYYY-MM-DD-deep-thinking-tool-design.md`) with findings and a recommended approach.

---

### Task 1: Define the problem space

**Goal:** Document exactly what user scenarios this tool addresses and what it does not.

**Step 1: Enumerate user scenarios**

List concrete examples of user messages that should trigger the tool vs. ones that should not:

| Should trigger                            | Should NOT trigger                   |
| ----------------------------------------- | ------------------------------------ |
| "Explain the CAP theorem"                 | "Create a task called Fix login bug" |
| "Write me a Python function to parse CSV" | "What tasks are overdue?"            |
| "Summarize pros/cons of React vs Vue"     | "List my projects"                   |
| "What's the capital of Mongolia?"         | "Set my timezone to UTC+3"           |

**Step 2: Identify edge cases and ambiguity**

- User asks a question that touches both domains: "How should I structure a Kanban board for a mobile app project?"
- User asks something the main model can answer fine — how to avoid unnecessary escalation?
- User asks follow-up questions that depend on the deep-thinking result

**Step 3: Document constraints**

- Per-user API key and base URL — can the bigger model use the same `llm_apikey`/`llm_baseurl` or does it need separate credentials?
- Cost implications — bigger models are expensive; is there a budget concern?
- Latency — deep-thinking models can take 30-120s; how does this affect chat UX?

---

### Task 2: Research existing patterns for model routing / escalation

**Step 1: Research multi-model tool-calling patterns**

Search for prior art in:

- Vercel AI SDK docs — does `generateText` support multi-model routing natively?
- OpenAI / Anthropic / Google — any official "thinking" or "reasoning" APIs?
- Open-source projects — any chat bots that implement model escalation as a tool?

**Step 2: Investigate Vercel AI SDK capabilities**

Using the Vercel AI SDK docs:

- Can `generateText` be called inside a tool's `execute` function? (nested LLM call)
- Are there token budget or timeout considerations?
- Does the SDK support streaming a tool result back? (probably not relevant since the result is returned as a tool output)

**Step 3: Investigate "thinking" / "reasoning" model APIs**

Research current state (as of early 2026) of:

- OpenAI o1/o3/o4-mini reasoning models — API differences from standard chat models
- Anthropic Claude extended thinking — any API-level changes needed?
- Google Gemini thinking mode
- DeepSeek R1 / QwQ — open-weight reasoning models
- Key questions: Do these require special parameters? Different pricing? Different SDKs?

**Step 4: Document findings**

Summarize which patterns exist and their trade-offs:

| Pattern                                          | Pros                               | Cons                              |
| ------------------------------------------------ | ---------------------------------- | --------------------------------- |
| Tool calls nested LLM                            | Simple, fits existing architecture | Latency, cost, token counting     |
| Router model decides before main model           | Saves tokens on main model         | Extra latency, complexity         |
| User explicitly triggers (e.g. `/think` command) | No misrouting                      | Poor UX, user must know to use it |
| Main model self-escalates via tool               | Natural UX, LLM decides            | May over/under-escalate           |

---

### Task 3: Evaluate configuration approaches

**Step 1: Identify what needs to be configurable**

- Model name (e.g., `o3`, `claude-sonnet-4`, `gemini-2.5-pro`)
- API key — same as `llm_apikey` or separate?
- Base URL — same as `llm_baseurl` or separate?
- Max tokens / budget per call
- Whether the feature is enabled at all

**Step 2: Assess config key options**

Option A: Reuse existing keys + add `thinking_model` key only

```
/set thinking_model o3
```

- Pro: Simple, one new key
- Con: Assumes same provider/API key for both models

Option B: Separate provider config for the thinking model

```
/set thinking_apikey sk-...
/set thinking_baseurl https://api.openai.com/v1
/set thinking_model o3
```

- Pro: User can use a different provider (e.g., main=local Ollama, thinking=OpenAI)
- Con: Three new config keys, more setup friction

Option C: Single compound config key

```
/set thinking_model provider:model (e.g. openai:o3)
```

- Pro: Compact
- Con: Non-standard, needs custom parsing

**Step 3: Evaluate against existing config patterns**

Check how `main_model`, `small_model`, `embedding_model` are structured — do they share `llm_apikey`/`llm_baseurl`? Document whether the thinking model should follow the same pattern or diverge.

---

### Task 4: Evaluate the tool interface design

**Step 1: Draft tool schema options**

Option A — Minimal (LLM constructs the prompt):

```typescript
tool({
  description: 'Forward a question to a more capable LLM for a deeper, more complete answer',
  inputSchema: z.object({
    question: z.string().describe('The question or prompt to send to the thinking model'),
  }),
})
```

Option B — With context passing:

```typescript
tool({
  description: 'Forward a question to a more capable LLM for a deeper answer',
  inputSchema: z.object({
    question: z.string().describe('The question or prompt to send'),
    context: z.string().optional().describe('Relevant context from the conversation'),
    format: z.enum(['concise', 'detailed']).optional().describe('Desired response format'),
  }),
})
```

Option C — With system prompt customization:

```typescript
tool({
  description: 'Forward a question to a more capable LLM',
  inputSchema: z.object({
    question: z.string().describe('The question or prompt to send'),
    systemPrompt: z.string().optional().describe('Custom system instructions for the thinking model'),
  }),
})
```

**Step 2: Evaluate each schema option**

Consider:

- Does the main LLM reliably construct good prompts for the tool?
- Should the tool inject conversation history into the thinking model call?
- Should the tool have a system prompt? If so, static or configurable?
- How large can the response be? Should it be truncated?

**Step 3: Evaluate return value design**

What should the tool return to the main LLM?

- Raw text from the thinking model?
- Structured `{ answer: string, model: string, tokensUsed: number }`?
- Should the main LLM summarize/reformat the answer, or pass it through verbatim?

---

### Task 5: Analyze security and safety concerns

**Step 1: Prompt injection risks**

- The user's question is forwarded to a second model — can a malicious user exploit this to extract the system prompt or API key of the second model?
- Can the thinking model's response inject tool calls or instructions back into the main model?

**Step 2: Cost and abuse concerns**

- Thinking models are expensive — is there a risk of runaway costs?
- Should there be rate limiting per user?
- Should there be a token budget per call?

**Step 3: Data privacy**

- The user's question is sent to a potentially different provider — is this acceptable?
- Should there be a disclosure or consent mechanism?

---

### Task 6: Analyze UX and system prompt implications

**Step 1: System prompt changes**

- How does the main model know when to use the tool vs. answer directly?
- Draft system prompt additions that guide the LLM's decision-making
- Consider: should the LLM be instructed to prefer its own knowledge first?

**Step 2: Response formatting**

- Should the bot indicate that the answer came from a different model? (e.g., "🧠 Deep answer:" prefix)
- Should there be a typing/thinking indicator while waiting?
- How to handle very long responses from the thinking model?

**Step 3: Error handling UX**

- What happens if the thinking model is unavailable?
- What if it returns an empty response?
- What if the user hasn't configured `thinking_model`?
- Should the main model gracefully fall back to its own answer?

---

### Task 7: Evaluate capability gating strategy

**Step 1: When should the tool be available?**

Options:

- Always available (any user with `main_model` configured)
- Only when `thinking_model` is configured
- Only when a feature flag is enabled

**Step 2: Capability gating pattern**

The tool doesn't depend on `TaskProvider` capabilities — it's a standalone LLM tool like `save_memo` or `save_instruction`. Evaluate whether:

- It belongs in `makeTools()` ungated
- It should be gated on `thinking_model` config presence
- It should be a separate function like `addMemoTools()`

---

### Task 8: Write the design document

**Step 1: Compile findings from Tasks 1–7**

Aggregate all research into a structured design document.

**Step 2: Present 2-3 approaches with trade-offs**

Based on findings, recommend a primary approach:

1. **MVP approach** — single new config key (`thinking_model`), reuses `llm_apikey`/`llm_baseurl`, minimal tool schema, LLM-decided routing
2. **Flexible approach** — separate provider config, structured schema with context, configurable system prompt
3. **User-triggered approach** — `/think` command instead of a tool, explicit user control

**Step 3: Write the design document**

Save to `docs/plans/YYYY-MM-DD-deep-thinking-tool-design.md` with:

- Problem statement
- User scenarios
- Technical findings (SDK capabilities, model APIs, security)
- Approach comparison table
- Recommended approach with rationale
- Open questions for user input
- Config key changes
- System prompt changes
- Tool schema
- Error handling strategy
- Testing strategy

---

## Research Sources Checklist

- [ ] Vercel AI SDK docs — nested `generateText` in tool execute
- [ ] Vercel AI SDK docs — `@ai-sdk/openai-compatible` provider options
- [ ] OpenAI API docs — reasoning model differences (o1/o3/o4-mini)
- [ ] Anthropic API docs — extended thinking
- [ ] Open-source chat bot projects with model routing
- [ ] Existing papai code — `small_model` usage pattern for reference
- [ ] Existing papai code — tool definition patterns for consistency
- [ ] Security research — prompt injection in multi-model architectures

## Deliverable

`docs/plans/YYYY-MM-DD-deep-thinking-tool-design.md` — a complete design document with recommended approach, ready for user review before implementation planning begins.
