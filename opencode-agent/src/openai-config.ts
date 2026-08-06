// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Config } from '@opencode-ai/sdk'

/**
 * The only model credentials this pipeline accepts: one OpenAI-compatible
 * endpoint. A base URL plus a key covers OpenAI itself, Azure-style gateways,
 * OpenRouter, vLLM and any other compatible server, so there is no reason to
 * carry provider-specific keys alongside it.
 */
export interface OpenAiSettings {
  apiKey: string
  baseUrl: string
  model: string
}

/** Provider id used in every `provider/model` reference the pipeline emits. */
export const OPENAI_PROVIDER_ID = 'openai'

/**
 * The AI SDK package OpenCode loads for this provider. The `openai-compatible`
 * driver — not the first-party `openai` one — is what makes `OPENAI_BASE_URL`
 * meaningful for non-OpenAI endpoints.
 */
const PROVIDER_NPM = '@ai-sdk/openai-compatible'

/** `openai/<model>`, the reference form both the SDK and `opencode run` expect. */
export const modelRef = (settings: OpenAiSettings): string => `${OPENAI_PROVIDER_ID}/${settings.model}`

/**
 * Builds the OpenCode configuration that pins the provider, the endpoint and
 * the model.
 *
 * The same object serves both execution paths: it is handed to
 * `createOpencodeServer({ config })` for the in-process session, and serialized
 * into `OPENCODE_CONFIG_CONTENT` for the `opencode run` subprocesses the
 * review-loop workspace spawns. One definition, so the two cannot drift.
 */
export const buildOpencodeConfig = (settings: OpenAiSettings): Config => ({
  $schema: 'https://opencode.ai/config.json',
  provider: {
    [OPENAI_PROVIDER_ID]: {
      npm: PROVIDER_NPM,
      name: 'OpenAI-compatible',
      options: { apiKey: settings.apiKey, baseURL: settings.baseUrl },
      models: { [settings.model]: { name: settings.model } },
    },
  },
  model: modelRef(settings),
  // The agent runs unattended; an "ask" permission would deadlock the job.
  permission: { edit: 'allow', bash: 'allow', webfetch: 'deny' },
})

/**
 * Environment carrying the config to a spawned `opencode` process.
 *
 * Delivered inline rather than as a file because the runner may have no
 * writable home, and because a config file inside the repo would be visible to
 * `git add --all`. **This value contains the API key** — never log it.
 */
export const opencodeConfigEnv = (settings: OpenAiSettings): Record<string, string> => ({
  OPENCODE_CONFIG_CONTENT: JSON.stringify(buildOpencodeConfig(settings)),
})
