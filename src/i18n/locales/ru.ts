// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Dictionary } from '../types.js'

/** Russian catalog — typed against the same shape as `en`. */
export const ru: Dictionary = {
  commands: {
    start: {
      welcome: `👋 **Добро пожаловать в papai!**

Я ваш помощник по управлению задачами. Я могу помочь вам:

📋 **Создавать задачи и управлять ими** обычным языком
🔍 **Искать и обновлять** существующие задачи
⚙️ **Настроить интеграцию** с вашим трекером задач

**С чего начать:**
⚙️ **/config** — открыть настройки (ключи API, модели, интеграции) в веб-интерфейсе
❓ **/help** — показать доступные команды

**Подсказки:**
• Пишите запросы обычным языком (например, «создай задачу: ревью PR #123»)
• Я помню контекст нашего разговора
• Используйте «/clear», чтобы сбросить историю диалога

Начнём настройку! 🎯`,
    },
    stop: {
      nothingRunning: 'Сейчас ничего не выполняется.',
      stoppingNow: '🛑 Останавливаю немедленно…',
      windingDown: '🛑 останавливаюсь после этого шага…',
    },
  },
  auth: {
    groupNotAllowed:
      'Эта группа ({groupId}) не авторизована для работы с этим ботом. Попросите администратора бота авторизовать её в веб-интерфейсе настроек — его можно открыть командой `/config` в личных сообщениях.',
    groupMemberNotAllowed:
      'Вы не авторизованы для работы с этим ботом в этой группе. Попросите администратора группы добавить вас в веб-интерфейсе настроек — его можно открыть командой `/config` в личных сообщениях.',
    dmNotAllowed: 'Вы не авторизованы для работы с этим ботом.',
    userBlocked: 'Вы не авторизованы для работы с этим ботом.',
  },
  progress: {
    toolStarted: 'Инструмент `{toolName}` запущен',
    toolFinished: 'Инструмент `{toolName}` — {status}',
    statusSuccess: 'успешно',
    statusFailed: 'ошибка',
    durationSuffix: ' за {durationMs} мс',
    inputLabel: 'Входные данные:',
    outputLabel: 'Результат:',
    errorLabel: 'Ошибка:',
    reasoningTitle: 'Reasoning',
    reasoningHidden: ' Reasoning провайдера доступен ({count} символов). Включите raw-режим, чтобы увидеть.',
  },
  picker: {
    prompt: 'Выберите язык, на котором я буду с вами общаться:',
    english: 'English',
    russian: 'Русский',
    saved: 'Язык сохранён.',
  },
}
