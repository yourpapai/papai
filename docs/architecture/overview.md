<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Architecture Overview

## Runtime Scope

- Included roots: src, client
- Excluded prefixes: tests/, scripts/, review-loop/, docs/architecture/, client/stories/

## Server Areas

- attachments -> chat, shared/runtime
- chat -> attachments, deferred-prompts, instances, llm-orchestrator, message-queue, providers/plugins, settings/debug, shared/runtime
- deferred-prompts -> attachments, chat, llm-orchestrator, memory/memos, message-queue, providers/plugins, settings/debug, shared/runtime, tools
- identity -> settings/debug, shared/runtime
- instances -> chat, providers/plugins, shared/runtime
- llm-orchestrator -> attachments, chat, identity, memory/memos, providers/plugins, settings/debug, shared/runtime, tools
- mcp/web -> shared/runtime, stats/usage
- memory/memos -> settings/debug, shared/runtime
- message-queue -> settings/debug, shared/runtime
- providers/plugins -> deferred-prompts, identity, instances, mcp/web, settings/debug, shared/runtime, tools
- settings/debug -> chat, deferred-prompts, identity, instances, mcp/web, memory/memos, providers/plugins, shared/runtime, stats/usage, tools
- stats/usage -> chat, settings/debug, shared/runtime
- tools -> attachments, chat, deferred-prompts, identity, mcp/web, memory/memos, providers/plugins, shared/runtime

## Client Surfaces

- admin -> shared
- debug -> settings/debug, shared
- settings -> shared

## Auxiliary Runtime Buckets

- shared/runtime -> attachments, chat, deferred-prompts, instances, llm-orchestrator, memory/memos, message-queue, providers/plugins, settings/debug, stats/usage, tools
- shared -> none

## Canonical Raw Graph

- raw/dependency-cruiser.json
