<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import { makeDashboardState } from '../../stories/fixtures/debug.js'
  import SessionsList from './SessionsList.svelte'

  const { Story } = defineMeta({
    title: 'debug/components/SessionsList',
    component: SessionsList,
  })

  const noop = () => undefined
</script>

<Story name="Populated" args={{ dashboard: makeDashboardState(), onSelect: noop }} />

<Story name="Empty" args={{ dashboard: makeDashboardState({ sessions: new Map() }), onSelect: noop }} />
