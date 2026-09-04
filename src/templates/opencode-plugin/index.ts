import type { Plugin } from "@opencode-ai/plugin"
import * as fs from "node:fs"
import * as path from "node:path"

import { wolfDirExists, getWolfDir } from "./fs.js"
import { handleSessionStart, deleteSession } from "./session.js"
import { handlePreRead } from "./pre-read.js"
import { handlePreWrite } from "./pre-write.js"
import { handlePostRead } from "./post-read.js"
import { handlePostWrite } from "./post-write.js"
import { handleStop } from "./stop.js"

/**
 * OpenCode event payloads have carried the session id in different places
 * across versions: top-level `session_id`/`sessionID` in older builds, and
 * nested under `properties` (`properties.info.id` for session.created,
 * `properties.sessionID` elsewhere) in newer ones. Accept all shapes.
 */
function extractSessionId(source: unknown): string {
  if (!source || typeof source !== "object") return ""
  const obj = source as {
    session_id?: unknown
    sessionID?: unknown
    properties?: { info?: { id?: unknown }; sessionID?: unknown }
  }
  const candidates = [
    obj.session_id,
    obj.sessionID,
    obj.properties?.info?.id,
    obj.properties?.sessionID,
  ]
  for (const c of candidates) {
    if (typeof c === "string" && c) return c
  }
  return ""
}

export const OpenWolf: Plugin = async ({ directory }: { directory: string }) => {
  return {
    event: async ({ event }: { event: { type: string; [key: string]: unknown } }) => {
      if (event.type === "session.created" && !wolfDirExists(directory)) return

      const sessionId = extractSessionId(event)
      if (!sessionId) return

      if (event.type === "session.created") {
        handleSessionStart(directory, sessionId)
      }

      if (event.type === "session.deleted") {
        deleteSession(sessionId)
      }
    },

    "tool.execute.before": async (input: { tool: string; sessionID: string }, output: { args: Record<string, unknown> }) => {
      if (!wolfDirExists(directory)) return

      const sessionId = extractSessionId(input)
      if (!sessionId) return

      const args: Record<string, unknown> = output.args || {}
      const tool = input.tool.toLowerCase()

      if (tool === "read") {
        const filePath = String(args.filePath || args.file_path || "")
        const isRangedRead = args.offset !== undefined || args.limit !== undefined
        if (filePath) handlePreRead(directory, sessionId, filePath, isRangedRead)
      }

      if (tool === "write" || tool === "edit") {
        const filePath = String(args.filePath || args.file_path || "")
        const content = String(args.content || "")
        const oldStr = String(args.old_string || args.oldString || "")
        const newStr = String(args.new_string || args.newString || "")
        if (filePath) handlePreWrite(directory, sessionId, filePath, content, oldStr, newStr)
      }
    },

    "tool.execute.after": async (input: { tool: string; sessionID: string; args: Record<string, unknown> }, output: Record<string, unknown>) => {
      if (!wolfDirExists(directory)) return

      const sessionId = extractSessionId(input)
      if (!sessionId) return

      const tool = input.tool.toLowerCase()
      const args = input.args || {}

      if (tool === "read") {
        const filePath = String(args.filePath || args.file_path || "")
        const content = String((output as any).output || "")
        if (filePath) handlePostRead(directory, sessionId, filePath, content)
      }

      if (tool === "write" || tool === "edit") {
        const filePath = String(args.filePath || args.file_path || "")
        const content = String(args.content || "")
        const oldStr = String(args.old_string || args.oldString || "")
        const newStr = String(args.new_string || args.newString || "")
        if (filePath) handlePostWrite(directory, sessionId, input.tool, filePath, content, oldStr, newStr)
      }
    },

    stop: async (input: Record<string, unknown>) => {
      if (!wolfDirExists(directory)) return

      const sessionId = extractSessionId(input)
      if (!sessionId) return

      handleStop(directory, sessionId)
    },

    "experimental.chat.system.transform": async (_input: Record<string, unknown>, output: { system: string[] }) => {
      if (!wolfDirExists(directory)) return

      const wolfDir = getWolfDir(directory)
      const openwolfPath = path.join(wolfDir, "OPENWOLF.md")
      if (fs.existsSync(openwolfPath)) {
        try {
          const openwolfContent = fs.readFileSync(openwolfPath, "utf-8")
          output.system.push(`\n<openwolf-protocol>\n${openwolfContent}\n</openwolf-protocol>`)
        } catch {}
      }
    },
  }
}