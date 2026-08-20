// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Typed i18n catalogs.
 *
 * `Dictionary` is the authoritative shape of a locale catalog. Every locale
 * file is typed against it, so adding a key to `en` forces every other locale
 * to provide it at compile time.
 */
export interface Dictionary {
  commands: {
    start: {
      welcome: string
    }
    stop: {
      nothingRunning: string
      stoppingNow: string
      windingDown: string
    }
    help: {
      dmUser: string
      dmAdmin: string
      groupUser: string
      groupAdmin: string
      mentionHint: string
    }
    clear: {
      selfCleared: string
      allCleared: string
      userCleared: string
      onlyGroupAdmins: string
      onlyAdminOtherUsers: string
      targetNotAuthorized: string
    }
    config: {
      groupRedirect: string
      groupAdminOnly: string
      notConfigured: string
      linkIssued: string
      rateLimited: string
    }
    context: {
      buildFailed: string
    }
    dashboard: {
      dmOnly: string
      adminOnly: string
      disabled: string
      userIdMissing: string
      issueFailed: string
      claimLink: string
    }
  }
  auth: {
    groupNotAllowed: string
    groupMemberNotAllowed: string
    dmNotAllowed: string
    userBlocked: string
  }
  steer: {
    ack: string
  }
  messageEdit: {
    promptEditLine: string
    adjustButton: string
    noteButton: string
    adjustingAck: string
    notedAck: string
    superseded: string
  }
  orchestrator: {
    toolFailed: string
    apiCallFailed: string
    unexpectedError: string
    missingConfig: string
    botMisconfigured: string
    byokIncomplete: string
    byokUnreadable: string
    stopSummaryHead: string
    stopSummaryHeadForced: string
    stopSummaryNoActions: string
    stopSummaryDoneOne: string
    stopSummaryDoneMany: string
    stopSummaryForcedTail: string
  }
  interactions: {
    actionFailed: string
    staleAction: string
    allowedTool: string
    deniedTool: string
    expiredDenied: string
    permissionPrompt: string
    argumentsLabel: string
    allowButton: string
    denyButton: string
  }
  announcements: {
    adminNotice: string
  }
  progress: {
    toolStarted: string
    toolFinished: string
    statusSuccess: string
    statusFailed: string
    durationSuffix: string
    inputLabel: string
    outputLabel: string
    errorLabel: string
    reasoningTitle: string
    reasoningHidden: string
  }
  picker: {
    prompt: string
    english: string
    russian: string
    saved: string
  }
  /** Live-status indicator texts; one `tools.<key>` label per REGISTRY tool. */
  liveStatus: {
    thinking: string
    preparingResponse: string
    /** Slot `{tool}` receives the humanized tool name. */
    runningTool: string
    tools: {
      web_fetch: string
      fetch_chat_link: string
      search_memory: string
      list_memory: string
      remember_memory: string
      search_memos: string
      save_memo: string
      list_memos: string
      create_task: string
      update_task: string
      delete_task: string
      get_task: string
      list_tasks: string
      search_tasks: string
      count_tasks: string
      add_comment: string
      create_project: string
      list_projects: string
      list_files: string
      search_staged_files: string
      upload_attachment: string
      resolve_staged_file: string
      create_recurring_task: string
      create_reminder: string
      create_alert: string
      list_reminders: string
      get_reminder: string
      update_reminder: string
      cancel_reminder: string
      lookup_group_history: string
      find_user: string
      get_current_time: string
    }
  }
  /** `/context` view texts; section labels keyed by stable section id. */
  contextView: {
    sections: {
      system_prompt: string
      base_instructions: string
      custom_instructions: string
      provider_addendum: string
      memory_context: string
      summary: string
      known_entities: string
      conversation_history: string
      tools: string
    }
    /** Slot `{count}` receives the fact/entity count. */
    factSingular: string
    factPlural: string
    /** Slot `{count}` receives the history message count. */
    messageSingular: string
    messagePlural: string
    /** Slots `{active}`/`{available}` receive the disclosed/full tool counts. */
    progressiveDisclosure: string
    headerWord: string
    tokensUnit: string
    tokenSuffix: string
    approximateMarker: string
    approximateFooter: string
  }
  /** User-facing AppError / tool-failure bodies; interpolated ids stay verbatim. */
  errors: {
    llm: {
      apiError: string
      rateLimited: string
      timeout: string
      tokenLimit: string
      fallback: string
    }
    validation: {
      invalidInput: string
      missingRequired: string
      fallback: string
    }
    system: {
      configMissing: string
      networkError: string
      unexpected: string
    }
    webFetch: {
      invalidUrl: string
      blockedHost: string
      blockedContentType: string
      tooLarge: string
      timeout: string
      rateLimited: string
      extractFailed: string
      upstreamError: string
      fallback: string
    }
    provider: {
      taskNotFound: string
      projectNotFound: string
      workspaceNotFound: string
      commentNotFound: string
      labelNotFound: string
      relationNotFound: string
      notFound: string
      accessDenied: string
      authFailed: string
      rateLimited: string
      validationFailed: string
      workflowPrefixKnown: string
      workflowPrefixUnknown: string
      workflowValidationNoFields: string
      workflowValidationWithFields: string
      unsupportedOperation: string
      statusNotFound: string
      linkTypeNotFound: string
      invalidResponse: string
      fallback: string
    }
    toolFailure: {
      providerScopeMissing: string
      actionFailed: string
      interrupted: string
    }
  }
  /** System-prompt fragments; tool names, parameter keys and JSON examples stay verbatim. */
  systemPrompt: {
    coreIntro: string
    providerlessIntro: string
    dueDates: string
    recurring: string
    deferred: string
    providerlessDeferred: string
    disclosureProtocol: string
    disclosureAlwaysTools: string
    disclosureAlwaysToolsWithExpand: string
    proactive: string
    userFacingWords: string
    steering: string
    webFetch: string
    chatLink: string
    workflow: string
    destructive: string
    relations: string
    memos: string
    memorySearch: string
    groupFindUser: string
    outputCore: string
    instructionsRule: string
    languageInstruction: string
    groupReminders: string
    groupRemindersWithParticipants: string
    unavailableTools: string
    askTools: string
  }
  /** Verified-completion verifier prompt fragments. */
  completion: {
    verifierSystem: string
    verifierSummarizeRule: string
    verifierTruncatedRule: string
    neutralFallback: string
    finalizeMessage: string
    doneFallback: string
  }
}

/** Dotted path to a string leaf of a `Dictionary` (e.g. `'commands.stop.stoppingNow'`). */
export type DictionaryKey = PathLeaves<Dictionary>

type PathLeaves<T> = T extends string
  ? never
  : { [K in keyof T & string]: T[K] extends string ? K : `${K}.${PathLeaves<T[K]>}` }[keyof T & string]

/** Named-slot interpolation values for `t()`; slots are written as `{name}`. */
export type TranslationParams = Record<string, string | number>
