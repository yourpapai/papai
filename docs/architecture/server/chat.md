<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# chat

## Paths

- src/bot.ts
- src/chat/capabilities.ts
- src/chat/command-auth.ts
- src/chat/context-types.ts
- src/chat/deferred-target.ts
- src/chat/delivery-routing.ts
- src/chat/discord/button-dispatch.ts
- src/chat/discord/buttons.ts
- src/chat/discord/client-factory.ts
- src/chat/discord/commands.ts
- src/chat/discord/context-renderer.ts
- src/chat/discord/format-chunking.ts
- src/chat/discord/format.ts
- src/chat/discord/index.ts
- src/chat/discord/interaction-helpers.ts
- src/chat/discord/label-helpers.ts
- src/chat/discord/map-message.ts
- src/chat/discord/mention-helpers.ts
- src/chat/discord/metadata.ts
- src/chat/discord/reply-context.ts
- src/chat/discord/reply-helpers.ts
- src/chat/discord/send-message.ts
- src/chat/discord/type-guards.ts
- src/chat/interaction-router.ts
- src/chat/kontur-talk/config.ts
- src/chat/kontur-talk/context-renderer.ts
- src/chat/kontur-talk/index.ts
- src/chat/kontur-talk/label-helpers.ts
- src/chat/kontur-talk/metadata.ts
- src/chat/kontur-talk/reply-helpers.ts
- src/chat/kontur-talk/schema.ts
- src/chat/mattermost/action-callbacks.ts
- src/chat/mattermost/action-secret.ts
- src/chat/mattermost/action-signing.ts
- src/chat/mattermost/channel-helpers.ts
- src/chat/mattermost/config.ts
- src/chat/mattermost/context-metadata.ts
- src/chat/mattermost/context-renderer.ts
- src/chat/mattermost/file-helpers.ts
- src/chat/mattermost/index.ts
- src/chat/mattermost/label-helpers.ts
- src/chat/mattermost/message-normalization.ts
- src/chat/mattermost/metadata.ts
- src/chat/mattermost/reply-context.ts
- src/chat/mattermost/reply-helpers.ts
- src/chat/mattermost/schema.ts
- src/chat/permission-prompt.ts
- src/chat/provider-descriptor.ts
- src/chat/registry.ts
- src/chat/router-helpers.ts
- src/chat/router-types.ts
- src/chat/router.ts
- src/chat/scoped-context.ts
- src/chat/source-instance.ts
- src/chat/startup.ts
- src/chat/telegram/commands.ts
- src/chat/telegram/context-renderer.ts
- src/chat/telegram/file-fetcher.ts
- src/chat/telegram/file-helpers.ts
- src/chat/telegram/format.ts
- src/chat/telegram/forum-topic-helpers.ts
- src/chat/telegram/index.ts
- src/chat/telegram/interaction-helpers.ts
- src/chat/telegram/label-helpers.ts
- src/chat/telegram/message-extraction.ts
- src/chat/telegram/metadata.ts
- src/chat/telegram/reply-context-helpers.ts
- src/chat/telegram/reply-helpers.ts
- src/chat/types.ts

## Depends On

- attachments
- deferred-prompts
- instances
- llm-orchestrator
- message-queue
- providers/plugins
- settings/debug
- shared/runtime

## Depended On By

- attachments
- deferred-prompts
- instances
- llm-orchestrator
- settings/debug
- shared/runtime
- stats/usage
- tools
