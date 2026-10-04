import type { Plugin } from "@opencode-ai/plugin"
import { reconcileOpenCode } from "./usage.js"
import { showActivityToast } from "./visibility.js"
import { wolfDirExists } from "./fs.js"
import {
  extractSessionId,
  handleOpenCodeEvent,
  handleOpenCodeStop,
  handleOpenCodeToolAfter,
  handleOpenCodeToolBefore,
  openWolfSystemText,
} from "./core.js"

export const OpenWolf: Plugin = async ({ directory, client }) => {
  let reconciliation: Promise<void> = Promise.resolve()
  const refreshUsage = (id?: string) => {
    reconciliation = reconciliation
      .then(() => reconcileOpenCode(directory, client, id))
      .catch(error => console.warn(`OpenWolf usage reconciliation: ${error}`))
    return reconciliation
  }
  if (wolfDirExists(directory)) void refreshUsage()

  return {
    event: async ({ event }: { event: { type: string; [key: string]: unknown } }) => {
      await handleOpenCodeEvent(directory, event, {
        beforeStop: sessionId => refreshUsage(sessionId),
        toast: message => showActivityToast(client, message),
      })
    },

    "tool.execute.before": async (
      input: { tool: string; sessionID: string },
      output: { args: Record<string, unknown> },
    ) => {
      handleOpenCodeToolBefore(directory, extractSessionId(input), input.tool, output.args)
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; args: Record<string, unknown>; callID?: string },
      output: Record<string, unknown>,
    ) => {
      handleOpenCodeToolAfter(
        directory,
        extractSessionId(input),
        input.tool,
        input.args,
        output,
        input.callID,
      )
    },

    stop: async (input: Record<string, unknown>) => {
      handleOpenCodeStop(directory, input)
    },

    "experimental.chat.system.transform": async (
      _input: Record<string, unknown>,
      output: { system: string[] },
    ) => {
      const text = openWolfSystemText(directory)
      if (text) output.system.push(text)
    },
  }
}
