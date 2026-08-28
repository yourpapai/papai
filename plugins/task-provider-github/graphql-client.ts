// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import {
  classifyProviderError,
  classifyStatusClass,
  createProviderRequestClock,
} from '../../src/analytics/provider-observer.js'
import { requireProviderRequestScope } from '../../src/analytics/provider-request-scope.js'
import type { ProviderRequestScope } from '../../src/analytics/provider-request-scope.js'
import { logger } from '../../src/logger.js'
import { GitHubApiError, readErrorBody, resolveApiBaseUrl } from './client.js'
import type { GitHubConfig } from './client.js'
import { GITHUB_DEFAULT_BASE_URL, GITHUB_DEFAULT_GRAPHQL_URL } from './constants.js'

const log = logger.child({ scope: 'github:graphql' })

const GHES_REST_SUFFIX = '/api/v3'

/**
 * Resolves the GraphQL endpoint from the configured REST base, composing on
 * `resolveApiBaseUrl`'s output (empty → public default, trailing slashes
 * stripped): the public REST base appends `/graphql`, a GHES `/api/v3`
 * suffix is replaced by the same origin's `/api/graphql` (sub-path prefixes
 * survive), and any other base (GHES bare origin) appends `/api/graphql`.
 */
export const resolveGraphqlEndpoint = (baseUrl: string): string => {
  const restBase = resolveApiBaseUrl(baseUrl)
  if (restBase.endsWith(GHES_REST_SUFFIX)) {
    return `${restBase.slice(0, restBase.length - GHES_REST_SUFFIX.length)}/api/graphql`
  }
  if (restBase === GITHUB_DEFAULT_BASE_URL) {
    return GITHUB_DEFAULT_GRAPHQL_URL
  }
  return `${restBase}/api/graphql`
}

type GraphqlOperation = 'read' | 'search' | 'create' | 'update' | 'delete' | 'connect' | 'stream' | 'other'

type GraphqlErrorEntry = z.infer<typeof graphqlErrorSchema>

const graphqlErrorSchema = z.looseObject({
  message: z.string(),
  type: z.string().optional(),
  extensions: z.looseObject({ type: z.string().optional() }).optional(),
})

const graphqlEnvelopeSchema = z.looseObject({
  // Optional under Zod v4: `z.unknown()` alone requires the key to be present, but
  // the GraphQL spec omits `data` entirely when a request fails before execution.
  data: z.unknown().optional(),
  errors: z.array(graphqlErrorSchema).optional(),
})

/** A GraphQL-level failure: HTTP said 2xx, but the response envelope did not. */
export class GitHubGraphqlError extends Error {
  constructor(
    message: string,
    public readonly type: string | undefined,
    public readonly errors: readonly GraphqlErrorEntry[] = [],
  ) {
    super(message)
    this.name = 'GitHubGraphqlError'
  }
}

/** Emits the controlled request observation; never throws, never carries request/response content. */
const observeBoundary = (
  scope: ProviderRequestScope,
  clock: Readonly<{ elapsedMs: () => number }>,
  operation: GraphqlOperation,
  caught: unknown,
  status: number | null,
): void => {
  if (scope.kind !== 'actor') return
  const classification =
    caught === null
      ? { statusClass: classifyStatusClass(status ?? 200), retryable: null as boolean | null }
      : classifyProviderError(caught)
  try {
    scope.observeProviderRequest(scope.requestContext, {
      provider: 'github',
      operation,
      durationMs: clock.elapsedMs(),
      outcome: caught === null ? 'success' : 'failure',
      statusClass: classification.statusClass,
      retryable: classification.retryable,
    })
  } catch {
    // Observation must never change provider behavior.
  }
}

const effectiveTypeOf = (error: GraphqlErrorEntry): string | undefined => error.extensions?.type ?? error.type

const envelopeViolation = (detail: string): GitHubGraphqlError =>
  new GitHubGraphqlError(`GitHub GraphQL envelope validation failed: ${detail}`, undefined)

const parseEnvelope = async (response: Response): Promise<z.infer<typeof graphqlEnvelopeSchema>> => {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw envelopeViolation('body is not valid JSON')
  }
  const parsed = graphqlEnvelopeSchema.safeParse(body)
  if (!parsed.success) {
    const violation = parsed.error.issues[0]
    throw envelopeViolation(violation === undefined ? 'unexpected envelope shape' : violation.message)
  }
  return parsed.data
}

/**
 * Low-level GraphQL executor: POSTs `{query, variables}` as JSON to the
 * derived endpoint with bearer auth, validates the `{data, errors}` envelope,
 * fails the whole call on any `errors[]` entry (all-or-nothing), and passes
 * `data` through untouched — payload validation belongs to the caller. The
 * operation label is explicit (`'read'` default) because one endpoint serves
 * reads and writes, so the REST method→operation mapping does not apply.
 */
export function githubGraphql(
  config: GitHubConfig,
  query: string,
  variables?: Record<string, unknown>,
  operation: GraphqlOperation = 'read',
): Promise<unknown> {
  return Promise.resolve().then(async () => {
    const scope = requireProviderRequestScope()
    const clock = createProviderRequestClock()
    let caught: unknown = null
    let status: number | null = null
    try {
      log.debug({ operation, hasVariables: variables !== undefined }, 'GitHub GraphQL request')
      const response = await fetch(resolveGraphqlEndpoint(config.baseUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
      })
      status = response.status
      if (!response.ok) {
        const errorBody = await readErrorBody(response)
        log.error({ statusCode: response.status, operation }, 'GitHub GraphQL request failed')
        throw new GitHubApiError(
          `GitHub GraphQL request failed with status ${response.status}`,
          response.status,
          response.headers,
          errorBody,
        )
      }
      const envelope = await parseEnvelope(response)
      for (const error of envelope.errors ?? []) {
        log.error({ operation, graphqlErrorType: effectiveTypeOf(error) ?? null }, 'GitHub GraphQL errors present')
        throw new GitHubGraphqlError(error.message, effectiveTypeOf(error), envelope.errors)
      }
      return envelope.data
    } catch (error) {
      caught = error
      throw error
    } finally {
      observeBoundary(scope, clock, operation, caught, status)
    }
  })
}
