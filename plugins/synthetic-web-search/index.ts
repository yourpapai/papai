// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

type PluginToolLike = {
  name: string
  description: string
  execute: (
    input: unknown,
    runtimeContext: PluginToolRuntimeContextLike,
    options: { abortSignal?: AbortSignal },
  ) => Promise<unknown>
}

type PluginContextLike = {
  log: {
    info(data: Record<string, unknown>, message: string): void
  }
  providerRuntime?: {
    httpFetch?: (url: string, init?: RequestInit) => Promise<Response>
  }
  registration: {
    registerTool(tool: PluginToolLike): void
    registerPromptFragment(fragment: { name: string; content: string | (() => string) }): void
  }
}

type PluginToolRuntimeContextLike = {
  chatUserId: string
  storageContextId: string
  adminConfig: {
    get(key: string): string | undefined
  }
  rateLimit: {
    check(actorId: string): { allowed: boolean; retryAfterSec?: number }
  }
}

type PluginFactoryLike = () => {
  activate(ctx: PluginContextLike): void
  deactivate?(ctx: PluginContextLike): void
}

const API_ENDPOINT = 'https://api.synthetic.new/v2/search'

type SearchInput = {
  query: string
  max_length: number
  index?: number
}

type SearchResult = {
  url: string
  title: string
  text: string
  published?: string
}

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
  options: { minimum: number; maximum?: number; defaultValue?: number },
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
  const index = readOptionalBoundedInteger(input, 'index', { minimum: 0 })

  return {
    query,
    max_length: maxLength ?? 0,
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

async function executeSearch(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  abortSignal: AbortSignal | undefined,
  httpFetch: ((url: string, init?: RequestInit) => Promise<Response>) | undefined,
): Promise<unknown> {
  const rateResult = runtimeContext.rateLimit.check(runtimeContext.chatUserId || runtimeContext.storageContextId)
  if (!rateResult.allowed) {
    return { error: 'rate_limited', retryAfterSec: rateResult.retryAfterSec }
  }

  const apiKey = runtimeContext.adminConfig.get('api_key')

  if (apiKey === undefined || httpFetch === undefined) {
    return { error: 'not_configured', message: 'Synthetic API key is not configured' }
  }

  const parsed = parseSearchInput(input)

  try {
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
  } catch (err) {
    if (err instanceof ValidationError) {
      return { error: 'validation_error', message: err.message }
    }
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof Error && err.name === 'AbortError') {
      return { error: 'timeout', message }
    }
    return { error: 'network_error', message }
  }
}

const factory: PluginFactoryLike = () => {
  let httpFetch: ((url: string, init?: RequestInit) => Promise<Response>) | undefined

  return {
    activate(ctx: PluginContextLike): void {
      httpFetch = ctx.providerRuntime?.httpFetch

      ctx.log.info({}, 'synthetic-web-search plugin activated')

      ctx.registration.registerTool({
        name: 'search',
        description: 'Uses a search engine which returns title, url, and content in markdown',
        execute: (input: unknown, runtimeContext: PluginToolRuntimeContextLike, options) =>
          executeSearch(input, runtimeContext, options.abortSignal, httpFetch),
      })

      ctx.registration.registerPromptFragment({
        name: 'web-search-hint',
        content:
          'When the user asks a question that requires up-to-date information not in your training data, use the search tool to find relevant web content. Use web_fetch to read full page content when a search result looks promising.',
      })
    },

    deactivate(ctx: PluginContextLike): void {
      ctx.log.info({}, 'synthetic-web-search plugin deactivated')
    },
  }
}

export default factory
