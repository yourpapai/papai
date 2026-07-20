// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { TOOL_METADATA } from './tool-metadata.js'

/**
 * Static snapshot of builtin tool names that may appear in a `ToolSet` produced
 * by `buildTools` / `buildProviderlessTools`.
 *
 * Approach: derive from `TOOL_METADATA` (the canonical per-tool classification
 * table maintained in `src/tools/tool-metadata.ts`). This avoids a second
 * hand-curated list drifting out of sync — every builtin tool already has to be
 * listed there for risk/domain classification, so the keys are the authoritative
 * name set.
 *
 * Trade-off vs. alternatives:
 * - Inspecting `tools-builder.ts` imports would require fragile name-derivation
 *   (file `add-comment.ts` → key `add_comment`): the filename-to-key mapping is
 *   not uniform.
 * - Building the tool set with a stub provider would couple enumeration to the
 *   full builder pipeline and provider capabilities, missing capability-gated
 *   tools that the LLM may still reference in entry-point hints.
 * - Hardcoding an independent array duplicates the metadata table.
 *
 * `TOOL_METADATA` excludes plugin/MCP tools (those names are dynamic), which is
 * the desired scope here: plugin/MCP tools cannot be statically enumerated, and
 * the closure verifier treats unresolvable hints as a separate signal.
 */
export const BUILTIN_TOOL_NAMES: readonly string[] = Object.freeze(Object.keys(TOOL_METADATA))
