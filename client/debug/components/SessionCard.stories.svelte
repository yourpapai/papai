<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import { makeSession, makeWizard } from '../../stories/fixtures/debug.js'
  import SessionCard from './SessionCard.svelte'

  const { Story } = defineMeta({
    title: 'debug/components/SessionCard',
    component: SessionCard,
  })

  const noop = () => undefined
</script>

<Story name="Default" args={{ userId: 'tg:1001', session: makeSession(), onSelect: noop }} />

<Story
  name="With active wizard"
  args={{ userId: 'tg:1001', session: makeSession(), wizard: makeWizard(), onSelect: noop }} />

<Story
  name="Minimal session"
  args={{
    userId: 'tg:2',
    session: makeSession({ userId: 'tg:2', summary: null, workspaceId: null, factsCount: 0, historyLength: 0 }),
    onSelect: noop,
  }} />
