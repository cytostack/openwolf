import { pathToFileURL } from "node:url"
import * as path from "node:path"
import { pinRuntime, scheduleUpdate } from "./runtime-updates.js"
import {
  extractSessionId,
  handleOpenCodeEvent,
  handleOpenCodeToolAfter,
  handleOpenCodeToolBefore,
  openWolfSystemText,
} from "./core.js"

type V2SystemPart = { type: "text"; text: string }
type V2ToolBeforeEvent = {
  readonly tool: string
  readonly sessionID: string
  input: unknown
}
type V2ToolAfterEvent = {
  readonly tool: string
  readonly sessionID: string
  readonly id: string
  readonly input: unknown
  readonly status: "completed" | "error"
  readonly result?: unknown
  readonly error?: { message: string }
}
type V2ContextEvent = { system: V2SystemPart[] }
type V2Context = {
  location: { directory: string }
  event: {
    subscribe(options?: { signal?: AbortSignal }): AsyncIterable<unknown>
  }
  tool: {
    hook(name: "execute.before", callback: (event: V2ToolBeforeEvent) => void): Promise<unknown>
    hook(name: "execute.after", callback: (event: V2ToolAfterEvent) => void): Promise<unknown>
  }
  session: {
    hook(name: "context", callback: (event: V2ContextEvent) => void): Promise<unknown>
  }
}
type V2Plugin = {
  id: string
  setup(context: V2Context): Promise<(() => void) | void> | (() => void) | void
}

/**
 * The installed entrypoint owns runtime selection. A staged release imports
 * this function directly so it can replace only the implementation while the
 * current OpenCode plugin instance remains pinned for its lifetime.
 */
export async function setupOpenWolfV2(ctx: V2Context): Promise<(() => void) | void> {
  const directory = ctx.location.directory
  const sessionKey = `opencode-server:${process.pid}:${Date.now()}`
  scheduleUpdate(directory)

  let pkg: string | undefined
  try {
    pkg = pinRuntime(directory, sessionKey)
  } catch {}
  if (pkg) {
    try {
      const next = await import(
        pathToFileURL(path.join(pkg, "src/templates/opencode-plugin/index-v2.ts")).href,
      )
      if (typeof next.setupOpenWolfV2 === "function" && next.setupOpenWolfV2 !== setupOpenWolfV2) {
        return await next.setupOpenWolfV2(ctx)
      }
    } catch {
      // Retain the installed plugin if the staged module cannot load.
    }
  }

  const controller = new AbortController()
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        await handleOpenCodeEvent(directory, event as unknown as Record<string, unknown>)
      }
    } catch {
      // Subscription ends normally when OpenCode unloads the plugin.
    }
  })()

  await ctx.tool.hook("execute.before", event => {
    handleOpenCodeToolBefore(directory, extractSessionId(event), event.tool, event.input)
  })

  await ctx.tool.hook("execute.after", event => {
    const result = event.status === "completed"
      ? event.result
      : { output: event.error?.message ?? "" }
    handleOpenCodeToolAfter(
      directory,
      extractSessionId(event),
      event.tool,
      event.input,
      result,
      event.id,
    )
  })

  await ctx.session.hook("context", event => {
    const text = openWolfSystemText(directory)
    if (text) event.system.push({ type: "text", text })
  })

  return () => controller.abort()
}

// OpenCode validates this default shape. The official Plugin.define helper is
// an identity wrapper; keeping the generated local plugin dependency-free
// avoids requiring users to add a second .opencode package manifest.
const plugin: V2Plugin = {
  id: "openwolf",
  setup: setupOpenWolfV2,
}

export default plugin
