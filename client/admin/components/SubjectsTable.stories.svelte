<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import { makeBillingSubject } from '../../stories/fixtures/index.js'
  import SubjectsTable from './SubjectsTable.svelte'

  const { Story } = defineMeta({
    title: 'admin/components/SubjectsTable',
    component: SubjectsTable,
  })

  const noop = () => undefined

  const populated = [
    makeBillingSubject(),
    makeBillingSubject({ storageContextId: 'tg:2', contextType: 'group', displayName: 'team-alpha' }),
    makeBillingSubject({ storageContextId: 'tg:3', displayName: 'really-long-display-name-'.repeat(3) }),
  ]

  const many = Array.from({ length: 50 }, (_, i) => makeBillingSubject({ storageContextId: `tg:${i}` }))
</script>

<Story name="Populated" args={{ subjects: populated, onSelect: noop }} />

<Story name="Empty" args={{ subjects: [], onSelect: noop }} />

<Story name="Single row" args={{ subjects: [makeBillingSubject()], onSelect: noop }} />

<Story name="Many rows edge" args={{ subjects: many, onSelect: noop }} />
