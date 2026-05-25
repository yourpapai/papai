<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import { makeDashboardState, makeNotification } from '../../stories/fixtures/debug.js'
  import NotificationsPanel from './NotificationsPanel.svelte'

  const { Story } = defineMeta({
    title: 'debug/components/NotificationsPanel',
    component: NotificationsPanel,
  })

  const several = [
    makeNotification(),
    makeNotification({ type: 'reminder_due', scope: { kind: 'group', groupId: 'g-1' } }),
  ]
</script>

<Story name="Populated" args={{ dashboard: makeDashboardState({ notifications: several }) }} />

<Story name="Empty" args={{ dashboard: makeDashboardState({ notifications: [] }) }} />
