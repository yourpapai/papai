// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatToolStatus } from '../../src/live-status/tool-status-labels.js'
import { assertEach, type Row } from '../utils/grouped-assertions.js'

type LabelRow = Row<{ readonly tool: string; readonly input: unknown; readonly expected: string }>

describe('formatToolStatus', () => {
  test('rendering matrix', async () => {
    const functionInput = (): string => 'x'
    functionInput.query = 'q'
    const rows: readonly LabelRow[] = [
      {
        label: 'web_fetch shows the host without quotes',
        tool: 'web_fetch',
        input: { url: 'https://example.com/path?q=1' },
        expected: '🌐 Fetching example.com…',
      },
      {
        label: 'falls back to the raw value when the url is unparseable',
        tool: 'web_fetch',
        input: { url: 'not a url' },
        expected: '🌐 Fetching not a url…',
      },
      {
        label: 'search_memory quotes the query argument',
        tool: 'search_memory',
        input: { query: 'budget' },
        expected: '🔍 Searching memory: "budget"…',
      },
      {
        label: 'create_task quotes the title argument',
        tool: 'create_task',
        input: { title: 'Buy milk' },
        expected: '📝 Creating task: "Buy milk"…',
      },
      {
        label: 'mapped tool with no extractable argument omits the argument',
        tool: 'create_task',
        input: {},
        expected: '📝 Creating task…',
      },
      {
        label: 'getStringField prefers the first listed key when both are present',
        tool: 'create_task',
        input: { title: 'A', name: 'B' },
        expected: '📝 Creating task: "A"…',
      },
      {
        label: 'getStringField skips an empty first key and falls back to the next',
        tool: 'create_task',
        input: { title: '', name: 'B' },
        expected: '📝 Creating task: "B"…',
      },
      {
        label: 'getStringField skips a non-string first key and falls back to the next',
        tool: 'create_task',
        input: { title: 5, name: 'B' },
        expected: '📝 Creating task: "B"…',
      },
      {
        label: 'a whitespace-only argument is omitted like a missing argument',
        tool: 'search_memory',
        input: { query: '   ' },
        expected: '🔍 Searching memory…',
      },
      {
        label: 'collapses whitespace and truncates long arguments to 40 chars',
        tool: 'search_memory',
        input: { query: `  multi\nline   ${'a'.repeat(50)}` },
        expected: `🔍 Searching memory: "multi line ${'a'.repeat(29)}…"…`,
      },
      {
        label: 'a 40-char argument is not truncated (boundary: length > MAX_ARG_LENGTH is false at 40)',
        tool: 'search_memory',
        input: { query: 'a'.repeat(40) },
        expected: `🔍 Searching memory: "${'a'.repeat(40)}"…`,
      },
      {
        label: 'a 41-char argument truncates to 40 chars plus ellipsis (boundary)',
        tool: 'search_memory',
        input: { query: 'a'.repeat(41) },
        expected: `🔍 Searching memory: "${'a'.repeat(40)}…"…`,
      },
      {
        label: 'plugin tool falls back to humanized last segment',
        tool: 'plugin_audio-transcribe__transcribe',
        input: { audioId: 'x' },
        expected: '⚙️ Running transcribe…',
      },
      {
        label: 'mcp tool falls back to humanized last segment',
        tool: 'mcp_server__do_thing',
        input: {},
        expected: '⚙️ Running do thing…',
      },
      {
        label: 'unmapped core tool falls back to humanized full name',
        tool: 'add_watcher',
        input: {},
        expected: '⚙️ Running add watcher…',
      },
      {
        label: 'never returns the argument when input is not a record',
        tool: 'search_memory',
        input: 'budget',
        expected: '🔍 Searching memory…',
      },
      {
        label: 'web_fetch keeps the port in the host (host, not hostname)',
        tool: 'web_fetch',
        input: { url: 'https://host.example:8080/x' },
        expected: '🌐 Fetching host.example:8080…',
      },
      {
        label: 'asRecord rejects an array and yields the no-arg label',
        tool: 'search_memory',
        input: ['query'],
        expected: '🔍 Searching memory…',
      },
      {
        label: 'asRecord rejects null and yields the no-arg label',
        tool: 'search_memory',
        input: null,
        expected: '🔍 Searching memory…',
      },
      {
        label: 'asRecord rejects a number and yields the no-arg label',
        tool: 'search_memory',
        input: 42,
        expected: '🔍 Searching memory…',
      },
      {
        label: 'a mapped tool with no arg extractor renders only the emoji and label',
        tool: 'list_memory',
        input: {},
        expected: '🧠 Recalling memory…',
      },
      {
        label: 'fetch_chat_link renders the quote:false host form (second hostOf entry)',
        tool: 'fetch_chat_link',
        input: { url: 'https://example.com/x' },
        expected: '🔗 Reading link example.com…',
      },
      {
        label: 'update_task renders the updating label with no arg',
        tool: 'update_task',
        input: {},
        expected: '✏️ Updating task…',
      },
      {
        label: 'delete_task renders the deleting label with no arg',
        tool: 'delete_task',
        input: {},
        expected: '🗑️ Deleting task…',
      },
      {
        label: 'humanizeToolName converts hyphens to spaces',
        tool: 'mcp_s__audio-transcribe',
        input: {},
        expected: '⚙️ Running audio transcribe…',
      },
      {
        label: 'humanizeToolName lowercases the segments',
        tool: 'mcp_s__CamelCase',
        input: {},
        expected: '⚙️ Running camelcase…',
      },
      {
        label: 'humanizeToolName uses the last __ segment (lastIndexOf, not indexOf)',
        tool: 'plugin_a__b__c',
        input: {},
        expected: '⚙️ Running c…',
      },
      {
        label: 'humanizeToolName strips a leading mcp_ prefix when there is no __ segment',
        tool: 'mcp_standalone',
        input: {},
        expected: '⚙️ Running standalone…',
      },
      {
        label: 'getStringField skips a whitespace-only first key via trim and falls back to the next',
        tool: 'create_task',
        input: { title: '   ', name: 'B' },
        expected: '📝 Creating task: "B"…',
      },
      {
        label: 'humanizeToolName only strips a leading mcp_/plugin_ prefix (anchored)',
        tool: 'x_mcp_foo',
        input: {},
        expected: '⚙️ Running x mcp foo…',
      },
      {
        label: 'humanizeToolName collapses consecutive separators via the + quantifier',
        tool: 'mcp_x__foo--bar',
        input: {},
        expected: '⚙️ Running foo bar…',
      },
      {
        label: 'humanizeToolName trims the separator-separated base before rendering',
        tool: 'mcp_s__foo_',
        input: {},
        expected: '⚙️ Running foo…',
      },
      {
        label: 'asRecord rejects a function even when it carries an allowlisted field',
        tool: 'search_memory',
        input: functionInput,
        expected: '🔍 Searching memory…',
      },
    ]
    await assertEach(rows, (row) => {
      expect(formatToolStatus(row.tool, row.input)).toBe(row.expected)
    })
  })
})

