import { useCallback, useEffect, useMemo, useState } from "react"
import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app"
import type { rpcContract, RpcDatabase, RpcImage, RpcKind } from "./server"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"

const kinds: ReadonlyArray<{ readonly value: RpcKind; readonly label: string }> = [
  { value: "postgres", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "redis", label: "Redis" },
  { value: "mongo", label: "MongoDB" }
]

const isRpcKind = (value: string): value is RpcKind => kinds.some((entry) => entry.value === value)

const imageForKind = (images: ReadonlyArray<RpcImage>, kind: RpcKind): RpcImage | undefined =>
  images.find((image) => image.kind === kind)

const kindOptionLabel = (entry: { readonly value: RpcKind; readonly label: string }, images: ReadonlyArray<RpcImage>): string => {
  const image = imageForKind(images, entry.value)
  if (image === undefined) {
    return `${entry.label} · checking image…`
  }
  return `${entry.label} · ${image.image} · ${image.installed ? "Installed" : "Not installed"}`
}

const statusClass = (status: RpcDatabase["status"]): string => {
  switch (status) {
    case "running":
      return "text-emerald-500"
    case "paused":
      return "text-amber-500"
    default:
      return "text-muted-foreground"
  }
}

function DatabasePanel() {
  const rpc = useRpc<typeof rpcContract>()
  const [databases, setDatabases] = useState<ReadonlyArray<RpcDatabase>>([])
  const [dockerMessage, setDockerMessage] = useState("Checking Docker…")
  const [dockerReady, setDockerReady] = useState(false)
  const [images, setImages] = useState<ReadonlyArray<RpcImage>>([])
  const [kind, setKind] = useState<RpcKind>("postgres")
  const [alias, setAlias] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [logs, setLogs] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [startingDocker, setStartingDocker] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const status = await rpc.call("dockerStatus")
      setDockerReady(status.ready)
      setDockerMessage(status.message)
      if (!status.ready) {
        setDatabases([])
        setImages([])
        setError(status.message)
        return
      }
      const [result, imageResult] = await Promise.all([
        rpc.call("list"),
        rpc.call("imageStatus")
      ])
      setDatabases(result.databases)
      setImages(imageResult.images)
      setError(null)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [rpc])

  useEffect(() => {
    void reload()
  }, [reload])

  useRealtime("instances", () => {
    void reload()
  })

  const selected = useMemo(
    () => databases.find((database) => database.id === selectedId) ?? null,
    [databases, selectedId]
  )

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await rpc.call("create", { kind, ...(alias.trim() === "" ? {} : { alias: alias.trim() }) })
      setDatabases((current) => [...current, result.database])
      setSelectedId(result.database.id)
      setAlias("")
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const startDocker = async () => {
    setStartingDocker(true)
    setError(null)
    try {
      const status = await rpc.call("dockerStart")
      setDockerReady(status.ready)
      setDockerMessage(status.message)
      await reload()
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setStartingDocker(false)
    }
  }

  const action = async (actionName: "start" | "restart" | "pause" | "unpause" | "stop") => {
    if (selected === null) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await rpc.call("action", { id: selected.id, action: actionName })
      setDatabases((current) => current.map((database) => database.id === result.database.id ? result.database : database))
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (selected === null || !window.confirm(`Delete ${selected.alias}?`)) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await rpc.call("remove", { id: selected.id })
      setDatabases((current) => current.filter((database) => database.id !== selected.id))
      setSelectedId(null)
      setLogs(null)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const readLogs = async () => {
    if (selected === null) {
      return
    }
    try {
      const result = await rpc.call("logs", { id: selected.id, tail: 200 })
      setLogs(result.text === "" ? "No logs yet." : result.text)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto overscroll-contain p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Local databases</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create and manage disposable Docker databases without connection strings.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void reload()} disabled={busy}>Refresh</Button>
      </div>

      <Card>
        <CardContent className="grid gap-x-4 gap-y-3 pt-6 sm:grid-cols-2">
          <label htmlFor="dbm-database-kind" className="grid min-w-0 gap-1 text-sm">
            <span className="text-muted-foreground">Database</span>
            <select id="dbm-database-kind" className="h-9 w-full min-w-0 max-w-full rounded-md border border-input bg-transparent px-3" value={kind} onChange={(event) => { if (isRpcKind(event.target.value)) setKind(event.target.value) }}>
              {kinds.map((entry) => <option key={entry.value} value={entry.value}>{kindOptionLabel(entry, images)}</option>)}
            </select>
            {imageForKind(images, kind) !== undefined && <span className="text-xs text-muted-foreground">{imageForKind(images, kind)?.installed ? "Installed locally" : "Not installed locally; Docker will pull it on create."}</span>}
          </label>
          <label htmlFor="dbm-database-alias" className="grid min-w-0 gap-1 text-sm">
            <span className="text-muted-foreground">Optional alias</span>
            <Input id="dbm-database-alias" className="w-full min-w-0" value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="my-local-db" />
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button onClick={() => void create()} disabled={busy || startingDocker || !dockerReady}>Create instance</Button>
            {!dockerReady && <Button variant="outline" onClick={() => void startDocker()} disabled={startingDocker}>{startingDocker ? "Starting Docker…" : "Start OrbStack"}</Button>}
            <span className={`flex min-h-9 min-w-0 items-center leading-tight text-sm ${dockerReady ? "text-emerald-500" : "text-amber-500"}`}>{dockerMessage}</span>
          </div>
        </CardContent>
      </Card>

      {error !== null && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Managed instances</CardTitle>
            <CardDescription>Only containers created and labelled by dbm appear here.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {databases.length === 0 && <p className="text-sm text-muted-foreground">No managed databases yet.</p>}
            {databases.map((database) => (
              <button key={database.id} type="button" onClick={() => { setSelectedId(database.id); setLogs(null) }} className={`grid gap-1 rounded-md border p-3 text-left transition-colors hover:bg-state-hover ${selectedId === database.id ? "border-foreground" : "border-border"}`}>
                <span className="flex items-center justify-between gap-3 font-medium">
                  <span>{database.alias}</span>
                  <span className={`text-xs capitalize ${statusClass(database.status)}`}>{database.status}</span>
                </span>
                <span className="text-xs text-muted-foreground">{database.kind} · {database.image} · {database.connection === null ? "no host port" : `127.0.0.1:${database.connection.port}`}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{selected === null ? "Instance details" : selected.alias}</CardTitle>
            <CardDescription>{selected === null ? "Select an instance to manage it." : `${selected.kind} · ${selected.status}`}</CardDescription>
          </CardHeader>
          {selected !== null && <CardContent className="grid gap-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void action("start")} disabled={busy || selected.status === "running"}>Start</Button>
              <Button size="sm" variant="outline" onClick={() => void action("restart")} disabled={busy}>Restart</Button>
              <Button size="sm" variant="outline" onClick={() => void action("pause")} disabled={busy || selected.status !== "running"}>Pause</Button>
              <Button size="sm" variant="outline" onClick={() => void action("unpause")} disabled={busy || selected.status !== "paused"}>Unpause</Button>
              <Button size="sm" variant="outline" onClick={() => void action("stop")} disabled={busy || selected.status === "stopped"}>Stop</Button>
              <Button size="sm" variant="destructive" onClick={() => void remove()} disabled={busy}>Delete</Button>
            </div>
            <div className="grid gap-1 rounded-md bg-muted/40 p-3">
              <span className="font-medium">Connection</span>
              <code className="break-all text-xs">{selected.connection?.url ?? "Start the instance to obtain a host port."}</code>
              {selected.connection !== null && <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(selected.connection?.url ?? "")}>Copy URL</Button>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void readLogs()}>View logs</Button>
            </div>
            {logs !== null && <pre className="max-h-48 overflow-auto rounded-md bg-muted/40 p-3 text-xs">{logs}</pre>}
          </CardContent>}
        </Card>
      </div>
    </div>
  )
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "databases",
    title: "Databases",
    icon: "Database",
    path: "databases",
    component: DatabasePanel
  })
})
