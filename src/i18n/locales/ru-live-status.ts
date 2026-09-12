// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Dictionary } from '../types.js'

/** Russian live-status texts; split out of `ru.ts` to keep catalog files small. */
export const ruLiveStatus: Dictionary['liveStatus'] = {
  thinking: '💭 Думаю…',
  preparingResponse: '💬 Готовлю ответ…',
  runningTool: '⚙️ Выполняю {tool}…',
  tools: {
    web_fetch: 'Загружаю',
    fetch_chat_link: 'Читаю ссылку',
    search_memory: 'Ищу в памяти',
    list_memory: 'Вспоминаю',
    remember_memory: 'Сохраняю в память',
    search_memos: 'Ищу в заметках',
    save_memo: 'Сохраняю заметку',
    list_memos: 'Показываю заметки',
    create_task: 'Создаю задачу',
    update_task: 'Обновляю задачу',
    delete_task: 'Удаляю задачу',
    get_task: 'Читаю задачу',
    list_tasks: 'Показываю задачи',
    search_tasks: 'Ищу задачи',
    count_tasks: 'Считаю задачи',
    add_comment: 'Добавляю комментарий',
    create_project: 'Создаю проект',
    list_projects: 'Показываю проекты',
    list_files: 'Показываю файлы',
    search_staged_files: 'Ищу файлы',
    upload_attachment: 'Прикрепляю файл',
    resolve_staged_file: 'Прикрепляю файл',
    create_recurring_task: 'Настраиваю повторяющуюся задачу',
    create_reminder: 'Настраиваю напоминание',
    create_alert: 'Настраиваю оповещение',
    list_reminders: 'Показываю напоминания и оповещения',
    get_reminder: 'Читаю детали напоминания',
    update_reminder: 'Обновляю напоминание',
    cancel_reminder: 'Отменяю напоминание',
    lookup_group_history: 'Проверяю историю',
    find_user: 'Ищу пользователя',
    get_current_time: 'Проверяю время',
  },
}
