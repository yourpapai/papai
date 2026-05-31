// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export function formatKaneoProvisionedMessage(outcome: { kaneoUrl: string; email: string; password: string }): string {
  return `✅ Your Kaneo account has been created!\n🌐 ${outcome.kaneoUrl}\n📧 Email: ${outcome.email}\n🔑 Password: ${outcome.password}\n\nThe bot is already configured and ready to use.`
}

export const KANEO_REGISTRATION_DISABLED_MESSAGE =
  'Kaneo account could not be created — registration is currently disabled on this instance.\n\nPlease ask the admin to provision your account.'

export function formatKaneoProvisionFailureMessage(error: string): string {
  return `Kaneo account could not be created — ${error}. Please ask the admin to check setup.`
}
