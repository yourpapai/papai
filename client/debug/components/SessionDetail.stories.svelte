<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import { makeSession } from '../../stories/fixtures/debug.js'
  import SessionDetail from './SessionDetail.svelte'

  const { Story } = defineMeta({
    title: 'debug/components/SessionDetail',
    component: SessionDetail,
  })
</script>

<Story
  name="With facts and config"
  args={{
    userId: 'tg:1001',
    session: makeSession({
      facts: [{ identifier: 'f1', title: 'Prefers concise replies', url: '', lastSeen: '2026-05-20' }],
      config: { timezone: 'Europe/Berlin', kaneo_apikey: null },
      hasTools: true,
      instructionsCount: 1,
      instructions: [{ id: 'i1', text: 'Always confirm before deleting', createdAt: '2026-05-01' }],
    }),
  }} />

<Story name="Minimal" args={{ userId: 'tg:2', session: makeSession({ userId: 'tg:2', summary: null }) }} />
