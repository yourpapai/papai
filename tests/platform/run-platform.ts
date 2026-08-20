// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/platform/run-platform.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Registers every T3 platform lane in boot order. Run explicitly with
// `bun test tests/platform/run-platform.ts`; the `.platform.ts` scenario files
// use a non-discovered suffix so the default `bun test` never runs this Docker lane.
import './scenarios/mattermost-fetch-chat-link.platform.js'
import './scenarios/mattermost-thread-reply.platform.js'
import './scenarios/mattermost-status-lifecycle.platform.js'
import './scenarios/mattermost-http-action.platform.js'
import './scenarios/discord-interactions.platform.js'
import './scenarios/discord-reply-mention.platform.js'
import './scenarios/discord-live-status.platform.js'
import './scenarios/discord-callback-routing.platform.js'
import './scenarios/kontur-talk-replies.platform.js'
import './scenarios/telegram-admin-authorization.platform.js'
import './scenarios/telegram-callback-routing.platform.js'
