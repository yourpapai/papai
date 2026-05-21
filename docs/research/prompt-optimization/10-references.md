<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# 10 — References

External sources cited in this report. Each entry lists the canonical URL, the publisher, and a one-line summary of what we cite it for. Accessed 2026-04-21.

## Core guidance

1. **Anthropic — _Building Effective Agents_.** https://www.anthropic.com/research/building-effective-agents
   Core framework: workflows vs agents, augmented LLMs, the five agentic patterns (prompt chaining, routing, parallelisation, orchestrator-workers, evaluator-optimiser), and the rule "add multi-step complexity only when simpler solutions fall short." Cited throughout, especially in [`00`](./00-overview.md), [`09`](./09-orchestration-routing.md).

2. **Anthropic — _Effective context engineering for AI agents_.** https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
   Treats context as a budget; recommends structured prompts with XML/markdown delimiters and just-in-time retrieval. Cited in [`02`](./02-system-prompt-flaws.md), [`07`](./07-memory-context.md).

3. **Anthropic — _Writing effective tools for AI agents_.** https://www.anthropic.com/engineering/writing-tools-for-agents
   The single richest source on tool design — naming, descriptions, output truncation with steering, response_format, error messages that teach. Cited in [`03`](./03-tool-design-schemas.md), [`04`](./04-tool-output-steering.md), [`05`](./05-error-handling-recovery.md).

4. **apxml — _Understanding Tool Specifications and Descriptions_.** https://apxml.com/courses/building-advanced-llm-agent-tools/chapter-1-llm-agent-tooling-foundations/tool-specifications-descriptions
   Concrete description-writing guidance: action-oriented verbs, clarity over terseness, parameter documentation.

5. **Vercel — _AI SDK Core: zodSchema_ / _Tool Use_.** https://ai-sdk.dev/docs/reference/ai-sdk-core/zod-schema and https://vercel.com/academy/ai-sdk/tool-use
   Reference for `tool()` definitions, `.describe()` placement at the end of the chain, inputExamples. Cited in [`03`](./03-tool-design-schemas.md).

6. **Collin Wilkins — _LLM Structured Outputs: Schema Validation for Real Pipelines (2026)_.** https://collinwilkins.com/articles/structured-output
   Best-practice schema design — flat schemas, put reasoning before answer, reliability tiers for structured outputs. Cited in [`03`](./03-tool-design-schemas.md), [`05`](./05-error-handling-recovery.md).

7. **apxml — _Handling Tool Errors and Agent Recovery_.** https://apxml.com/courses/langchain-production-llm/chapter-2-sophisticated-agents-tools/agent-error-handling
   Error-message shape for LLM consumption, self-correction loops, retry strategies. Cited in [`05`](./05-error-handling-recovery.md).

## Security

8. **OWASP — LLM01:2025 Prompt Injection.** https://genai.owasp.org/llmrisk/llm01-prompt-injection/ and https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
   The #1 LLM risk and mitigation cheat sheet. Cited in [`06`](./06-confirmation-safety.md).

## Prompt engineering for Claude

9. **Anthropic — _Prompting best practices_ (Claude 4.7 era).** https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
   Verbosity calibration for 4.7, section structure, role prompting, negative-prompting cautions. Cited in [`02`](./02-system-prompt-flaws.md).

10. **Comet — _Few-Shot Prompting for Agentic Systems: Teaching by Example_.** https://www.comet.com/site/blog/few-shot-prompting/
    Why 3–5 examples beat paragraphs of rules; specific guidance for routing and tool-calling. Cited in [`02`](./02-system-prompt-flaws.md).

11. **MindStudio — _What Is an AI Model Router?_.** https://www.mindstudio.ai/blog/what-is-ai-model-router-optimize-cost-llm-providers
    Rule-based and small-model classifier routing with concrete cost/latency numbers. Cited in [`09`](./09-orchestration-routing.md).

12. **Anthropic — _Use XML tags to structure your prompts_.** https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/use-xml-tags
    Why XML tags work for Claude, how to nest and name them.

13. **Anthropic — _Giving Claude a role with a system prompt_.** https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/system-prompts
    Persona guidance; warning against over-constrained roles; caution against heavy-handed negative prompting.

14. **PromptHub — _The Difference Between System Messages and User Messages in Prompt Engineering_.** https://www.prompthub.us/blog/the-difference-between-system-messages-and-user-messages-in-prompt-engineering
    When to use which, why "Claude follows instructions in human messages better than those in the system message" in certain configurations.

15. **Anthropic — _Effective harnesses for long-running agents_.** https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
    Initializer-agent / coding-agent split, structured progress files, JSON-over-Markdown for stateful artefacts. Cited for proactive-mode handling in [`02`](./02-system-prompt-flaws.md).

16. **DigitalOcean — _Few-Shot Prompting: Techniques, Examples, and Best Practices_.** https://www.digitalocean.com/community/tutorials/_few-shot-prompting-techniques-examples-best-practices
    Formatting of multi-shot examples, tag usage.

17. **Dev.to — _LLM Structured Output in 2026_.** https://dev.to/pockit_tools/llm-structured-output-in-2026-stop-parsing-json-with-regex-and-do-it-right-34pk
    Practical engineering patterns for structured output, including validation/retry loops.

## Safety and tool annotations

18. **Model Context Protocol — _Tool Annotations as Risk Vocabulary_.** https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/ and https://modelcontextprotocol.io/specification/2025-06-18/server/tools
    `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` semantics; MCP spec defaults.

