// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { FamilySpec } from './corpus-types.js'
import type { CoreIntent } from './taxonomy.js'

interface ScenarioCopy {
  readonly en: string
  readonly ru: string
  readonly short: string
}

export const TOOL_BY_INTENT: Readonly<Record<CoreIntent, string>> = {
  'task.create': 'create_task',
  'task.find_list': 'find_tasks',
  'task.read_detail': 'get_task',
  'task.update_fields': 'update_task_fields',
  'task.change_state': 'change_task_state',
  'task.collaborate': 'comment_or_assign_task',
  'task.delete': 'delete_task',
  'project_schema.manage': 'manage_project_schema',
  'recurring.manage': 'manage_recurring_task',
  'deferred.manage': 'manage_deferred_prompt',
  'memory_memo.write': 'write_memo',
  'memory_memo.find': 'find_memo',
  'attachment.manage': 'manage_attachment',
  'web.retrieve': 'fetch_public_web_page',
  'identity_participant.manage': 'resolve_participant_identity',
  'coding.start_review': 'start_coding_or_review',
  'coding.monitor_control': 'control_coding_session',
  'coding.continue_publish': 'continue_or_publish_coding_session',
  configuration_permissions: 'configure_tool_permissions',
  help_context: 'show_help_or_context',
}

export const STRUCTURED_SIGNAL_BY_INTENT: Readonly<Record<CoreIntent, string>> = {
  'task.create': 'provider:task:create',
  'task.find_list': 'provider:task:search',
  'task.read_detail': 'provider:task:read_detail',
  'task.update_fields': 'provider:task:update_fields',
  'task.change_state': 'provider:task:change_state',
  'task.collaborate': 'provider:task:collaborate',
  'task.delete': 'provider:task:delete',
  'project_schema.manage': 'feature:project_schema:manage',
  'recurring.manage': 'feature:recurring:manage',
  'deferred.manage': 'feature:deferred:manage',
  'memory_memo.write': 'feature:memory:write',
  'memory_memo.find': 'feature:memory:find',
  'attachment.manage': 'feature:attachment:manage',
  'web.retrieve': 'feature:web:retrieve',
  'identity_participant.manage': 'feature:identity:manage',
  'coding.start_review': 'feature:coding:start_review',
  'coding.monitor_control': 'feature:coding:monitor_control',
  'coding.continue_publish': 'feature:coding:continue_publish',
  configuration_permissions: 'feature:configuration:permissions',
  help_context: 'command:help_context',
}

export const NEAR_NEIGHBOR: Readonly<Record<CoreIntent, CoreIntent>> = {
  'task.create': 'task.update_fields',
  'task.find_list': 'task.read_detail',
  'task.read_detail': 'task.find_list',
  'task.update_fields': 'task.change_state',
  'task.change_state': 'task.update_fields',
  'task.collaborate': 'identity_participant.manage',
  'task.delete': 'task.change_state',
  'project_schema.manage': 'configuration_permissions',
  'recurring.manage': 'deferred.manage',
  'deferred.manage': 'recurring.manage',
  'memory_memo.write': 'memory_memo.find',
  'memory_memo.find': 'task.find_list',
  'attachment.manage': 'web.retrieve',
  'web.retrieve': 'attachment.manage',
  'identity_participant.manage': 'task.collaborate',
  'coding.start_review': 'coding.continue_publish',
  'coding.monitor_control': 'coding.continue_publish',
  'coding.continue_publish': 'coding.monitor_control',
  configuration_permissions: 'project_schema.manage',
  help_context: 'configuration_permissions',
}

const COPY: Readonly<Record<CoreIntent, ScenarioCopy>> = {
  'task.create': {
    en: 'create a task to inspect the fictional Aurora lighthouse',
    ru: 'создай задачу проверить вымышленный маяк Аврора',
    short: '🧪 task + fictional lighthouse',
  },
  'task.find_list': {
    en: 'list open tasks for the fictional Juniper expedition',
    ru: 'покажи открытые задачи вымышленной экспедиции Можжевельник',
    short: '🔎 tasks / demo Juniper',
  },
  'task.read_detail': {
    en: 'show details of the invented task DEMO-42',
    ru: 'покажи детали вымышленной задачи DEMO-42',
    short: '👀 DEMO-42 details',
  },
  'task.update_fields': {
    en: 'change the due date on invented task DEMO-17',
    ru: 'измени срок вымышленной задачи DEMO-17',
    short: '✏️ DEMO-17 due date',
  },
  'task.change_state': {
    en: 'move invented task DEMO-8 to done',
    ru: 'переведи вымышленную задачу DEMO-8 в готово',
    short: '✅ DEMO-8 → done',
  },
  'task.collaborate': {
    en: 'add a comment to invented task DEMO-9',
    ru: 'добавь комментарий к вымышленной задаче DEMO-9',
    short: '💬 DEMO-9 comment',
  },
  'task.delete': {
    en: 'archive invented task DEMO-13',
    ru: 'архивируй вымышленную задачу DEMO-13',
    short: '🗑️ DEMO-13 archive',
  },
  'project_schema.manage': {
    en: 'add an invented Cobalt label to the demo project',
    ru: 'добавь вымышленную метку Кобальт в демо-проект',
    short: '🏷️ demo label Cobalt',
  },
  'recurring.manage': {
    en: 'schedule a fictional weekly lighthouse inspection task',
    ru: 'настрой вымышленную еженедельную проверку маяка',
    short: '🔁 fictional weekly task',
  },
  'deferred.manage': {
    en: 'remind the fictional Aurora team about the demo later',
    ru: 'напомни вымышленной команде Аврора о демо позже',
    short: '⏰ demo reminder later',
  },
  'memory_memo.write': {
    en: 'remember that the invented demo color is cobalt',
    ru: 'запомни что вымышленный цвет демо — кобальт',
    short: '🧠 remember demo=cobalt',
  },
  'memory_memo.find': {
    en: 'find the invented note about the Aurora demo',
    ru: 'найди вымышленную заметку о демо Аврора',
    short: '🔍 memo demo Aurora',
  },
  'attachment.manage': {
    en: 'list invented attachments on DEMO-31',
    ru: 'покажи вымышленные вложения задачи DEMO-31',
    short: '📎 DEMO-31 files',
  },
  'web.retrieve': {
    en: 'fetch the fictional public example page',
    ru: 'загрузи вымышленную публичную страницу-пример',
    short: '🌐 fetch demo page',
  },
  'identity_participant.manage': {
    en: 'map the invented participant Demo Rowan',
    ru: 'сопоставь вымышленного участника Демо Роуэн',
    short: '👤 map Demo Rowan',
  },
  'coding.start_review': {
    en: 'start a coding review for the invented Aurora repository',
    ru: 'начни код-ревью вымышленного репозитория Аврора',
    short: '💻 review demo repo',
  },
  'coding.monitor_control': {
    en: 'show status of the invented coding session',
    ru: 'покажи статус вымышленной сессии разработки',
    short: '📟 coding demo status',
  },
  'coding.continue_publish': {
    en: 'continue and publish the invented coding session',
    ru: 'продолжи и опубликуй вымышленную сессию разработки',
    short: '🚀 continue demo session',
  },
  configuration_permissions: {
    en: 'allow the fictional demo tool for this context',
    ru: 'разреши вымышленный демо-инструмент в этом контексте',
    short: '🔐 allow demo tool',
  },
  help_context: {
    en: 'show help for the fictional demo context',
    ru: 'покажи справку для вымышленного демо-контекста',
    short: '❓ /help demo',
  },
}

