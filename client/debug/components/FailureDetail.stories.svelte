<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import { makeToolFailure } from '../../stories/fixtures/debug.js'
  import FailureDetail from './FailureDetail.svelte'

  const { Story } = defineMeta({
    title: 'debug/components/FailureDetail',
    component: FailureDetail,
  })
</script>

<Story name="Default" args={{ failure: makeToolFailure() }} />

<Story
  name="Group scope"
  args={{
    failure: makeToolFailure({
      scope: { kind: 'group', groupId: 'g-1', threadId: 't-9' },
      data: { toolName: 'add_comment', error: 'thread locked', errorType: 'state' },
    }),
  }} />
