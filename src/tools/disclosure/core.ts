// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Domain-essential tools that are always active under progressive disclosure. */
export const CORE_TOOL_NAMES: ReadonlySet<string> = new Set(['get_current_time'])

/** Disclosure machinery, always active. expand_result is registered by the compaction flag. */
export const META_TOOL_NAMES: ReadonlySet<string> = new Set(['search_tools', 'load_tool', 'expand_result'])

/**
 * Union of core and meta tool names that are always active under progressive disclosure.
 * Membership here does not imply registration — `expand_result` is only registered when
 * the compaction flag is on, so consumers must intersect with the actually-registered tool
 * set (the DisclosureSession does this).
 */
export const ALWAYS_ON_TOOL_NAMES: ReadonlySet<string> = new Set([...CORE_TOOL_NAMES, ...META_TOOL_NAMES])

/** Steps with zero load_tool activity after which disclosure opens all tools (fail-safe). */
export const DISCLOSURE_STALL_STEPS = 2
