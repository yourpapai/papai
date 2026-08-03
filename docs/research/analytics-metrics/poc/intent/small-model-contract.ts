// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import {
  isRecord,
  parseSmallModelRequest,
  parseSmallModelResult,
  type SmallModelRequest,
  type SmallModelResult,
} from './small-model-schemas.js'
import { CORE_INTENTS } from './taxonomy.js'

export {
  parseSmallModelRequest,
  parseSmallModelResult,
  type SmallModelRequest,
  type SmallModelResult,
} from './small-model-schemas.js'

export type SmallModelRunError =
  | 'CLASSIFIER_NOT_APPROVED'
  | 'CLASSIFIER_NOT_CONFIGURED'
  | 'INELIGIBLE_ACTOR'
  | 'INVALID_REQUEST'
  | 'PROVIDER_REQUEST_FAILED'
  | 'PROVIDER_RESPONSE_INVALID'

export type SmallModelRunResult =
  | Readonly<{ ok: true; result: SmallModelResult }>
  | Readonly<{ ok: false; code: SmallModelRunError }>

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface SmallModelRunOptions {
  readonly approved: boolean
  readonly endpoint: string | undefined
  readonly apiKey: string | undefined
  readonly model: string | undefined
  readonly fetchImpl?: FetchLike
}

interface ConfiguredSmallModel {
  readonly endpoint: string
  readonly apiKey: string
  readonly model: string
  readonly fetchImpl: FetchLike
}

function classifierPayload(request: SmallModelRequest): string {
  return JSON.stringify({
    model_taxonomy: {
      version: 'intent.v1',
      labels: CORE_INTENTS,
      special_labels: ['no_action', 'unknown', 'multi_goal'],
    },
    transient_input: {
      message: request.message,
      metadata: request.metadata,
    },
  })
}

function extractResponseContent(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value['choices'])) return undefined
  const first: unknown = value['choices'][0]
  if (!isRecord(first) || !isRecord(first['message'])) return undefined
  const content = first['message']['content']
  return typeof content === 'string' ? content : undefined
}

function configuredSmallModel(options: SmallModelRunOptions): ConfiguredSmallModel | undefined {
  if (
    options.endpoint === undefined ||
    options.endpoint.length === 0 ||
    options.apiKey === undefined ||
    options.apiKey.length === 0 ||
    options.model === undefined ||
    options.model.length === 0
  ) {
    return undefined
  }
  return {
    endpoint: options.endpoint,
    apiKey: options.apiKey,
    model: options.model,
    fetchImpl: options.fetchImpl ?? fetch,
  }
}

async function callProvider(request: SmallModelRequest, config: ConfiguredSmallModel): Promise<Response | undefined> {
  const prompt = await Bun.file(path.join(import.meta.dir, 'small-model-prompt.txt')).text()
  try {
    return await config.fetchImpl(config.endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: classifierPayload(request) },
        ],
      }),
    })
  } catch {
    return undefined
  }
}

async function parseProviderResponse(response: Response): Promise<SmallModelRunResult> {
  if (!response.ok) return { ok: false, code: 'PROVIDER_REQUEST_FAILED' }
  let providerPayload: unknown
  try {
    providerPayload = JSON.parse(await response.text())
  } catch {
    return { ok: false, code: 'PROVIDER_RESPONSE_INVALID' }
  }
  const content = extractResponseContent(providerPayload)
  if (content === undefined) return { ok: false, code: 'PROVIDER_RESPONSE_INVALID' }
  let resultPayload: unknown
  try {
    resultPayload = JSON.parse(content)
  } catch {
    return { ok: false, code: 'PROVIDER_RESPONSE_INVALID' }
  }
  const result = parseSmallModelResult(resultPayload)
  return result.ok ? { ok: true, result: result.value } : { ok: false, code: 'PROVIDER_RESPONSE_INVALID' }
}

export async function runSmallModel(request: unknown, options: SmallModelRunOptions): Promise<SmallModelRunResult> {
  if (!options.approved) return { ok: false, code: 'CLASSIFIER_NOT_APPROVED' }
  if (isRecord(request) && request['eligible'] === false) {
    return { ok: false, code: 'INELIGIBLE_ACTOR' }
  }
  const parsed = parseSmallModelRequest(request)
  if (!parsed.ok) return { ok: false, code: 'INVALID_REQUEST' }
  const config = configuredSmallModel(options)
  if (config === undefined) return { ok: false, code: 'CLASSIFIER_NOT_CONFIGURED' }
  const response = await callProvider(parsed.value, config)
  return response === undefined ? { ok: false, code: 'PROVIDER_REQUEST_FAILED' } : parseProviderResponse(response)
}
