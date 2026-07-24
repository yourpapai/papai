// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type DeliveryErrorClass = 'ambiguous_ack' | 'http_permanent' | 'http_retryable' | 'network_unknown'

export type DeliveryResult =
  | Readonly<{ kind: 'delivered'; status: number }>
  | Readonly<{ errorClass: 'ambiguous_ack' | 'network_unknown'; kind: 'ambiguous' }>
  | Readonly<{ errorClass: 'http_retryable'; kind: 'retryable'; status: number }>
  | Readonly<{ errorClass: 'http_permanent'; kind: 'permanent'; status: number }>
