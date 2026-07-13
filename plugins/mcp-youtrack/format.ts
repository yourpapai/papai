// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Response-shaping helpers live in ./format-shapers.js (issue/user/tag/link
// primitives) and ./format-activity-shapers.js (comment/attachment/activity/
// field-option primitives, kept in a separate module to stay under the
// max-lines limit). This module is the public entry point (field-selection
// constants + re-exported shaping API) so callers only need to import from
// './format.js'.

export const ISSUE_FIELDS =
  'idReadable,summary,description,reporter(login,fullName),tags(id,name),customFields(name,value(name,login,fullName,text)),links(id,direction,linkType(name,sourceToTarget,targetToSource),issues(id,idReadable,summary))'
export const COMMENT_READ_FIELDS =
  'id,text,created,updated,deleted,author(login,fullName),attachments(id,name,size,mimeType)'
export const COMMENT_WRITE_FIELDS = 'id,text,author(login,fullName),created'
export const ACTIVITY_FIELDS = 'timestamp,field(name),added(name),removed(name),target(idReadable)'
export const ATTACHMENT_FIELDS = 'id,name,size,mimeType,url,author(login,fullName),created'
export const FIELD_OPTIONS_FIELDS = 'customFields(name,$type,projectCustomField(bundle(values(name))))'

export type {
  ShapedActivity,
  ShapedActivityField,
  ShapedActivityTarget,
  ShapedAttachment,
  ShapedComment,
  ShapedFieldOption,
} from './format-activity-shapers.js'
export { shapeActivity, shapeAttachment, shapeComment, shapeFieldOptions } from './format-activity-shapers.js'
export type {
  ShapedCustomField,
  ShapedIssue,
  ShapedLink,
  ShapedLinkIssue,
  ShapedLinkType,
  ShapedTag,
  ShapedUser,
} from './format-shapers.js'
export { shapeFieldValue, shapeIssue, shapeUser } from './format-shapers.js'
