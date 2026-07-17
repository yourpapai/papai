// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  getAllConfig as _getAllConfig,
  isConfigKey as _isConfigKey,
  isSensitiveKey as _isSensitiveKey,
  maskValue as _maskValue,
  setConfig as _setConfig,
} from './config.js'

export const getAllConfig = _getAllConfig
export const isConfigKey = _isConfigKey
export const isSensitiveKey = _isSensitiveKey
export const maskValue = _maskValue
export const setConfig = _setConfig