19. **Anthropic — _Advanced Tool Use_.** https://www.anthropic.com/engineering/advanced-tool-use
    Structured tool output, steering via error text, `response_format` pattern.

20. **Medium / Tanishk Soni — _Error Handling & Retries: Making LLM Calls Reliable_.** https://medium.com/@sonitanishk2003/error-handling-retries-making-llm-calls-reliable-ee7722fc2ea9
    Exponential backoff, retry-worthy vs retry-futile error codes.

21. **LangChain — _Human-in-the-loop_ documentation.** https://docs.langchain.com/oss/python/langchain/human-in-the-loop
    HITL middleware patterns: interrupts, governed approval layer, policy configuration.

22. **Micheal Bee — _The Permission Loop: A Design Specification for Tool-to-LLM Confirmation_.** https://medium.com/@mbonsign/the-permission-loop-a-design-specification-for-tool-to-llm-confirmation-ff10f2b0cbce
    Halt-by-default principle, tool reports intent back to LLM, LLM requests user consent.

23. **Agent Patterns — _Human-in-the-Loop Architecture: When Humans Approve Agent Decisions_.** https://www.agentpatterns.tech/en/architecture/human-in-the-loop-architecture
    Architectural layering of HITL between agent runtime and action execution.

24. **Google DeepMind — _CaMeL_ / arXiv preprint.** https://arxiv.org/html/2506.08837v1
    Dual-LLM pattern: privileged LLM plans, quarantined LLM executes with no memory or actions.

25. **Preamble — data tagging approach to prompt injection.** Referenced via Wiz _Defending AI Systems Against Prompt Injection Attacks_: https://www.wiz.io/academy/ai-security/prompt-injection-attack
    Invisible "name tags" that mark trusted vs untrusted segments.

26. **OpenAI — _Continuously hardening ChatGPT Atlas against prompt injection attacks_.** https://openai.com/index/hardening-atlas-against-prompt-injection/
    Production lessons on system-prompt leakage and output sanitisation.

## Memory

27. **MachineLearningMastery — _The 6 Best AI Agent Memory Frameworks You Should Try in 2026_.** https://machinelearningmastery.com/the-6-best-ai-agent-memory-frameworks-you-should-try-in-2026/
    Zep, Letta, mem0 patterns — summary + entity memory, LRU + TTL, progressive summarisation.

28. **mem0 — _LLM Chat History Summarization: Best Practices and Techniques (2025)_.** https://mem0.ai/blog/llm-chat-history-summarization-guide-2025
    Rolling summarisation, context-collapse mitigation, recursive drift.

## UX / reply formatting

29. **Telegram — _Bot API formatting options_.** https://core.telegram.org/bots/api#formatting-options
    MarkdownV2 escape rules.

30. **sudoskys/telegramify-markdown.** https://github.com/sudoskys/telegramify-markdown
    Reference converter: standard Markdown → Telegram MarkdownV2 with full escape table.

31. **Mind the Product — _Nine UX best practices for AI chatbots: A product manager's guide_.** https://www.mindtheproduct.com/deep-dive-ux-best-practices-for-ai-chatbots/
    Typing indicators, progress cues, register mirroring, confidence calibration.

32. **Nielsen Norman Group — _Explainable AI in Chat Interfaces_.** https://www.nngroup.com/articles/explainable-ai/
    When to surface reasoning; cost of over-explanation; empty-state patterns.

33. **UX Studio Team — _What you need to know about chatbot UI_.** https://www.uxstudioteam.com/ux-blog/chatbot-ui
    Feedback loops, error visibility, progressive disclosure.

34. **arXiv 2603.07306 — _Seeing the Reasoning: How LLM Rationales Influence User Trust and Decision-Making_.** https://arxiv.org/html/2603.07306v1
    Empirical finding: correct rationales raise trust; wrong rationales lower it. Don't show reasoning by default.

## Vercel AI SDK specifics

35. **Vercel AI SDK Core — _streamText reference_.** https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text
    `stopWhen`, `prepareStep`, `experimental_onToolCallStart/Finish`, tool-execution observation.

36. **vercel/ai — issue #10269: Tool Execution Super Unreliable After ~5 Messages in Conversation.** https://github.com/vercel/ai/issues/10269
    Reference for the "model narrates instead of calling tools" failure mode; mitigations via `toolChoice`.

## Additional / supporting

37. **Maarten Grootendorst — _A Visual Guide to LLM Agents_.** https://newsletter.maartengrootendorst.com/p/a-visual-guide-to-llm-agents
    Diagram-heavy mental models for agent loops.

38. **Vellum AI — _The ultimate LLM agent build guide_.** https://www.vellum.ai/blog/the-ultimate-llm-agent-build-guide
    End-to-end agent architecture review; useful for benchmarking.

39. **Dev.to / aws-heroes — _MCP Tool Design: Why Your AI Agent Is Failing (And How to Fix It)_.** https://dev.to/aws-heroes/mcp-tool-design-why-your-ai-agent-is-failing-and-how-to-fix-it-40fc
    Anti-pattern examples: tool overlap, thin REST wrappers, ambiguous descriptions.

40. **Hugo Bowne-Anderson — _Patterns and Anti-Patterns for Building with LLMs_.** https://medium.com/marvelous-mlops/patterns-and-anti-patterns-for-building-with-llms-42ea9c2ddc90
    Production-grade anti-patterns; useful cross-check.

---

All URLs accessed and verified at time of writing. Where a search surfaced multiple copies (blog mirror vs original), the original source is preferred.
