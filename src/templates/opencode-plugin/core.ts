import {activityState} from './visibility.js'
import {scheduleUpdate, updateNotice} from "./runtime-updates.js"
import { mutateJSON, HOOK_LOCK_BUDGET_MS } from "./anatomy-lock.js"
import {readJSON,sessionFilePath} from "./fs.js"
import { recordUsage } from "./usage.js"
import { approvedMemory } from "./trusted-memory.js"
import * as fs from "node:fs"
import * as path from "node:path"

import { wolfDirExists, getWolfDir } from "./fs.js"
import { handleSessionStart, deleteSession } from "./session.js"
import { handlePreRead } from "./pre-read.js"
import { handlePreWrite } from "./pre-write.js"
import { handlePostRead } from "./post-read.js"
import { handlePostWrite } from "./post-write.js"
import { handleStop } from "./stop.js"

export type OpenCodeEvent = { type?: unknown; [key: string]: unknown }

export interface OpenCodeEventOptions {
  beforeStop?: (sessionId: string) => Promise<void> | void
  toast?: (message: string) => void
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function eventData(event: OpenCodeEvent): Record<string, unknown> {
  const data = record(event.data)
  if (Object.keys(data).length > 0) return data
  return record(event.properties)
}

/**
 * OpenCode event payloads have changed shape between plugin generations. V1
 * uses top-level/properties fields; V2 uses a durable `data` envelope. Keep
 * the integration tolerant so the filesystem handlers stay version-neutral.
 */
export function extractSessionId(source: unknown): string {
  const obj = record(source)
  const properties = record(obj.properties)
  const data = record(obj.data)
  const propertyInfo = record(properties.info)
  const dataInfo = record(data.info)
  const candidates = [
    obj.session_id,
    obj.sessionID,
    obj.sessionId,
    properties.session_id,
    properties.sessionID,
    properties.sessionId,
    propertyInfo.id,
    propertyInfo.session_id,
    propertyInfo.sessionID,
    data.session_id,
    data.sessionID,
    data.sessionId,
    dataInfo.id,
    dataInfo.session_id,
    dataInfo.sessionID,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) return candidate
  }
  return ""
}

function eventType(event: OpenCodeEvent): string {
  return typeof event.type === "string" ? event.type : ""
}

function recordV2Usage(directory: string, event: OpenCodeEvent): void {
  const data = eventData(event)
  const sessionId = typeof data.sessionID === "string" ? data.sessionID : ""
  if (!sessionId || !data.tokens) return

  // V2 publishes usage as a session event rather than the V1
  // message.updated/info payload. The event id is stable for this durable
  // update and keeps repeated deliveries idempotent in the usage store.
  const id = typeof event.id === "string" ? event.id : `${sessionId}:${Date.now()}`
  recordUsage(directory, {
    id,
    role: "assistant",
    sessionID: sessionId,
    providerID: data.providerID,
    modelID: data.modelID,
    tokens: data.tokens,
    time: { completed: event.created },
  })
}

export async function handleOpenCodeEvent(
  directory: string,
  event: OpenCodeEvent,
  options: OpenCodeEventOptions = {},
): Promise<void> {
  const type = eventType(event)
  if (type === "session.created" && !wolfDirExists(directory)) return

  if (!wolfDirExists(directory)) return
  if (type === "message.updated") {
    const info = record(eventData(event).info)
    if (Object.keys(info).length > 0) {
      try { recordUsage(directory, info) } catch (error) { console.warn(String(error)) }
    }
  }
  if (type === "session.usage.updated" || type === "session.usage.recorded") {
    try { recordV2Usage(directory, event) } catch (error) { console.warn(String(error)) }
  }

  const sessionId = extractSessionId(event)
  if (!sessionId) return

  if (type === "session.created") {
    handleSessionStart(directory, sessionId)
    scheduleUpdate(directory)
    const notice = updateNotice(directory, sessionId)
    if (notice) options.toast?.(notice)
  }

  // V1 and V2 use different error/execution event names, but both retain an
  // idle boundary. Do not treat execution success as a stop: V2 also emits an
  // idle event and doing both would increment stop_count twice per turn.
  const ended = type === "session.idle" ||
    type === "session.error" ||
    type === "session.deleted" ||
    type === "session.execution.failed" ||
    type === "session.execution.interrupted"
  if (!ended) return

  scheduleUpdate(directory)
  const update = updateNotice(directory, sessionId)
  const activity = update ?? activityState(
    directory,
    {
      agent: "opencode",
      session: sessionId,
      turn: String(readJSON<Record<string, unknown>>(
        sessionFilePath(pathForHooks(directory), sessionId),
        {},
      ).stop_count ?? 0),
      surface: "opencode-toast",
    },
  ).message
  if (activity) options.toast?.(activity)

  try {
    await options.beforeStop?.(sessionId)
  } catch {
    // Reconciliation is advisory; it must never prevent the session ledger
    // from being flushed at its normal stop boundary.
  }
  handleStop(directory, sessionId)

  if (type === "session.deleted") {
    const file = sessionFilePath(pathForHooks(directory), sessionId)
    mutateJSON<Record<string, unknown>>(
      file,
      {},
      HOOK_LOCK_BUDGET_MS,
      state => { state.ended = new Date().toISOString() },
    )
    deleteSession(sessionId)
  }
}

