// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { AGENTS, AUTH_METHODS, FORGE_KINDS, PROVIDERS, type CodingNamespace } from '../../coding-credentials/types.js'

export type FieldMeta = {
  key: string
  label: string
  required: boolean
  sensitive: boolean
  control?: 'select' | 'combobox'
  options?: readonly string[]
}

export const FIELDS_META: Record<CodingNamespace, readonly FieldMeta[]> = {
  'agent-provider': [
    {
      key: 'agent',
      label: 'Coding agent',
      required: true,
      sensitive: false,
      control: 'select',
      options: AGENTS,
    },
    {
      key: 'provider',
      label: 'Model provider',
      required: true,
      sensitive: false,
      control: 'select',
      options: PROVIDERS,
    },
    {
      key: 'auth_method',
      label: 'Auth method',
      required: false,
      sensitive: false,
      control: 'select',
      options: AUTH_METHODS,
    },
    {
      key: 'provider_api_key',
      label: 'API key',
      required: true,
      sensitive: true,
    },
    {
      key: 'provider_base_url',
      label: 'Base URL',
      required: false,
      sensitive: false,
    },
    {
      key: 'model',
      label: 'Model',
      required: false,
      sensitive: false,
      control: 'combobox',
    },
  ],
  forge: [
    {
      key: 'kind',
      label: 'Code host',
      required: true,
      sensitive: false,
      control: 'select',
      options: FORGE_KINDS,
    },
    {
      key: 'instance_url',
      label: 'Instance URL (enterprise / self-hosted)',
      required: false,
      sensitive: false,
    },
    {
      key: 'forge_token',
      label: 'Access token',
      required: true,
      sensitive: true,
    },
  ],
  mcp: [
    {
      key: 'upstream_url',
      label: 'Upstream MCP server URL',
      required: true,
      sensitive: false,
    },
    {
      key: 'upstream_header',
      label: 'Auth header name',
      required: false,
      sensitive: false,
    },
    {
      key: 'upstream_token',
      label: 'Upstream token',
      required: true,
      sensitive: true,
    },
  ],
}
