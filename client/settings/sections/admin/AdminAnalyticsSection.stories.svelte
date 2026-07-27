<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import AdminAnalyticsSection from './AdminAnalyticsSection.svelte'

  const { Story } = defineMeta({
    title: 'settings/sections/admin/AdminAnalyticsSection',
    component: AdminAnalyticsSection,
  })
</script>

<!-- governed aggregate default: policy complete, no sinks -->
<Story name="AggregateDefault" parameters={{ fixtures: 'settings-admin-analytics-populated' }} />

<Story name="IncompleteGovernance" parameters={{ fixtures: 'settings-admin-analytics-incomplete-governance' }} />

<Story name="GovernedLocalPilot" parameters={{ fixtures: 'settings-admin-analytics-governed-local-pilot' }} />

<Story name="KillSwitch" parameters={{ fixtures: 'settings-admin-analytics-kill-switch' }} />

<Story name="FailedSink" parameters={{ fixtures: 'settings-admin-analytics-failed-sink' }} />

<Story name="ReconciledHealthy" parameters={{ fixtures: 'settings-admin-analytics-reconciled-healthy' }} />

<Story name="Error" parameters={{ fixtures: 'settings-admin-analytics-error' }} />

<Story name="Loading" parameters={{ fixtures: 'settings-admin-analytics-loading' }} />