function pathForHooks(directory: string): string {
  return path.join(getWolfDir(directory), "hooks")
}

function toolArgs(value: unknown): Record<string, unknown> {
  return record(value)
}

export function handleOpenCodeToolBefore(
  directory: string,
  sessionId: string,
  toolName: unknown,
  input: unknown,
): void {
  if (!wolfDirExists(directory) || !sessionId || typeof toolName !== "string") return

  const args = toolArgs(input)
  const tool = toolName.toLowerCase()
  if (tool === "read") {
    const filePath = String(args.filePath || args.file_path || "")
    const ranged = args.offset !== undefined || args.limit !== undefined
    if (filePath) handlePreRead(directory, sessionId, filePath, ranged)
  }

  if (tool === "write" || tool === "edit") {
    const filePath = String(args.filePath || args.file_path || "")
    const content = String(args.content || "")
    const oldStr = String(args.old_string || args.oldString || "")
    const newStr = String(args.new_string || args.newString || "")
    if (filePath) handlePreWrite(directory, sessionId, filePath, content, oldStr, newStr)
  }
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object") return value === undefined ? "" : String(value)
  const object = value as Record<string, unknown>
  if (typeof object.output === "string") return object.output
  if (typeof object.text === "string") return object.text
  if (Array.isArray(object.content)) {
    return object.content
      .map(part => {
        const item = record(part)
        return typeof item.text === "string" ? item.text : ""
      })
      .filter(Boolean)
      .join("\n")
  }
  return JSON.stringify(value) || ""
}

export function handleOpenCodeToolAfter(
  directory: string,
  sessionId: string,
  toolName: unknown,
  input: unknown,
  result: unknown,
  callId?: string,
): void {
  if (!wolfDirExists(directory) || !sessionId || typeof toolName !== "string") return

  const args = toolArgs(input)
  const tool = toolName.toLowerCase()
  if (tool === "read") {
    const filePath = String(args.filePath || args.file_path || "")
    const ranged = args.offset !== undefined || args.limit !== undefined
    if (filePath) handlePostRead(directory, sessionId, filePath, contentText(result), ranged, callId)
  }

  if (tool === "write" || tool === "edit") {
    const filePath = String(args.filePath || args.file_path || "")
    const content = String(args.content || "")
    const oldStr = String(args.old_string || args.oldString || "")
    const newStr = String(args.new_string || args.newString || "")
    if (filePath) handlePostWrite(directory, sessionId, toolName, filePath, content, oldStr, newStr)
  }
}

export function handleOpenCodeStop(directory: string, source: unknown): void {
  if (!wolfDirExists(directory)) return
  const sessionId = extractSessionId(source)
  if (sessionId) handleStop(directory, sessionId)
}

export function openWolfSystemText(directory: string): string | undefined {
  if (!wolfDirExists(directory)) return
  const openwolfPath = path.join(getWolfDir(directory), "OPENWOLF.md")
  try {
    if (!fs.existsSync(openwolfPath)) return
    const openwolfContent = approvedMemory(getWolfDir(directory), "OPENWOLF.md")
    return `\n<openwolf-protocol>\n${openwolfContent}\n</openwolf-protocol>`
  } catch {}
}
