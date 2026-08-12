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

export const OpenWolf: Plugin = async ({ directory }: { directory: string }) => {
  return {
    event: async ({ event }: { event: { type: string; [key: string]: unknown } }) => {
      if (event.type === "session.created" && !wolfDirExists(directory)) return

      const sessionId = (event as any).session_id || (event as any).sessionID
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

      const sessionId = input.sessionID
      if (!sessionId) return

      const args: Record<string, unknown> = output.args || {}
      const tool = input.tool.toLowerCase()

      if (tool === "read") {
        const filePath = String(args.filePath || args.file_path || "")
        if (filePath) handlePreRead(directory, sessionId, filePath)
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

      const sessionId = input.sessionID
      if (!sessionId) return

      const tool = input.tool.toLowerCase()
      const args = input.args || {}

      if (tool === "read") {
        const filePath = String(args.filePath || args.file_path || "")
        const content = String((output as any).output || "")
        if (filePath) handlePostRead(directory, sessionId, filePath, content)
      }

      if (tool === "write" || tool === "edit") {
        const filePath = args.filePath || args.file_path || ""
        const content = String(args.content || "")
        const oldStr = String(args.old_string || args.oldString || "")
        const newStr = String(args.new_string || args.newString || "")
        if (filePath) handlePostWrite(directory, sessionId, input.tool, filePath, content, oldStr, newStr)
      }
    },

    stop: async (input: Record<string, unknown>) => {
      if (!wolfDirExists(directory)) return

      const sessionId = (input as any).sessionID || (input as any).session_id
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