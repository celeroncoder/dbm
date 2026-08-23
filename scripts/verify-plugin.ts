import { Duration, Effect, Layer, ManagedRuntime } from "effect"
import { DatabaseAdapterRegistryLive } from "../src/core/adapters"
import { CommandRunnerNodeLive } from "../src/core/command"
import { DatabaseDiscovery, DatabaseDiscoveryLive } from "../src/core/discovery"
import { DatabaseAdapterRegistry } from "../src/core/explorer"
import { DatabaseManager, DatabaseManagerLive, managedToDetectedDatabase } from "../src/core/manager"
import { DockerClient, DockerClientLive } from "../src/core/docker"
import type { DatabaseAdapter } from "../src/core/explorer"
import { databaseKinds } from "../src/core/model"
import type { DatabaseKind, ManagedDatabase, TableInfo } from "../src/core/model"

const DockerLive = DockerClientLive.pipe(Layer.provide(CommandRunnerNodeLive))
const ManagerLive = DatabaseManagerLive.pipe(Layer.provide(DockerLive))
const AdaptersLive = DatabaseAdapterRegistryLive.pipe(Layer.provide(DockerLive))
const DiscoveryLive = DatabaseDiscoveryLive.pipe(Layer.provide(DockerLive))
const AppLive = Layer.mergeAll(DockerLive, ManagerLive, AdaptersLive, DiscoveryLive)
const runtime = ManagedRuntime.make(AppLive)
const created: Array<string> = []
const initialVolumes = new Set<string>()
let capturedInitialVolumes = false
const requestedKinds = (process.env.DBM_VERIFY_KINDS ?? "")
  .split(",")
  .map((kind) => kind.trim())
  .filter((kind) => kind !== "")

const isDatabaseKind = (kind: string): kind is DatabaseKind =>
  databaseKinds.some((supported) => supported === kind)

if (requestedKinds.some((kind) => !isDatabaseKind(kind))) {
  throw new Error(`DBM_VERIFY_KINDS must contain only: ${databaseKinds.join(", ")}`)
}

const kinds: ReadonlyArray<DatabaseKind> = requestedKinds.length === 0
  ? databaseKinds
  : requestedKinds.filter(isDatabaseKind)

const seedQueriesFor = (kind: DatabaseKind): ReadonlyArray<string> => {
  switch (kind) {
    case "postgres":
      return [
        "CREATE TABLE IF NOT EXISTS dbm_verify_items (id integer primary key, value text not null)",
        "TRUNCATE TABLE dbm_verify_items",
        "INSERT INTO dbm_verify_items (id, value) VALUES (1, 'verified')"
      ]
    case "mysql":
      return [
        "CREATE TABLE IF NOT EXISTS dbm_verify_items (id integer primary key, value text not null)",
        "TRUNCATE TABLE dbm_verify_items",
        "INSERT INTO dbm_verify_items (id, value) VALUES (1, 'verified')"
      ]
    case "redis":
      return ["SET dbm:verify verified"]
    case "mongo":
      return [
        "db.dbm_verify_items.deleteMany({})",
        "db.dbm_verify_items.insertOne({ id: 1, value: 'verified' })"
      ]
  }
}

const readQueryFor = (kind: DatabaseKind): string => {
  switch (kind) {
    case "postgres":
    case "mysql":
      return "SELECT value FROM dbm_verify_items WHERE id = 1"
    case "redis":
      return "GET dbm:verify"
    case "mongo":
      return "db.dbm_verify_items.find({ id: 1 }).toArray()"
  }
}

const fixtureTableFor = (kind: DatabaseKind, tables: ReadonlyArray<TableInfo>): TableInfo | undefined =>
  tables.find((table) => table.name === (kind === "redis" ? "dbm:verify" : "dbm_verify_items"))

const isSameContainerId = (left: string, right: string): boolean =>
  left === right || left.startsWith(right) || right.startsWith(left)

const waitForConnection = Effect.fn("verify.waitForConnection")(function* (
  adapter: DatabaseAdapter,
  database: ManagedDatabase,
  timeoutMs = 90_000
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ready = yield* adapter.testConnection(managedToDetectedDatabase(database)).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false))
    )
    if (ready) {
      return
    }
    yield* Effect.sleep(Duration.seconds(1))
  }
  return yield* Effect.fail(new Error(`${database.kind} did not become ready after restart.`))
})

