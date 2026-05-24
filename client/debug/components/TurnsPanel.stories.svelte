<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import { makeDashboardState } from '../../stories/fixtures/debug.js'
  import TurnsPanel from './TurnsPanel.svelte'

  const { Story } = defineMeta({
    title: 'debug/components/TurnsPanel',
    component: TurnsPanel,
  })

  const noop = () => undefined
</script>

<Story name="Populated" args={{ dashboard: makeDashboardState(), onShowTurn: noop, onShowLogsForTurn: noop }} />

<Story name="Empty" args={{ dashboard: makeDashboardState({ turns: [] }), onShowTurn: noop, onShowLogsForTurn: noop }} />
