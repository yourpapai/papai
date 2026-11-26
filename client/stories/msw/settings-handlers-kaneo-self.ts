// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { HttpResponse, delay, http } from 'msw'

const NEVER_RESOLVE_MS = 60_000
const boom = (): HttpResponse<{ error: string }> => HttpResponse.json({ error: 'boom' }, { status: 500 })

// --- Kaneo self access (GET/POST /settings/api/kaneo/credentials/self) ---

const kaneoSelfMemberships = [
  {
    contextId: 'grp-ctx-a',
    groupLabel: 'Platform team',
    login: 'alice-a@pap.ai',
    status: 'active',
    kaneoUrl: 'https://workspace.kaneo.app',
  },
  {
    contextId: 'grp-ctx-b',
    groupLabel: 'Mobile team',
    login: 'alice-b@pap.ai',
    status: 'inactive',
    kaneoUrl: null,
  },
]

export const kaneoSelfHandlers = {
  populated: [
    http.get('/settings/api/kaneo/credentials/self', () => HttpResponse.json({ memberships: kaneoSelfMemberships })),
    http.post('/settings/api/kaneo/credentials/self', () =>
      HttpResponse.json({ password: 's3cr3tP@ssw0rd!', warning: 'This password is shown once. Store it securely.' }),
    ),
  ],
  empty: [http.get('/settings/api/kaneo/credentials/self', () => HttpResponse.json({ memberships: [] }))],
  error: [http.get('/settings/api/kaneo/credentials/self', boom)],
  loading: [
    http.get('/settings/api/kaneo/credentials/self', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json({ memberships: [] })
    }),
  ],
}
