// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { requirePluginContext, type HttpFetch, type PluginToolRuntimeContextLike } from './context.ts'
import { searchInputSchema } from './input-schema.ts'

const API_ENDPOINT = 'https://api.synthetic.new/v2/search'

type SearchInput = { query: string; max_length: number; index?: number }

type SearchResult = { url: string; title: string; text: string; published?: string }

type IntegerBounds = { minimum: number; maximum: number | undefined; defaultValue: number | undefined }

class ValidationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readRequiredString(record: Record<string, unknown>, key: string, errorMessage: string): string {
  const value = record[key]
  if (typeof value !== 'string') {
    throw new ValidationError(errorMessage)
  }
  return value
}

function readOptionalString(record: Record<string, unknown>, key: string, errorMessage: string): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new ValidationError(errorMessage)
  }
  return value
}

function readOptionalBoundedInteger(
  record: Record<string, unknown>,
  key: string,
  options: IntegerBounds,
): number | undefined {
  const value = record[key]
  if (value === undefined) return options.defaultValue
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError(`${key} must be an integer`)
  }
  if (value < options.minimum) {
    throw new ValidationError(`${key} must be greater than or equal to ${options.minimum}`)
  }
  if (options.maximum !== undefined && value > options.maximum) {
    throw new ValidationError(`${key} must be less than or equal to ${options.maximum}`)
  }
  return value
}

function parseSearchInput(input: unknown): SearchInput {
  if (!isRecord(input)) {
    throw new ValidationError('input must be an object')
  }

  const query = readRequiredString(input, 'query', 'query must be a string')
  if (query.length > 400) {
    throw new ValidationError('query must be less than or equal to 400 characters')
  }

  const maxLength = readOptionalBoundedInteger(input, 'max_length', {
    minimum: 0,
    maximum: 10000,
    defaultValue: 0,
  })
  const index = readOptionalBoundedInteger(input, 'index', { minimum: 0, maximum: undefined, defaultValue: undefined })

  let normalizedMaxLength = 0
  if (maxLength !== undefined) {
    normalizedMaxLength = maxLength
  }

  return {
    query,
    max_length: normalizedMaxLength,
    ...(index === undefined ? {} : { index }),
  }
}

function parseSearchResult(input: unknown): SearchResult {
  if (!isRecord(input)) {
    throw new ValidationError('search result must be an object')
  }

  const published = readOptionalString(input, 'published', 'result published must be a string')

  return {
    url: readRequiredString(input, 'url', 'result url must be a string'),
    title: readRequiredString(input, 'title', 'result title must be a string'),
    text: readRequiredString(input, 'text', 'result text must be a string'),
    ...(published === undefined ? {} : { published }),
  }
}

function parseSearchResponse(input: unknown): { results: SearchResult[] } {
  if (!isRecord(input)) {
    throw new ValidationError('search response must be an object')
  }

  const results = input['results']
  if (!Array.isArray(results)) {
    throw new ValidationError('results must be an array')
  }

  return { results: results.map((result) => parseSearchResult(result)) }
}

function truncate(text: string, maxLength: number): string {
  if (maxLength < 0) return text
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text
}

function processSearchResults(results: SearchResult[], parsed: SearchInput): unknown {
  if (results.length === 0) {
    return { results: [] }
  }

  let selectedResults: SearchResult[] = results

  if (parsed.index !== undefined) {
    if (parsed.index >= results.length) {
      return {
        error: 'index_out_of_range',
        message: `Index ${parsed.index} is out of range (only ${results.length} result${results.length === 1 ? '' : 's'} available)`,
      }
    }
    selectedResults = [results[parsed.index]!]
  }

  let charsPerResult = Infinity
  if (parsed.max_length > 0 && selectedResults.length > 0) {
    charsPerResult = Math.floor(parsed.max_length / selectedResults.length)
  }

  return {
    results: selectedResults.map((result) => ({
      title: result.title,
      url: result.url,
      text: truncate(result.text, charsPerResult),
      published: result.published,
    })),
  }
}

function resolveRateLimitActorId(runtimeContext: PluginToolRuntimeContextLike): string {
  if (runtimeContext.chatUserId !== '') return runtimeContext.chatUserId
  return runtimeContext.storageContextId
}

async function fetchSearchApiResults(
  parsed: SearchInput,
  apiKey: string,
  abortSignal: AbortSignal | undefined,
  httpFetch: HttpFetch,
): Promise<unknown> {
  const response = await httpFetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: parsed.query }),
    signal: abortSignal,
  })

  if (!response.ok) {
    const errorText = await response.text()
    return { error: 'api_error', status: response.status, message: errorText }
  }

  const data: unknown = await response.json()
  const validated = parseSearchResponse(data)
  return processSearchResults(validated.results, parsed)
}

function buildSearchExecutionError(err: unknown): unknown {
  if (err instanceof ValidationError) {
    return { error: 'validation_error', message: err.message }
  }
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof Error && err.name === 'AbortError') {
    return { error: 'timeout', message }
  }
  return { error: 'network_error', message }
}

async function executeSearch(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  abortSignal: AbortSignal | undefined,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  const rateResult = runtimeContext.rateLimit.check(resolveRateLimitActorId(runtimeContext))
  if (!rateResult.allowed) {
    return { error: 'rate_limited', retryAfterSec: rateResult.retryAfterSec }
  }

  const apiKey = runtimeContext.adminConfig.get('api_key')

  if (apiKey === undefined || httpFetch === undefined) {
    return { error: 'not_configured', message: 'Synthetic API key is not configured' }
  }

  const parsed = parseSearchInput(input)

  try {
    return await fetchSearchApiResults(parsed, apiKey, abortSignal, httpFetch)
  } catch (err) {
    return buildSearchExecutionError(err)
  }
}

const factory = (): {
  activate(ctx: unknown): void
  deactivate(ctx: unknown): void
} => {
  let httpFetch: HttpFetch | undefined

  return {
    activate(ctx: unknown): void {
      const pluginContext = requirePluginContext(ctx)
      const providerRuntime = pluginContext.providerRuntime
      httpFetch = providerRuntime === undefined ? undefined : providerRuntime.httpFetch

      pluginContext.log.info({}, 'synthetic-web-search plugin activated')

      pluginContext.registration.registerTool({
        name: 'search',
        description: 'Uses a search engine which returns title, url, and content in markdown',
        inputSchema: searchInputSchema,
        execute: (
          input: unknown,
          runtimeContext: PluginToolRuntimeContextLike,
          options: { abortSignal: AbortSignal | undefined },
        ) => executeSearch(input, runtimeContext, options.abortSignal, httpFetch),
      })

      pluginContext.registration.registerPromptFragment({
        name: 'web-search-hint',
        content:
          'When the user asks a question that requires up-to-date information not in your training data, use the search tool to find relevant web content. Use web_fetch to read full page content when a search result looks promising.',
      })
    },

    deactivate(ctx: unknown): void {
      const pluginContext = requirePluginContext(ctx)
      pluginContext.log.info({}, 'synthetic-web-search plugin deactivated')
    },
  }
}

export default factory
