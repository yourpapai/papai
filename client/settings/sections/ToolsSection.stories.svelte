<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import type { ToolsResponse } from '../fetcher-schemas-tools.js'

  import ToolsSection from './ToolsSection.svelte'

  const CONTEXT_ID = 'tg:1'

  const populated: ToolsResponse = {
    contextId: CONTEXT_ID,
    activePreset: null,
    hasStoredDefaults: false,
    domains: [
      {
        domain: 'tasks',
        summary: 'allow',
        tools: [
          { name: 'createTask', permission: 'allow', risk: 'write' },
          { name: 'listTasks', permission: 'allow', risk: 'read' },
          { name: 'deleteTask', permission: 'ask', risk: 'destructive' },
        ],
      },
      {
        domain: 'web',
        summary: 'partial',
        tools: [{ name: 'webFetch', permission: 'ask', risk: 'open-world' }],
      },
    ],
  }

  const emptyResponse: ToolsResponse = {
    contextId: CONTEXT_ID,
    activePreset: null,
    hasStoredDefaults: false,
    domains: [],
  }

  const presetResponse: ToolsResponse = { ...populated, activePreset: 'read-only', hasStoredDefaults: true }

  const grouped: ToolsResponse = {
    contextId: CONTEXT_ID,
    activePreset: null,
    hasStoredDefaults: false,
    domains: [
      {
        domain: 'plugin',
        summary: 'partial',
        tools: [
          { name: 'plugin_acp__start_session', permission: 'ask', risk: 'open-world', group: 'acp' },
          { name: 'plugin_acp__list_sessions', permission: 'allow', risk: 'open-world', group: 'acp' },
          {
            name: 'plugin_audio_transcribe__transcribe',
            permission: 'allow',
            risk: 'open-world',
            group: 'audio-transcribe',
          },
        ],
      },
      {
        domain: 'mcp',
        summary: 'ask',
        tools: [{ name: 'mcp_search-server__fetch_page', permission: 'ask', risk: 'open-world', group: 'search-server' }],
      },
      {
        domain: 'time',
        summary: 'allow',
        tools: [{ name: 'get_current_time', permission: 'allow', risk: 'read' }],
      },
    ],
  }
  const longDomainNames: ToolsResponse = {
    contextId: CONTEXT_ID,
    activePreset: null,
    hasStoredDefaults: false,
    domains: [
      {
        domain: 'plugin_enterprise_document_management_connector',
        summary: 'partial',
        tools: [
          {
            name: 'plugin_enterprise_document_management_connector__search_documents',
            permission: 'ask',
            risk: 'open-world',
            group: 'enterprise-document-management',
          },
          {
            name: 'plugin_enterprise_document_management_connector__archive_document',
            permission: 'deny',
            risk: 'destructive',
            group: 'enterprise-document-management',
          },
        ],
      },
      {
        domain: 'mcp_internal_knowledge_base_search_service',
        summary: 'ask',
        tools: [
          {
            name: 'mcp_internal_knowledge_base_search_service__query',
            permission: 'ask',
            risk: 'open-world',
          },
        ],
      },
    ],
  }
  const fetchLongDomainNames = (): Promise<ToolsResponse> => Promise.resolve(longDomainNames)

  const fetchGrouped = (): Promise<ToolsResponse> => Promise.resolve(grouped)

  // DI fixtures: each state is a fetchToolsFn returning the matching response.
  const fetchPopulated = (): Promise<ToolsResponse> => Promise.resolve(populated)
  const fetchEmpty = (): Promise<ToolsResponse> => Promise.resolve(emptyResponse)
  const fetchPreset = (): Promise<ToolsResponse> => Promise.resolve(presetResponse)
  const fetchNever = (): Promise<ToolsResponse> => new Promise<ToolsResponse>(() => {})
  const fetchError = (): Promise<ToolsResponse> => Promise.reject(new Error('Failed to load tools'))

  const { Story } = defineMeta({
    title: 'settings/sections/ToolsSection',
    component: ToolsSection,
    args: { contextId: CONTEXT_ID },
  })
</script>

<Story name="Populated" args={{ contextId: CONTEXT_ID, fetchToolsFn: fetchPopulated }} />

<Story name="Empty" args={{ contextId: CONTEXT_ID, fetchToolsFn: fetchEmpty }} />

<Story name="Preset applied" args={{ contextId: CONTEXT_ID, fetchToolsFn: fetchPreset, hasStoredDefaults: true }} />

<Story name="Grouped" args={{ contextId: CONTEXT_ID, fetchToolsFn: fetchGrouped }} />

<Story name="Loading" args={{ contextId: CONTEXT_ID, fetchToolsFn: fetchNever }} />

<Story name="Error" args={{ contextId: CONTEXT_ID, fetchToolsFn: fetchError }} />

<Story name="Long domain names" args={{ contextId: CONTEXT_ID, fetchToolsFn: fetchLongDomainNames }} />
