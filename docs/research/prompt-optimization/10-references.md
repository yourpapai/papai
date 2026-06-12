<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# 10 — References

External sources cited in this report. Each entry lists the canonical URL, the publisher, and a one-line summary of what we cite it for. Initial audit accessed 2026-04-21; refreshed 2026-06-12.

## Core guidance

1. **Anthropic — _Building Effective Agents_.** https://www.anthropic.com/engineering/building-effective-agents
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

9. **Anthropic — _Prompting best practices_.** https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
   Current Claude guidance for examples, XML tags, output style, role prompting, and negative-prompting cautions. Cited in [`02`](./02-system-prompt-flaws.md).

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

35. **Vercel AI SDK Core — _generateText reference_.** https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text
    AI SDK v6 reference for `stopWhen`, `prepareStep`, active tools, tool choice, system/messages, and multi-step tool execution.

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

## 2026-06-12 refresh additions

41. **OpenAI — _Prompting guide_.** https://developers.openai.com/api/docs/guides/prompting
    Current OpenAI guidance for task framing, examples, and prompt structure.

42. **OpenAI — _Reasoning models guide_.** https://developers.openai.com/api/docs/guides/reasoning
    Reasoning-effort tuning, tool-use planning, and defining task constraints and output formats.

43. **OpenAI — _Structured outputs guide_.** https://developers.openai.com/api/docs/guides/structured-outputs
    Schema-first response/function contracts, key naming, descriptions, and output validation.

44. **OpenAI — _Hardening OpenAI Atlas against prompt injection attacks_.** https://openai.com/index/hardening-atlas-against-prompt-injection/
    Browser-agent prompt-injection risk framing, confirmation review, and scoped instructions.

45. **OWASP Cheat Sheet Series — _LLM Prompt Injection Prevention Cheat Sheet_.** https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
    Structured prompts, remote-content sanitization, HITL controls, agent-specific defenses, and monitoring.

46. **MCP — _Tool annotations_.** https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/
    `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`; annotations are client hints, not trusted policy.

47. **Wang et al. — _Self-Consistency Improves Chain of Thought Reasoning in Language Models_.** https://arxiv.org/abs/2203.11171
    Background for offline sampling/eval strategies and high-value planning tasks.

48. **Zhou et al. — _Least-to-Most Prompting Enables Complex Reasoning in Large Language Models_.** https://arxiv.org/abs/2205.10625
    Background for decomposing complex task-management requests.

49. **Wang et al. — _Plan-and-Solve Prompting_.** https://arxiv.org/abs/2305.04091
    Background for planning-before-solving prompts and complex workflow handling.

50. **Yao et al. — _ReAct: Synergizing Reasoning and Acting in Language Models_.** https://arxiv.org/abs/2210.03629
    Background for interleaving model reasoning with tool actions and observations.

51. **Shinn et al. — _Reflexion: Language Agents with Verbal Reinforcement Learning_.** https://arxiv.org/abs/2303.11366
    Background for reflection loops and offline prompt improvement.

52. **Madaan et al. — _Self-Refine: Iterative Refinement with Self-Feedback_.** https://arxiv.org/abs/2303.17651
    Background for critique-and-revise patterns, especially offline evaluation.

53. **Yao et al. — _Tree of Thoughts: Deliberate Problem Solving with Large Language Models_.** https://arxiv.org/abs/2305.10601
    Background for branching search on complex planning problems; likely not first-cycle runtime work.

54. **Zhou et al. — _Large Language Models Are Human-Level Prompt Engineers_.** https://arxiv.org/abs/2211.01910
    Introduces Automatic Prompt Engineer (APE), useful after fixture datasets exist.

55. **Pryzant et al. — _Automatic Prompt Optimization with "Gradient Descent" and Beam Search_.** https://arxiv.org/abs/2305.03495
    Background for eval-guided prompt editing.

56. **Yang et al. — _Large Language Models as Optimizers_.** https://arxiv.org/abs/2309.03409
    Introduces OPRO-style optimization for prompts and other natural-language programs.

57. **Fernando et al. — _Promptbreeder: Self-Referential Self-Improvement via Prompt Evolution_.** https://arxiv.org/abs/2309.16797
    Background for evolutionary prompt search; later-stage only.

58. **Khattab et al. — _DSPy: Compiling Declarative Language Model Calls into Self-Improving Pipelines_.** https://arxiv.org/abs/2310.03714
    Useful for thinking about prompts as optimizable signatures/modules once papai has eval data.

59. **Liu et al. — _A Survey of Context Engineering for Large Language Models_.** https://arxiv.org/abs/2507.13334
    Context selection, compression, memory, and retrieval framing.

60. **Chen et al. — _StruQ: Defending Against Prompt Injection with Structured Queries_.** https://arxiv.org/abs/2402.06363
    Separating trusted instructions from untrusted data.

61. **Debenedetti et al. — _CaMeL: Defeating Prompt Injections by Design_.** https://arxiv.org/abs/2503.18813
    Capability and least-privilege thinking around agents that consume untrusted data.

62. **Arawjo et al. — _ChainForge: A Visual Toolkit for Prompt Engineering and LLM Hypothesis Testing_.** https://arxiv.org/abs/2309.09128
    Prompt comparison and hypothesis-testing workflow ideas.

63. **Sahoo et al. — _A Systematic Survey of Prompt Engineering in Large Language Models_.** https://arxiv.org/abs/2402.07927
    Broad taxonomy for prompt techniques and evaluation dimensions.

64. **arXiv — _WebAgentGuard: Mitigating the Prompt Injection Attack in Web Browsing Agent_.** https://arxiv.org/abs/2604.12284
    Recent 2026 web-agent prompt-injection defense work; useful as a watch-list item rather than immediate design dependency.

65. **Vercel AI SDK Core — _streamText reference_.** https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text
    Companion reference for streaming agent loops, `stopWhen`, and `prepareStep`.

---

All URLs accessed and verified at time of writing. Where a search surfaced multiple copies (blog mirror vs original), the original source is preferred.