const verify = Effect.gen(function* () {
  const docker = yield* DockerClient
  yield* docker.check
  const volumeResult = yield* docker.run(["volume", "ls", "--quiet"])
  for (const volume of volumeResult.stdout.split("\n").map((value) => value.trim()).filter((value) => value !== "")) {
    initialVolumes.add(volume)
  }
  capturedInitialVolumes = true
  const manager = yield* DatabaseManager
  const registry = yield* DatabaseAdapterRegistry
  const discovery = yield* DatabaseDiscovery

  const checks: Array<{
    readonly kind: DatabaseKind
    readonly url: string
    readonly queryRows: number
    readonly schemaCount: number
    readonly table: string
    readonly columnCount: number
    readonly browseRows: number
  }> = []

  for (const kind of kinds) {
    const instance = yield* manager.create({ kind, alias: `dbm-verify-plugin-${kind}` })
    created.push(instance.id)
    if (instance.connection === null) {
      return yield* Effect.fail(new Error(`No host port was assigned for ${kind}.`))
    }
    const discovered = yield* discovery.list
    if (!discovered.some((database) => database.id === instance.id)) {
      return yield* Effect.fail(new Error(
        `Discovery did not return the managed ${instance.kind} container ${instance.id}; discovered ids: ${discovered.map((database) => database.id).join(", ") || "none"}.`
      ))
    }

    const current = yield* manager.get(instance.id)
    const adapter = registry.get(current.kind)
    const detected = managedToDetectedDatabase(current)
    yield* adapter.testConnection(detected)
    for (const query of seedQueriesFor(current.kind)) {
      yield* adapter.query(detected, { text: query })
    }
    const result = yield* adapter.query(detected, { text: readQueryFor(current.kind) })
    const schemas = yield* adapter.listSchemas(detected)
    const tables = yield* adapter.listTables(detected)
    const table = fixtureTableFor(current.kind, tables)
    if (table === undefined) {
      return yield* Effect.fail(new Error(`${current.kind} did not list its seeded fixture.`))
    }
    const columns = yield* adapter.describeTable(detected, table)
    const browsed = yield* adapter.browseTable(detected, table, 10)
    if (result.rowCount < 1 || browsed.rowCount < 1) {
      return yield* Effect.fail(new Error(`${current.kind} did not return its seeded row.`))
    }
    const logs = yield* manager.logs(current.id, 20)
    checks.push({
      kind: current.kind,
      url: current.connection?.url ?? "",
      queryRows: result.rowCount,
      schemaCount: schemas.length,
      table: table.name,
      columnCount: columns.length,
      browseRows: browsed.rowCount
    })
    if (logs.name !== current.name) {
      return yield* Effect.fail(new Error(`Log lookup returned the wrong container for ${current.kind}.`))
    }
    yield* manager.stop(instance.id)
    yield* manager.start(instance.id)
    yield* manager.pause(instance.id)
    yield* manager.unpause(instance.id)
    const restarted = yield* manager.restart(instance.id)
    yield* waitForConnection(registry.get(instance.kind), restarted)
    yield* manager.remove(instance.id)
    const remains = (yield* docker.listAllContainers).some((container) => isSameContainerId(container.id, instance.id))
    if (remains) {
      return yield* Effect.fail(new Error(`Exact cleanup left the ${instance.kind} container ${instance.id}.`))
    }
  }

  return { checks, discovery: "all exact ids found", lifecycle: "all adapters passed stop/start/pause/unpause/restart" }
})

const cleanup = Effect.gen(function* () {
  const docker = yield* DockerClient
  for (const containerId of [...created].reverse()) {
    yield* docker.remove(containerId).pipe(Effect.ignore)
  }
  const remaining = (yield* docker.listAllContainers).filter((container) =>
    created.some((containerId) => isSameContainerId(container.id, containerId))
  )
  if (remaining.length > 0) {
    return yield* Effect.fail(new Error(`Verification cleanup left exact container ids: ${remaining.map((container) => container.id).join(", ")}`))
  }
  if (capturedInitialVolumes) {
    const volumeResult = yield* docker.run(["volume", "ls", "--quiet"])
    const extraVolumes = volumeResult.stdout
      .split("\n")
      .map((value) => value.trim())
      .filter((value) => value !== "" && !initialVolumes.has(value))
    if (extraVolumes.length > 0) {
      return yield* Effect.fail(new Error(`Verification cleanup left anonymous volume ids: ${extraVolumes.join(", ")}`))
    }
  }
})

try {
  const result = await runtime.runPromise(verify)
  console.log(JSON.stringify(result, null, 2))
} finally {
  await runtime.runPromise(cleanup).catch((error: unknown) => {
    console.error(`verification cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
  await runtime.dispose()
}
