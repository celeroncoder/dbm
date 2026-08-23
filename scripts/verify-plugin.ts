import { Duration, Effect, Layer, ManagedRuntime } from "effect"
import { DatabaseAdapterRegistryLive } from "../src/core/adapters"
import { CommandRunnerNodeLive } from "../src/core/command"
import { DatabaseAdapterRegistry } from "../src/core/explorer"
import { DatabaseManager, DatabaseManagerLive, managedToDetectedDatabase } from "../src/core/manager"
import { DockerClient, DockerClientLive } from "../src/core/docker"
import type { DatabaseKind, ManagedDatabase } from "../src/core/model"

const DockerLive = DockerClientLive.pipe(Layer.provide(CommandRunnerNodeLive))
const ManagerLive = DatabaseManagerLive.pipe(Layer.provide(DockerLive))
const AdaptersLive = DatabaseAdapterRegistryLive.pipe(Layer.provide(DockerLive))
const AppLive = Layer.mergeAll(DockerLive, ManagerLive, AdaptersLive)
const runtime = ManagedRuntime.make(AppLive)
const created: Array<string> = []
const kinds: ReadonlyArray<DatabaseKind> = ["postgres", "mysql", "redis", "mongo"]

const queryFor = (kind: DatabaseKind): string => {
  switch (kind) {
    case "postgres":
    case "mysql":
      return "SELECT 1"
    case "redis":
      return "PING"
    case "mongo":
      return "db.runCommand({ ping: 1 })"
  }
}

const verify = Effect.gen(function* () {
  const docker = yield* DockerClient
  yield* docker.check
  const manager = yield* DatabaseManager
  const registry = yield* DatabaseAdapterRegistry
  const instances: Array<ManagedDatabase> = []

  for (const kind of kinds) {
    const database = yield* manager.create({ kind, alias: `dbm-verify-plugin-${kind}` })
    created.push(database.id)
    if (database.connection === null) {
      return yield* Effect.fail(new Error(`No host port was assigned for ${kind}.`))
    }
    instances.push(database)
  }

  yield* Effect.sleep(Duration.seconds(15))
  const checks: Array<{ readonly kind: DatabaseKind; readonly url: string; readonly queryRows: number }> = []
  for (const instance of instances) {
    const current = yield* manager.get(instance.id)
    const adapter = registry.get(current.kind)
    const detected = managedToDetectedDatabase(current)
    yield* adapter.testConnection(detected)
    const result = yield* adapter.query(detected, { text: queryFor(current.kind) })
    const logs = yield* manager.logs(current.id, 20)
    checks.push({
      kind: current.kind,
      url: current.connection?.url ?? "",
      queryRows: result.rowCount
    })
    if (logs.name !== current.name) {
      return yield* Effect.fail(new Error(`Log lookup returned the wrong container for ${current.kind}.`))
    }
  }

  const redis = instances.find((instance) => instance.kind === "redis")
  if (redis === undefined) {
    return yield* Effect.fail(new Error("Redis verification instance was not created."))
  }
  yield* manager.stop(redis.id)
  yield* manager.start(redis.id)
  yield* manager.pause(redis.id)
  yield* manager.unpause(redis.id)
  yield* manager.restart(redis.id)

  return { checks, lifecycle: "stop/start/pause/unpause/restart passed" }
})

const cleanup = Effect.gen(function* () {
  const manager = yield* DatabaseManager
  const databases = yield* manager.list
  for (const database of databases) {
    if (database.alias.startsWith("dbm-verify-plugin-")) {
      yield* manager.remove(database.id)
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