describe('REGISTRY entries render their exact emoji, label, and arg form', () => {
  const cases: ReadonlyArray<readonly [string, unknown, string]> = [
    ['web_fetch', { url: 'https://example.com/x' }, '🌐 Fetching example.com…'],
    ['fetch_chat_link', { url: 'https://example.com/x' }, '🔗 Reading link example.com…'],
    ['search_memory', { query: 'q' }, '🔍 Searching memory: "q"…'],
    ['list_memory', {}, '🧠 Recalling memory…'],
    ['remember_memory', {}, '🧠 Saving a memory…'],
    ['search_memos', { query: 'q' }, '🔍 Searching memos: "q"…'],
    ['save_memo', {}, '📌 Saving a memo…'],
    ['list_memos', {}, '📒 Listing memos…'],
    ['create_task', { title: 'T' }, '📝 Creating task: "T"…'],
    ['update_task', {}, '✏️ Updating task…'],
    ['delete_task', {}, '🗑️ Deleting task…'],
    ['get_task', {}, '📄 Reading task…'],
    ['list_tasks', {}, '📋 Listing tasks…'],
    ['search_tasks', { query: 'q' }, '🔍 Searching tasks: "q"…'],
    ['search_tasks', { text: 't' }, '🔍 Searching tasks: "t"…'],
    ['count_tasks', {}, '🔢 Counting tasks…'],
    ['add_comment', {}, '💬 Adding a comment…'],
    ['create_project', { name: 'N' }, '📁 Creating project: "N"…'],
    ['create_project', { title: 'T' }, '📁 Creating project: "T"…'],
    ['list_projects', {}, '📁 Listing projects…'],
    ['list_files', {}, '📎 Listing files…'],
    ['search_staged_files', { query: 'q' }, '📎 Searching files: "q"…'],
    ['upload_attachment', {}, '📤 Attaching a file…'],
    ['resolve_staged_file', {}, '📎 Attaching a file…'],
    ['create_recurring_task', {}, '🔁 Scheduling a recurring task…'],
    ['create_reminder', { prompt: 'P' }, '⏰ Setting up a reminder: "P"…'],
    ['create_alert', { prompt: 'P' }, '🔔 Setting up an alert: "P"…'],
    ['list_reminders', {}, '📋 Listing reminders and alerts…'],
    ['get_reminder', {}, '📄 Reading reminder details…'],
    ['update_reminder', {}, '✏️ Updating reminder…'],
    ['cancel_reminder', {}, '🗑️ Cancelling reminder…'],
    ['lookup_group_history', {}, '🕘 Checking history…'],
    ['find_user', {}, '👤 Looking up a user…'],
    ['get_current_time', {}, '🕒 Checking the time…'],
  ]
  const rows: readonly Row<{ readonly name: string; readonly input: unknown; readonly expected: string }>[] = cases.map(
    ([name, input, expected]): Row<{ readonly name: string; readonly input: unknown; readonly expected: string }> => ({
      label: `${name} renders ${JSON.stringify(expected)}`,
      name,
      input,
      expected,
    }),
  )
  test('registry matrix', async () => {
    await assertEach(rows, (row) => {
      expect(formatToolStatus(row.name, row.input)).toBe(row.expected)
    })
  })
})

