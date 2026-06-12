// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type {
  PluginAttachmentTransformer,
  PluginCommand,
  PluginManifest,
  PluginPromptFragment,
  PluginScheduledJob,
  PluginTool,
} from './types.js'

export type ActivationGuard = {
  assertOpen(): void
  close(): void
}

type RegistrationNames = {
  declaredTools: ReadonlySet<string>
  declaredFragments: ReadonlySet<string>
  declaredCommands: ReadonlySet<string>
  declaredJobs: ReadonlySet<string>
  declaredTransformers: ReadonlySet<string>
  registeredTools: Set<string>
  registeredFragments: Set<string>
  registeredCommands: Set<string>
  registeredJobs: Set<string>
  registeredTransformers: Set<string>
}

type RegistrationKind = 'Tool' | 'Prompt fragment' | 'Command' | 'Scheduled job' | 'Attachment transformer'

type SupportedRegistration =
  | PluginTool
  | PluginPromptFragment
  | PluginCommand
  | PluginScheduledJob
  | PluginAttachmentTransformer

function collectRegisteredNames(manifest: PluginManifest): RegistrationNames {
  return {
    declaredTools: new Set(manifest.contributes.tools),
    declaredFragments: new Set(manifest.contributes.promptFragments),
    declaredCommands: new Set(manifest.contributes.commands),
    declaredJobs: new Set(manifest.contributes.jobs),
    declaredTransformers: new Set(manifest.contributes.attachmentTransformers ?? []),
    registeredTools: new Set<string>(),
    registeredFragments: new Set<string>(),
    registeredCommands: new Set<string>(),
    registeredJobs: new Set<string>(),
    registeredTransformers: new Set<string>(),
  }
}

function rejectDuplicateRegistration(kind: RegistrationKind, name: string, duplicate: boolean): void {
  if (duplicate) {
    throw new Error(`${kind} '${name}' was registered more than once`)
  }
}

function assertDeclaredRegistration(errorMessage: string, name: string, declared: ReadonlySet<string>): void {
  if (!declared.has(name)) {
    throw new Error(errorMessage.replace('{name}', name))
  }
}

function buildNamedRegistration<T extends SupportedRegistration>(args: {
  kind: RegistrationKind
  declarationErrorMessage: string
  declared: ReadonlySet<string>
  registered: Set<string>
  activationGuard: ActivationGuard
  readName(value: T): string
  onRegister(value: T): void
}): (value: T) => void {
  return (value: T): void => {
    const name = args.readName(value)
    args.activationGuard.assertOpen()
    assertDeclaredRegistration(args.declarationErrorMessage, name, args.declared)
    rejectDuplicateRegistration(args.kind, name, args.registered.has(name))
    args.registered.add(name)
    args.onRegister(value)
  }
}

export function buildActivationGuard(): ActivationGuard {
  let open = true
  return {
    assertOpen(): void {
      if (!open) {
        throw new Error('Plugin registration is only allowed during activation')
      }
    },
    close(): void {
      open = false
    },
  }
}

function buildToolRegistration(
  names: RegistrationNames,
  args: { activationGuard: ActivationGuard; registerTool(tool: PluginTool): void },
): (tool: PluginTool) => void {
  return buildNamedRegistration({
    kind: 'Tool',
    declarationErrorMessage: "Tool '{name}' is not declared in plugin manifest contributes.tools",
    declared: names.declaredTools,
    registered: names.registeredTools,
    activationGuard: args.activationGuard,
    readName: (tool) => tool.name,
    onRegister: (tool) => {
      args.registerTool(tool)
    },
  })
}

function buildPromptFragmentRegistration(
  names: RegistrationNames,
  args: { activationGuard: ActivationGuard; registerPromptFragment(fragment: PluginPromptFragment): void },
): (fragment: PluginPromptFragment) => void {
  return buildNamedRegistration({
    kind: 'Prompt fragment',
    declarationErrorMessage: "Prompt fragment '{name}' is not declared in plugin manifest contributes.promptFragments",
    declared: names.declaredFragments,
    registered: names.registeredFragments,
    activationGuard: args.activationGuard,
    readName: (fragment) => fragment.name,
    onRegister: (fragment) => {
      args.registerPromptFragment(fragment)
    },
  })
}

function buildCommandRegistration(
  manifest: PluginManifest,
  names: RegistrationNames,
  args: { activationGuard: ActivationGuard; registerCommand(command: PluginCommand): void },
): (command: PluginCommand) => void {
  return buildNamedRegistration({
    kind: 'Command',
    declarationErrorMessage: "Command '{name}' is not declared in plugin manifest contributes.commands",
    declared: names.declaredCommands,
    registered: names.registeredCommands,
    activationGuard: args.activationGuard,
    readName: (command) => command.name,
    onRegister: (command) => {
      if (!manifest.permissions.includes('commands')) {
        throw new Error(`Plugin ${manifest.id} cannot register commands without 'commands'`)
      }
      args.registerCommand(command)
    },
  })
}

function buildScheduledJobRegistration(
  manifest: PluginManifest,
  names: RegistrationNames,
  args: { activationGuard: ActivationGuard; registerScheduledJob(job: PluginScheduledJob): void },
): (job: PluginScheduledJob) => void {
  return buildNamedRegistration({
    kind: 'Scheduled job',
    declarationErrorMessage: "Scheduled job '{name}' is not declared in plugin manifest contributes.jobs",
    declared: names.declaredJobs,
    registered: names.registeredJobs,
    activationGuard: args.activationGuard,
    readName: (job) => job.name,
    onRegister: (job) => {
      if (!manifest.permissions.includes('scheduler')) {
        throw new Error(`Plugin ${manifest.id} cannot register scheduled jobs without 'scheduler'`)
      }
      args.registerScheduledJob(job)
    },
  })
}

function buildAttachmentTransformerRegistration(
  names: RegistrationNames,
  args: {
    activationGuard: ActivationGuard
    registerAttachmentTransformer(transformer: PluginAttachmentTransformer): void
  },
): (transformer: PluginAttachmentTransformer) => void {
  return buildNamedRegistration({
    kind: 'Attachment transformer',
    declarationErrorMessage:
      "Attachment transformer '{name}' is not declared in plugin manifest contributes.attachmentTransformers",
    declared: names.declaredTransformers,
    registered: names.registeredTransformers,
    activationGuard: args.activationGuard,
    readName: (transformer) => transformer.name,
    onRegister: (transformer) => {
      args.registerAttachmentTransformer(transformer)
    },
  })
}

export function buildNamedRegistrationHandlers(
  manifest: PluginManifest,
  args: {
    activationGuard: ActivationGuard
    registerTool(tool: PluginTool): void
    registerPromptFragment(fragment: PluginPromptFragment): void
    registerCommand(command: PluginCommand): void
    registerScheduledJob(job: PluginScheduledJob): void
    registerAttachmentTransformer(transformer: PluginAttachmentTransformer): void
  },
): {
  registerTool(tool: PluginTool): void
  registerPromptFragment(fragment: PluginPromptFragment): void
  registerCommand(command: PluginCommand): void
  registerScheduledJob(job: PluginScheduledJob): void
  registerAttachmentTransformer(transformer: PluginAttachmentTransformer): void
} {
  const names = collectRegisteredNames(manifest)
  return {
    registerTool: buildToolRegistration(names, args),
    registerPromptFragment: buildPromptFragmentRegistration(names, args),
    registerCommand: buildCommandRegistration(manifest, names, args),
    registerScheduledJob: buildScheduledJobRegistration(manifest, names, args),
    registerAttachmentTransformer: buildAttachmentTransformerRegistration(names, args),
  }
}
