// tests/platform/run-platform.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Registers every T3 platform lane in boot order. Run explicitly with
// `bun test tests/platform/run-platform.ts`; the `.platform.ts` scenario files
// use a non-discovered suffix so the default `bun test` never runs this Docker lane.
import './scenarios/mattermost-fetch-chat-link.platform.js'
import './scenarios/mattermost-http-action.platform.js'