describe('reminder/alert live-status labels', () => {
  test('friendly reminder and alert labels', async () => {
    const rows: readonly LabelRow[] = [
      {
        label: 'create_reminder renders a friendly reminder label',
        tool: 'create_reminder',
        input: { prompt: 'Check the gigachat model' },
        expected: '⏰ Setting up a reminder: "Check the gigachat model"…',
      },
      {
        label: 'create_alert renders a friendly alert label',
        tool: 'create_alert',
        input: { prompt: 'Ping me when done' },
        expected: '🔔 Setting up an alert: "Ping me when done"…',
      },
    ]
    await assertEach(rows, (row) => {
      expect(formatToolStatus(row.tool, row.input)).toBe(row.expected)
    })
  })

  test('cancel_reminder renders a friendly label and never mentions "deferred"', () => {
    const out = formatToolStatus('cancel_reminder', { id: 'abc' })
    expect(out).not.toContain('deferred')
    expect(out).toContain('Cancelling')
  })
})

describe('formatToolStatus locale', () => {
  test('ru rendering matrix', async () => {
    const rows: readonly Row<{
      readonly tool: string
      readonly input: unknown
      readonly locale: 'en' | 'ru'
      readonly expected: string
    }>[] = [
      {
        label: 'ru renders the catalog label for a registered tool with a quoted arg',
        tool: 'search_tasks',
        input: { query: 'deploy' },
        locale: 'ru',
        expected: '🔍 Ищу задачи: "deploy"…',
      },
      {
        label: 'ru renders the catalog label for a registered tool with no arg',
        tool: 'update_task',
        input: {},
        locale: 'ru',
        expected: '✏️ Обновляю задачу…',
      },
      {
        label: 'ru keeps the quote:false bare-host form for web_fetch',
        tool: 'web_fetch',
        input: { url: 'https://example.com/x' },
        locale: 'ru',
        expected: '🌐 Загружаю example.com…',
      },
      {
        label: 'ru renders the localized runningTool fallback for unregistered tools',
        tool: 'add_watcher',
        input: {},
        locale: 'ru',
        expected: '⚙️ Выполняю add watcher…',
      },
      {
        label: 'ru truncation and quoting stay identical to the en path',
        tool: 'search_memory',
        input: { query: `  multi\nline   ${'a'.repeat(50)}` },
        locale: 'ru',
        expected: `🔍 Ищу в памяти: "multi line ${'a'.repeat(29)}…"…`,
      },
    ]
    await assertEach(rows, (row) => {
      expect(formatToolStatus(row.tool, row.input, row.locale)).toBe(row.expected)
    })
  })

  test('explicit en is byte-identical to the default no-locale output', () => {
    expect(formatToolStatus('search_tasks', { query: 'deploy' }, 'en')).toBe(
      formatToolStatus('search_tasks', { query: 'deploy' }),
    )
  })
})
