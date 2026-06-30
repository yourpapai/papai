// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { HttpResponse, delay, http } from 'msw'
import type { HttpHandler } from 'msw'

const NEVER_RESOLVE_MS = 60_000
const boom = (): HttpResponse<{ error: string }> => HttpResponse.json({ error: 'boom' }, { status: 500 })

export interface HandlerFamily {
  populated: HttpHandler[]
  empty: HttpHandler[]
  error: HttpHandler[]
  loading: HttpHandler[]
}

// --- Repos (GET/POST/DELETE /settings/api/coding-repos) ---

const reposBody = (repos: unknown[]): Record<string, unknown> => ({ repos })
const reposSample = [
  {
    repoId: 'repo_abc123',
    name: 'my-project',
    repoUrl: 'https://github.com/org/my-project.git',
    baseBranch: 'main',
    permissionPreset: 'cautious',
  },
  {
    repoId: 'repo_def456',
    name: 'api-service',
    repoUrl: 'https://github.com/org/api-service.git',
    baseBranch: 'develop',
    permissionPreset: 'readonly',
  },
]

export const reposHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/coding-repos', () => HttpResponse.json(reposBody(reposSample))),
    http.post('/settings/api/coding-repos', () => HttpResponse.json({ ok: true })),
    http.delete('/settings/api/coding-repos', () => HttpResponse.json({ ok: true })),
  ],
  empty: [http.get('/settings/api/coding-repos', () => HttpResponse.json(reposBody([])))],
  error: [http.get('/settings/api/coding-repos', boom)],
  loading: [
    http.get('/settings/api/coding-repos', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(reposBody([]))
    }),
  ],
}

// --- BYOK (GET/PATCH /settings/api/byok) ---

const byokSecretSet = {
  enabled: true,
  complete: true,
  missing: [],
  fields: [
    {
      key: 'ANTHROPIC_API_KEY',
      label: 'Anthropic API Key',
      required: true,
      sensitive: true,
      hasValue: true,
      value: '****WvfQ',
    },
  ],
}
const byokMissing = {
  enabled: true,
  complete: false,
  missing: ['ANTHROPIC_API_KEY'],
  fields: [
    {
      key: 'ANTHROPIC_API_KEY',
      label: 'Anthropic API Key',
      required: true,
      sensitive: true,
      hasValue: false,
      value: '',
    },
    { key: 'LLM_MODEL', label: 'Model', required: false, sensitive: false, hasValue: true, value: 'claude-opus-4-5' },
  ],
}
const byokDisabled = { enabled: false, complete: false, missing: ['ANTHROPIC_API_KEY'], fields: [] }

const byokFamily = (body: Record<string, unknown>): HandlerFamily['populated'] => [
  http.get('/settings/api/byok', () => HttpResponse.json(body)),
  http.patch('/settings/api/byok', () => HttpResponse.json(body)),
]

export const byokHandlers = {
  secretSet: byokFamily(byokSecretSet),
  missing: byokFamily(byokMissing),
  disabled: byokFamily(byokDisabled),
  error: [http.get('/settings/api/byok', boom)],
  loading: [
    http.get('/settings/api/byok', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(byokDisabled)
    }),
  ],
}

// --- Kaneo (GET/POST /settings/api/kaneo/credentials) ---

export const kaneoHandlers = {
  populated: [
    http.get('/settings/api/kaneo/credentials', () =>
      HttpResponse.json({
        contextId: 'ctx-personal-1',
        login: 'alice@example.com',
        status: 'active',
        kaneoUrl: 'https://workspace.kaneo.app',
      }),
    ),
    http.post('/settings/api/kaneo/credentials', () =>
      HttpResponse.json({ password: 's3cr3tP@ssw0rd!', warning: 'This password will not be shown again.' }),
    ),
  ],
  notProvisioned: [http.get('/settings/api/kaneo/credentials', () => new HttpResponse(null, { status: 404 }))],
  error: [http.get('/settings/api/kaneo/credentials', boom)],
  loading: [
    http.get('/settings/api/kaneo/credentials', async () => {
      await delay(NEVER_RESOLVE_MS)
      return new HttpResponse(null, { status: 404 })
    }),
  ],
}

// --- Admin users (GET/POST/DELETE /settings/api/admin/users + open-access) ---

const adminUsersSample = {
  users: [
    {
      platform_user_id: '123456789',
      platform_instance_id: 'tg-main',
      username: 'alice_tg',
      added_by: 'admin',
      blocked_at: null,
    },
    {
      platform_user_id: 'placeholder-@bob_handle',
      platform_instance_id: 'tg-main',
      username: '@bob_handle',
      added_by: 'admin',
      blocked_at: null,
    },
    {
      platform_user_id: '987654321',
      platform_instance_id: 'tg-main',
      username: 'charlie',
      added_by: 'open_access',
      blocked_at: '2026-01-15T10:00:00Z',
    },
  ],
}

const adminUsersWrites: HttpHandler[] = [
  http.post('/settings/api/admin/users', () => HttpResponse.json({ ok: true, pending: false })),
  http.delete('/settings/api/admin/users', () => HttpResponse.json({ ok: true })),
  http.post('/settings/api/admin/users/block', () => HttpResponse.json({ ok: true })),
  http.post('/settings/api/admin/open-access', () => HttpResponse.json({ ok: true })),
]

export const adminUsersHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/admin/users', () => HttpResponse.json(adminUsersSample)),
    http.get('/settings/api/admin/open-access', () => HttpResponse.json({ openDmAccess: true })),
    ...adminUsersWrites,
  ],
  empty: [
    http.get('/settings/api/admin/users', () => HttpResponse.json({ users: [] })),
    http.get('/settings/api/admin/open-access', () => HttpResponse.json({ openDmAccess: false })),
    ...adminUsersWrites,
  ],
  error: [http.get('/settings/api/admin/users', boom), http.get('/settings/api/admin/open-access', boom)],
  loading: [
    http.get('/settings/api/admin/users', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json({ users: [] })
    }),
    http.get('/settings/api/admin/open-access', () => HttpResponse.json({ openDmAccess: false })),
  ],
}

// --- Shell always-on sections (personal, Advanced collapsed): config, task-instance, tools, release ---

export const shellReadyHandlers: HttpHandler[] = [
  http.get('/settings/api/config', () =>
    HttpResponse.json({
      contextId: 'ctx-personal-1',
      fields: [
        {
          key: 'display_name',
          label: 'Display name',
          required: false,
          sensitive: false,
          hasValue: true,
          value: 'Alice',
          storageKey: 'display_name',
          kind: 'preference',
          control: 'text',
        },
      ],
    }),
  ),
  http.get('/settings/api/context/task-instance', () =>
    HttpResponse.json({
      contextId: 'ctx-personal-1',
      taskInstanceId: null,
      available: [{ id: 'inst_abc', type: 'kaneo', status: 'active' }],
      canProvision: false,
    }),
  ),
  http.get('/settings/api/tools', () =>
    HttpResponse.json({
      contextId: 'ctx-personal-1',
      domains: [
        {
          domain: 'files',
          summary: 'allow',
          tools: [
            { name: 'read_file', permission: 'allow', risk: 'read' },
            { name: 'write_file', permission: 'ask', risk: 'write' },
          ],
        },
      ],
      activePreset: null,
      hasStoredDefaults: false,
    }),
  ),
  http.get('/settings/api/release-subscription', () => HttpResponse.json({ enabled: false })),
]