const EN_VARIANTS = [
  'please',
  'for the synthetic trial',
  'in the demo workspace',
  'as an invented example',
  'for scenario alpha',
  'for the mock team',
  'in this synthetic turn',
  'using sample data',
  'for the test fixture',
  'for imaginary project Orion',
] as const

const RU_VARIANTS = [
  'пожалуйста',
  'для синтетического теста',
  'в демо-пространстве',
  'как вымышленный пример',
  'для сценария альфа',
  'для тестовой команды',
  'в этом синтетическом сообщении',
  'на примерных данных',
  'для тестового набора',
  'для воображаемого проекта Орион',
] as const

const MIXED_VARIANTS = [
  'pls',
  'demo',
  'тест',
  'synthetic',
  'пример',
  'mock',
  '🧪',
  'demo-2',
  'тест-3',
  'fictional',
] as const

export function renderCoreMessage(intent: CoreIntent, language: FamilySpec['language'], variant: number): string {
  const copy = COPY[intent]
  if (language === 'en') return `Synthetic request: ${copy.en}, ${EN_VARIANTS[variant]}.`
  if (language === 'ru') return `Синтетический запрос: ${copy.ru}, ${RU_VARIANTS[variant]}.`
  return `Synthetic/Синтетика ${copy.short} ${MIXED_VARIANTS[variant]}`
}

export function renderNoActionMessage(language: FamilySpec['language'], variant: number): string {
  if (variant === 0) {
    if (language === 'en') return 'Synthetic social turn: thanks for the fictional demo.'
    if (language === 'ru') return 'Синтетическая реплика: спасибо за вымышленное демо.'
    return 'Synthetic спасибо 🙏 demo'
  }
  if (language === 'en') return `Synthetic command: /stop fictional demo ${EN_VARIANTS[variant]}.`
  if (language === 'ru') return `Синтетическая команда: /stop вымышленное демо ${RU_VARIANTS[variant]}.`
  return `Synthetic /stop демо ${MIXED_VARIANTS[variant]}`
}

export function renderUnknownMessage(language: FamilySpec['language'], variant: number): string {
  if (language === 'en') {
    return `Synthetic unsupported request: tune an imaginary moon harp, ${EN_VARIANTS[variant]}.`
  }
  if (language === 'ru') {
    return `Синтетический неподдерживаемый запрос: настрой воображаемую лунную арфу, ${RU_VARIANTS[variant]}.`
  }
  return `Synthetic unknown 🌙🎵 ${MIXED_VARIANTS[variant]}`
}

export function renderAdversarialMessage(spec: FamilySpec, variant: number): string {
  const primary = spec.goals[0]
  if (primary === undefined || primary === 'no_action' || spec.nearNeighbor === undefined) {
    throw new Error(`Invalid adversarial family ${spec.familyId}`)
  }
  const first = renderCoreMessage(primary, spec.language, variant)
  const second = renderCoreMessage(spec.nearNeighbor, spec.language, (variant + 3) % 10)
  return `${first} Boundary wording also resembles: ${second}`
}

export function renderMultiGoalMessage(spec: FamilySpec, variant: number): string {
  const [first, second, third] = spec.goals
  if (first === undefined || first === 'no_action' || second === undefined || second === 'no_action') {
    throw new Error(`Invalid multi-goal family ${spec.familyId}`)
  }
  const messages = [
    renderCoreMessage(first, spec.language, variant),
    renderCoreMessage(second, spec.language, (variant + 1) % 10),
  ]
  if (third !== undefined) {
    if (third === 'no_action') throw new Error(`Invalid multi-goal family ${spec.familyId}`)
    messages.push(renderCoreMessage(third, spec.language, (variant + 2) % 10))
  }
  return messages.join(' Also: ')
}
