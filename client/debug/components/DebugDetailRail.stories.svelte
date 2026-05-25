<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import { makeLlmTrace, makeSession, makeToolFailure, makeTurn } from '../../stories/fixtures/debug.js'
  import DebugDetailRail from './DebugDetailRail.svelte'

  const { Story } = defineMeta({
    title: 'debug/components/DebugDetailRail',
    component: DebugDetailRail,
  })

  const noop = () => undefined
</script>

<Story name="Empty" args={{ selected: null, onClear: noop }} />

<Story name="Turn selected" args={{ selected: { kind: 'turn', payload: makeTurn() }, onClear: noop }} />

<Story name="Trace selected" args={{ selected: { kind: 'trace', payload: makeLlmTrace() }, onClear: noop }} />

<Story
  name="Session selected"
  args={{ selected: { kind: 'session', payload: { userId: 'tg:1001', session: makeSession() } }, onClear: noop }} />

<Story name="Failure selected" args={{ selected: { kind: 'failure', payload: makeToolFailure() }, onClear: noop }} />
