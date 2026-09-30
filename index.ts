import { appendFileSync, renameSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Server } from "node:http"

let LOG = join(homedir(), ".config/opencode/plugins/antigravity/debug.log");

function dbg(msg: string) {
  try {
    appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {
    /* ignore */
  }
}

/** Keep the diagnostic log bounded. */
function rotateLog() {
  try {
    const stat = statSync(LOG)
    if (stat.size > 512 * 1024) {
      renameSync(LOG, `${LOG}.1`)
    }
  } catch {
    /* file may not exist yet */
  }
}

const V1_ENTRY = "./node_modules/opencode-antigravity-auth/dist/index.js"
const V1_TOKEN_ENTRY = "./node_modules/opencode-antigravity-auth/dist/src/plugin/token.js"
const INTEGRATION_ID = "google"
const OAUTH_METHOD_ID = "antigravity"
const PROVIDER_ID = "google"

const SEARCH_INPUT = {
  type: "object",
  properties: {
    query: { type: "string", description: "The search query or question to answer using web search" },
    urls: {
      type: "array",
      items: { type: "string" },
      description:
        "List of specific URLs to fetch and analyze. IMPORTANT: Always extract and include any URLs mentioned by the user in their query here.",
    },
    thinking: {
      type: "boolean",
      default: true,
      description: "Enable deep thinking for more thorough analysis (default: true)",
    },
  },
  required: ["query"],
  additionalProperties: false,
} as const

/** V1 `authorize()` -> V2 `authorize()`. */
function adaptAuthorize(v1method: any) {
  return async (answer: Record<string, any>) => {
    // V1 branches on `if (inputs)`:
    //   truthy -> CLI flow, which prompts via readline on the SERVER's stdin.
    //            The background service has no TTY, so it blocked forever and the
    //            TUI sat on "Starting authorization..." until the request was cut (499).
    //   falsy  -> TUI flow (the `/connect` path this comment describes): starts a
    //            local listener, opens the browser and returns immediately.
    // The V1 method has no prompts of its own (verified: keys=label,type,authorize),
    // so there is no form data to forward and we always take the TUI branch.
    dbg(`authorize called, answer=${JSON.stringify(answer ?? null)} -> invoking V1 with undefined`)
    const res = await v1method.authorize(undefined)
    dbg(
      `authorize returned method=${res?.method} url=${String(res?.url ?? "").slice(0, 70)} instructions=${String(res?.instructions ?? "").slice(0, 60)}`,
    )

    // V1 hands back a PROMISE of `{type:"success"|"failed", ...}`, not the result
    // itself. Forgetting to await it makes `r.type` undefined and every login
    // fail with the generic fallback message, even though V1 succeeded.
    const mapResult = async (pending: any) => {
      const r = await pending
      if (!r || r.type !== "success") {
        dbg(`oauth result NOT success: ${String(r?.error ?? r?.type ?? "no result")}`)
        throw new Error(r?.error ?? "Antigravity authentication failed")
      }
      const metadata: Record<string, string> = {}
      if (r.accountId) metadata.accountId = String(r.accountId)
      if (r.enterpriseUrl) metadata.enterpriseUrl = String(r.enterpriseUrl)
      if (r.email) metadata.email = String(r.email)
      if (r.provider) metadata.provider = String(r.provider)
      const credential = {
        type: "oauth" as const,
        methodID: OAUTH_METHOD_ID,
        refresh: String(r.refresh ?? ""),
        access: String(r.access ?? ""),
        // Credential.OAuth.expires is Schema.Int; a fractional epoch would be rejected.
        expires: Math.round(Number(r.expires ?? 0)),
        metadata,
      }
      dbg(
        `oauth credential built refreshLen=${credential.refresh.length} accessLen=${credential.access.length} expires=${credential.expires} resultKeys=[${Object.keys(r).join(",")}]`,
      )
      return credential
    }

    if (res.method === "code") {
      return {
        url: res.url,
        instructions: res.instructions,
        mode: "code" as const,
        callback: async (code: string) => {
          const out = await mapResult(res.callback(code))
          dbg("authorize code callback succeeded")
          return out
        },
      }
    }
    return {
      url: res.url,
      instructions: res.instructions,
      mode: "auto" as const,
      callback: mapResult(
        res.callback().then((r: any) => {
          dbg(`authorize auto callback -> ${r?.type ?? "unknown"}${r?.error ? ` (${r.error})` : ""}`)
          return r
        }),
      ),
    }
  }
}

export default {
  id: "antigravity-auth",
  async setup(ctx: any) {
    LOG = join(ctx.location.directory, "debug.log");
    dbg(`setup start opencode=${ctx.app.version} dir=${ctx.location.directory}`)
    rotateLog()

    // ---- V1-shaped client shim -------------------------------------------
    const v1client = {
      auth: {
        set: async (args: any) => {
          dbg(`client.auth.set refreshLen=${args?.body?.refresh?.length ?? 0}`)
          try {
            await ctx.storage.set("primary-auth", {
              type: "oauth",
              refresh: args?.body?.refresh ?? "",
              access: args?.body?.access ?? "",
              expires: Number(args?.body?.expires ?? 0),
            })
          } catch (e: any) {
            dbg(`client.auth.set storage ERR ${e?.message}`)
          }
        },
      },
      session: {
        prompt: async (args: any) => {
          try {
            const text = (args?.body?.parts ?? []).map((p: any) => p?.text ?? "").join("\n")
            return await ctx.session.prompt({ sessionID: args?.path?.id, text })
          } catch (e: any) {
            dbg(`client.session.prompt ERR ${e?.message}`)
            return {}
          }
        },
      },
      tui: {
        showToast: async (args: any) => dbg(`toast: ${args?.body?.message ?? ""}`),
      },
    }

    const mod: any = await import(V1_ENTRY)
    const tokenMod: any = await import(V1_TOKEN_ENTRY).catch(() => ({}))
    const makeV1 = mod.AntigravityCLIOAuthPlugin
    if (typeof makeV1 !== "function") throw new Error("AntigravityCLIOAuthPlugin is not a function")

    const v1 = await makeV1({ client: v1client, directory: ctx.location.directory })
    const v1methods = v1?.auth?.methods ?? []
    const loader: any = v1?.auth?.loader
    dbg(`V1 ready methods=${v1methods.length} loader=${typeof loader}`)

    // ---- auth access ------------------------------------------------------
    /** V1-shaped `{type:"oauth", refresh, access, expires}`. */
    async function getAuth(): Promise<any> {
      try {
        const stored: any = await ctx.storage.get("primary-auth")
        if (stored?.refresh) return { type: "oauth", ...stored }
      } catch {
        /* ignore */
      }
      try {
        const conn = await ctx.integration.connection.active(INTEGRATION_ID)
        const cred: any = conn ? await ctx.integration.connection.resolve(conn) : undefined
        if (cred?.type === "oauth") {
          return {
            type: "oauth",
            refresh: cred.refresh,
            access: cred.access,
            expires: cred.expires,
            ...(cred.metadata ?? {}),
          }
        }
      } catch (e: any) {
        dbg(`getAuth credential ERR ${e?.message}`)
      }
      return { type: "oauth", refresh: "", access: "", expires: 0 }
    }

    // ---- lazy loader invocation ------------------------------------------
    let v1fetch: any = null
    let lastLoadedRefresh = ""

    async function ensureFetch(): Promise<boolean> {
      if (v1fetch) return true
      if (typeof loader !== "function") return false
      const auth = await getAuth()
      if (!auth.refresh) return false
      if (auth.refresh === lastLoadedRefresh) return !!v1fetch
      lastLoadedRefresh = auth.refresh

      let provider
      try {
        const records: any = await ctx.provider.list()
        const arr = Array.isArray(records) ? records : (records?.data ?? [])
        const rec = arr.find((r: any) => (r?.provider?.id ?? r?.id) === PROVIDER_ID)
        const models: Record<string, any> = {}
        const src = rec?.models
        if (src instanceof Map) {
          for (const [k, v] of src) models[k] = { ...v, cost: { input: 0, output: 0 } }
        } else if (src && typeof src === "object") {
          for (const [k, v] of Object.entries(src)) models[k] = { ...(v as any), cost: { input: 0, output: 0 } }
        }
        provider = { ...(rec?.provider ?? { id: PROVIDER_ID }), models }
      } catch (e: any) {
        dbg(`build provider ERR ${e?.message}`)
        provider = { id: PROVIDER_ID, models: {} }
      }

      try {
        const res = await loader(getAuth, provider)
        v1fetch = res?.fetch ?? null
        dbg(`loader result keys=${Object.keys(res ?? {}).join(",")} fetch=${typeof v1fetch}`)
      } catch (e: any) {
        dbg(`loader ERR ${e?.stack ?? e}`)
        v1fetch = null
        // Allow a later request to retry the loader instead of getting stuck.
        lastLoadedRefresh = ""
      }
      return !!v1fetch
    }

    /** Current refresh token length, for diagnostics only (never logged in full). */
    async function currentRefresh(): Promise<string> {
      try {
        const auth = await getAuth()
        return auth?.refresh ? `len=${String(auth.refresh).length}` : "empty"
      } catch {
        return "unknown"
      }
    }

    // ---- local proxy ------------------------------------------------------
    let proxyPort = 0
    let server: Server | null = null

    async function startProxy(): Promise<number> {
      if (proxyPort) return proxyPort
      server = createServer((req, res) => {
        void (async () => {
          const u = new URL(req.url ?? "/", "http://127.0.0.1")
          const target = u.searchParams.get("u")
          if (!target || !v1fetch) {
            res.writeHead(502, { "content-type": "text/plain" })
            res.end("antigravity proxy not ready")
            return
          }
          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)
          const raw = Buffer.concat(chunks)
          // V1's prepareAntigravityRequest() only parses and rewrites the body when
          // `typeof init.body === "string"`. Hand it a Buffer and the whole
          // transformation is skipped: the endpoint/model still get computed (so the
          // Debug Info looks fine) but the raw Gemini payload goes out unwrapped and
          // the Antigravity endpoint rejects it with `Unknown name "contents"`.
          const body = raw.length > 0 ? raw.toString("utf8") : undefined
          const method = (req.method ?? "GET").toUpperCase()
          const headers = new Headers()
          for (const [k, v] of Object.entries(req.headers)) {
            if (v == null) continue
            if (k === "host" || k === "connection" || k === "content-length") continue
            headers.set(k, Array.isArray(v) ? v.join(", ") : v)
          }
          // Propagate client cancellation (e.g. Stop in the TUI) upstream.
          const upstream = new AbortController()
          const onClose = () => upstream.abort()
          res.on("close", onClose)
          try {
            const r: Response = await v1fetch(target, {
              method,
              headers,
              body: method === "GET" || method === "HEAD" ? undefined : body,
              signal: upstream.signal,
            })
            const out: Record<string, string | string[]> = {}
            r.headers.forEach((value, key) => {
              out[key] = value
            })
            // fetch() has already decoded the body; re-emitting these headers would
            // make the client decode a second time.
            delete out["content-length"]
            delete out["transfer-encoding"]
            delete out["content-encoding"]
            res.writeHead(r.status ?? 502, out as any)
            if (r.body) {
              const reader = r.body.getReader()
              for (;;) {
                const { done, value } = await reader.read()
                if (done) break
                if (res.destroyed) break
                if (!res.write(Buffer.from(value))) {
                  await new Promise((resolve) => res.once("drain", resolve))
                }
              }
            }
            res.end()
          } catch (e: any) {
            if (!upstream.signal.aborted) dbg(`proxy ERR ${e?.message}`)
            if (!res.headersSent && !res.destroyed) {
              res.writeHead(502, { "content-type": "text/plain" })
              res.end(JSON.stringify({ type: "error", error: { message: String(e?.message ?? e) } }))
            } else if (!res.destroyed) {
              res.end()
            }
          } finally {
            res.off("close", onClose)
          }
        })()
      })
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()))
      const addr = server.address()
      proxyPort = typeof addr === "object" && addr ? addr.port : 0
      dbg(`proxy listening on 127.0.0.1:${proxyPort}`)
      return proxyPort
    }

    await startProxy()

    // ---- http.request hook ------------------------------------------------
    let hookHits = 0
    try {
      await ctx.session.hook("http.request", async (event: any) => {
        hookHits++
        const providerID = event?.model?.providerID
        // Google traffic is the interesting path; keep it always logged.
        if (providerID === PROVIDER_ID) {
          dbg(`http.request google kind=${event?.kind} url=${event?.request?.url}`)
        } else if (hookHits <= 5) {
          dbg(`http.request #${hookHits} provider=${providerID} kind=${event?.kind} url=${event?.request?.url}`)
        }
        if (providerID !== PROVIDER_ID) return
        if (!(await ensureFetch())) {
          dbg(`http.request: no v1 fetch yet (auth refresh="${await currentRefresh()}"), passing through`)
          return
        }
        const original = event.request.url
        const body = event.request.body ? Buffer.from(await event.request.arrayBuffer()) : undefined
        const headers = new Headers(event.request.headers)
        const headerNames: string[] = []
        headers.forEach((_, k) => headerNames.push(k))
        dbg(`outbound headers: ${headerNames.join(", ")}`)
        for (const suspect of ["x-goog-api-key", "x-api-key", "x-goog-user-project", "authorization"]) {
          const v = headers.get(suspect)
          if (v) dbg(`  header ${suspect}=${suspect.includes("key") || suspect === "authorization" ? `<len=${v.length}>` : v}`)
        }
        // V1 owns authentication: prepareAntigravityRequest() sets
        // `Authorization: Bearer <accessToken>` and strips `x-api-key`. OpenCode V2
        // instead stuffs the credential's *access token* into `x-goog-api-key`, which
        // Google rejects with `API key not valid` because it expects an AIza... key.
        // V1 never anticipated this header, so drop it here.
        for (const k of ["x-goog-api-key", "x-api-key"]) {
          if (headers.has(k)) {
            dbg(`  stripping ${k} (V1 authenticates via Authorization: Bearer)`)
            headers.delete(k)
          }
        }
        headers.delete("host")
        headers.delete("content-length")
        event.request = new Request(`http://127.0.0.1:${proxyPort}/p?u=${encodeURIComponent(original)}`, {
          method: event.request.method,
          headers,
          body: event.request.method === "GET" || event.request.method === "HEAD" ? undefined : body,
          signal: event.request.signal,
        })
        dbg(`http.request rewritten -> local proxy (method=${event.request.method})`)
      })
      dbg("http.request hook registered")
    } catch (e: any) {
      dbg(`http.request hook ERR ${e?.stack ?? e}`)
    }

    // ---- login methods ----------------------------------------------------
    try {
      await ctx.integration.transform((editor: any) => {
        for (const m of v1methods) {
          if (m.type === "oauth" && typeof m.authorize === "function") {
            editor.method.update({
              integrationID: INTEGRATION_ID,
              method: { id: OAUTH_METHOD_ID, type: "oauth", label: m.label },
              authorize: adaptAuthorize(m),
              refresh: async (credential: any) => {
                try {
                  const refreshMod = tokenMod.refreshAccessToken
                  if (typeof refreshMod !== "function") return credential
                  const updated = await refreshMod(
                    { type: "oauth", refresh: credential.refresh, access: credential.access, expires: credential.expires },
                    v1client,
                    PROVIDER_ID,
                  )
                  if (!updated) return credential
                  return {
                    type: "oauth",
                    methodID: OAUTH_METHOD_ID,
                    refresh: updated.refresh,
                    access: updated.access,
                    expires: Number(updated.expires ?? 0),
                    metadata: credential.metadata,
                  }
                } catch (e: any) {
                  dbg(`integration refresh ERR ${e?.message}`)
                  return credential
                }
              },
            })
            dbg(`registered oauth method "${m.label}"`)
          } else if (m.type === "api") {
            editor.method.update({ integrationID: INTEGRATION_ID, method: { type: "key", label: m.label } })
          }
        }
      })
    } catch (e: any) {
      dbg(`integration transform ERR ${e?.stack ?? e}`)
    }

    // ---- google_search tool ------------------------------------------------
    const v1tool = v1?.tool?.google_search
    if (v1tool) {
      try {
        await ctx.tool.transform((editor: any) => {
          editor.add({
            name: "google_search",
            description: v1tool.description,
            input: SEARCH_INPUT,
            async execute(input: any, context: any) {
              const out = await v1tool.execute(
                { query: input?.query, urls: input?.urls, thinking: input?.thinking ?? true },
                { abort: context?.signal },
              )
              return { content: typeof out === "string" ? out : JSON.stringify(out) }
            },
          })
        })
        dbg("google_search tool registered")
      } catch (e: any) {
        dbg(`tool transform ERR ${e?.stack ?? e}`)
      }
    }

    // ---- events ------------------------------------------------------------
    const controller = new AbortController()
    if (typeof v1?.event === "function") {
      void (async () => {
        try {
          for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
            try {
              await v1.event({ event })
            } catch (e: any) {
              dbg(`event handler ERR type=${event?.type} ${e?.message}`)
            }
          }
        } catch (e: any) {
          if (!controller.signal.aborted) dbg(`event subscribe ERR ${e?.message}`)
        }
      })()
      dbg("event subscription started")
    }

    dbg("setup complete")
    return () => {
      controller.abort()
      try {
        server?.close()
      } catch {
        /* ignore */
      }
      dbg(`cleanup dir=${ctx.location.directory}`)
    }
  },
}
