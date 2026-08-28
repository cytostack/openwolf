import type { Plugin } from "@kilocode/plugin"
import * as fs from "node:fs"
import * as path from "node:path"

import { wolfDirExists, getWolfDir } from "./fs.js"
import { handleSessionStart, getSessionState, deleteSession, handlePrecompact } from "./session.js"
import { handlePreRead } from "./pre-read.js"
import { handlePreWrite } from "./pre-write.js"
import { handlePostRead } from "./post-read.js"
import { handlePostWrite } from "./post-write.js"
import { handleStop } from "./stop.js"

export function sessionIdOf(
  event: { type: string; properties?: Record<string, unknown> } & Record<string, unknown>,
): string {
  const properties = (event.properties ?? {}) as Record<string, unknown>
  const info = properties.info as { id?: string } | undefined
  return String(
    info?.id ||
    properties.sessionID ||
    event.sessionID ||
    event.session_id ||
    "",
  )
}

export const server: Plugin = async ({ directory }) => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.created" && !wolfDirExists(directory)) return
      const sessionId = sessionIdOf(event as { type: string; properties?: Record<string, unknown> })
      if (!sessionId) return
      if (event.type === "session.created") handleSessionStart(directory, sessionId)
      // Kilo does not re-emit session.created for restored sessions. Treat the first
      // session.updated as the start signal so restored sessions still seed session state.
      if (event.type === "session.updated" && !getSessionState(sessionId)) handleSessionStart(directory, sessionId)
      if (event.type === "session.deleted") deleteSession(sessionId)
      if (event.type === "session.idle") handleStop(directory, sessionId)
    },

    "experimental.session.compacting": async (input, _output) => {
      if (!wolfDirExists(directory)) return
      handlePrecompact(directory, input.sessionID)
    },

    "tool.execute.before": async (input: { tool: string; sessionID: string }, output: { args: Record<string, unknown> }) => {
      if (!wolfDirExists(directory)) return

      const sessionId = input.sessionID
      if (!sessionId) return

      const args: Record<string, unknown> = output.args || {}
      const tool = input.tool.toLowerCase()

      if (tool === "read") {
        const filePath = String(args.filePath || args.file_path || "")
        if (filePath) handlePreRead(directory, sessionId, filePath)
      }

      if (tool === "write" || tool === "edit" || tool === "multiedit") {
        const filePath = String(args.filePath || args.file_path || "")
        const content = String(args.content || "")
        const oldStr = String(args.old_string || args.oldString || "")
        const newStr = String(args.new_string || args.newString || "")
        if (filePath) handlePreWrite(directory, sessionId, filePath, content, oldStr, newStr)
      }
    },

    "tool.execute.after": async (input: { tool: string; sessionID: string; args: Record<string, unknown> }, output: Record<string, unknown>) => {
      if (!wolfDirExists(directory)) return

      const sessionId = input.sessionID
      if (!sessionId) return

      const tool = input.tool.toLowerCase()
      const args = input.args || {}

      if (tool === "read") {
        const filePath = String(args.filePath || args.file_path || "")
        const content = String((output as { output?: unknown }).output || "")
        if (filePath) handlePostRead(directory, sessionId, filePath, content)
      }

      if (tool === "write" || tool === "edit" || tool === "multiedit") {
        const filePath = args.filePath || args.file_path || ""
        const content = String(args.content || "")
        const oldStr = String(args.old_string || args.oldString || "")
        const newStr = String(args.new_string || args.newString || "")
        if (filePath) handlePostWrite(directory, sessionId, input.tool, String(filePath), content, oldStr, newStr)
      }
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
