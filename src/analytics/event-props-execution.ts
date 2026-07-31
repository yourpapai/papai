// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import {
  ByteBucketSchema,
  ErrorClassSchema,
  KnownToolSlugSchema,
  PseudonymSchema,
  StatusClassSchema,
} from './controlled-types.js'

const NonNegativeInt = z.number().int().nonnegative()
const NonNegativeIntNullable = z.number().int().nonnegative().nullable()

const LlmStartedPropsSchema = z
  .object({
    attempt_key: PseudonymSchema,
    model_key: PseudonymSchema,
    model_role: z.enum(['main', 'small', 'embedding', 'verifier']),
    phase: z.enum(['generation', 'embedding', 'distillation', 'verification', 'classification']),
    message_count: z.enum(['0', '1', '2', '3_5', '6_10', '11_20', '21_plus']),
    available_tool_count: z.enum(['0', '1', '2', '3_5', '6_10', '11_20', '21_plus']),
  })
  .strict()

const LlmCompletedPropsSchema = z
  .object({
    attempt_key: PseudonymSchema,
    model_key: PseudonymSchema,
    model_role: z.enum(['main', 'small', 'embedding', 'verifier']),
    duration_ms: NonNegativeInt,
    time_to_first_token_ms: NonNegativeIntNullable,
    input_tokens: NonNegativeIntNullable,
    output_tokens: NonNegativeIntNullable,
    step_count: NonNegativeInt,
    finish_reason: z.enum(['stop', 'length', 'tool_calls', 'content_filter', 'other', 'unknown']),
  })
  .strict()

const LlmFailedPropsSchema = z
  .object({
    attempt_key: PseudonymSchema,
    model_key: PseudonymSchema,
    model_role: z.enum(['main', 'small', 'embedding', 'verifier']),
    phase: z.enum(['resolution', 'request', 'stream', 'embedding', 'distillation', 'verification', 'classification']),
    error_class: ErrorClassSchema,
    retryable: z.boolean().nullable(),
    duration_ms: NonNegativeInt,
  })
  .strict()

const ToolStartedPropsSchema = z
  .object({
    tool_slug: KnownToolSlugSchema,
    tool_key: PseudonymSchema,
    origin: z.enum(['core', 'first_party_plugin', 'external_plugin', 'user_mcp']),
    domain: z.enum(['task', 'memo', 'schedule', 'attachment', 'web', 'identity', 'coding', 'config', 'meta', 'other']),
    risk: z.enum(['read', 'write', 'destructive', 'open_world']),
    model_role: z.enum(['main', 'small']),
    args_bytes: ByteBucketSchema,
  })
  .strict()

const ToolCompletedPropsSchema = z
  .object({
    tool_slug: KnownToolSlugSchema,
    tool_key: PseudonymSchema,
    origin: z.enum(['core', 'first_party_plugin', 'external_plugin', 'user_mcp']),
    domain: z.enum(['task', 'memo', 'schedule', 'attachment', 'web', 'identity', 'coding', 'config', 'meta', 'other']),
    risk: z.enum(['read', 'write', 'destructive', 'open_world']),
    model_role: z.enum(['main', 'small']),
    args_bytes: ByteBucketSchema,
    duration_ms: NonNegativeInt,
    execution_outcome: z.enum(['semantic_success', 'structured_failure', 'thrown_failure', 'permission_denied']),
    result_bytes: ByteBucketSchema,
    error_class: ErrorClassSchema.nullable(),
    status_class: StatusClassSchema,
    retryable: z.boolean().nullable(),
    recovered_same_turn: z.boolean(),
  })
  .strict()

const ConfirmationRequestedPropsSchema = z
  .object({
    tool_slug: KnownToolSlugSchema,
    tool_key: PseudonymSchema,
    risk: z.enum(['read', 'write', 'destructive', 'open_world']),
    timeout_ms: z.literal(300_000),
  })
  .strict()

const ConfirmationResolvedPropsSchema = z
  .object({
    tool_slug: KnownToolSlugSchema,
    tool_key: PseudonymSchema,
    decision: z.enum(['granted', 'denied', 'ignored', 'prompt_failed']),
    decision_latency_ms: NonNegativeInt,
  })
  .strict()

const ProviderRequestCompletedPropsSchema = z
  .object({
    provider: z.enum(['kaneo', 'youtrack', 'magi', 'mcp', 'llm', 'other']),
    operation: z.enum(['read', 'search', 'create', 'update', 'delete', 'connect', 'stream', 'other']),
    duration_ms: NonNegativeInt,
    outcome: z.enum(['success', 'failure']),
    status_class: StatusClassSchema,
    retryable: z.boolean().nullable(),
  })
  .strict()

const McpAvailabilityPropsSchema = z
  .object({
    origin: z.enum(['user_endpoint', 'plugin_endpoint', 'coding_broker']),
    server_key: PseudonymSchema,
    outcome: z.enum(['available', 'connection_failed', 'timeout', 'auth_failed', 'policy_blocked']),
  })
  .strict()

export const ExecutionEventPropsSchemas = {
  llm_started: LlmStartedPropsSchema,
  llm_completed: LlmCompletedPropsSchema,
  llm_failed: LlmFailedPropsSchema,
  tool_started: ToolStartedPropsSchema,
  tool_completed: ToolCompletedPropsSchema,
  confirmation_requested: ConfirmationRequestedPropsSchema,
  confirmation_resolved: ConfirmationResolvedPropsSchema,
  provider_request_completed: ProviderRequestCompletedPropsSchema,
  mcp_availability: McpAvailabilityPropsSchema,
}
