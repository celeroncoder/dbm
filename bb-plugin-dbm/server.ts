import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk"
import { Effect, Layer, ManagedRuntime } from "effect"
import type { ManagedRuntime as ManagedRuntimeType } from "effect/ManagedRuntime"
import { z } from "zod"
import {
  CommandRunnerNodeLive,
  DatabaseExplorer,
  DatabaseExplorerLive,
  DatabaseManager,
  DatabaseManagerLive,
  DatabaseAdapterRegistryLive,
  DockerClient,
  DockerClientLive,
  managedToDetectedDatabase
} from "dbm"
import type { DatabaseExplorerService } from "dbm"
import type {
  ColumnInfo,
  ContainerPort,
  DatabaseConnection,
  DatabaseImageStatus,
  DatabaseKind,
  DatabaseLogs,
  ManagedDatabase,
  ManagedDatabaseStatus,
  QueryResult,
  SchemaInfo,
  TableInfo
} from "dbm"

const kindSchema = z.enum(["postgres", "mysql", "redis", "mongo"])
const portSchema = z.object({
  privatePort: z.string(),
  publicPort: z.string().optional(),
  protocol: z.string().optional()
}).strict()
const connectionSchema = z.object({
  host: z.string(),
  port: z.number().int(),
  url: z.string(),
  database: z.string(),
  username: z.string(),
  password: z.string().nullable()
}).strict()
const imageStatusSchema = z.object({
  kind: kindSchema,
  image: z.string(),
  version: z.string(),
  installed: z.boolean()
}).strict()
const databaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  alias: z.string(),
  image: z.string(),
  kind: kindSchema,
  status: z.enum(["running", "paused", "stopped", "created", "unknown"]),
  ports: z.array(portSchema),
  connection: connectionSchema.nullable()
}).strict()
const queryResultSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string().nullable())),
  rowCount: z.number().int(),
  truncated: z.boolean(),
  note: z.string().optional()
}).strict()
const schemaSchema = z.object({ name: z.string(), kind: z.string().optional() }).strict()
const tableSchema = z.object({
  schema: z.string().optional(),
  name: z.string(),
  kind: z.string().optional(),
  rowCount: z.number().int().optional()
}).strict()
const columnSchema = z.object({
  name: z.string(),
  dataType: z.string().optional(),
  nullable: z.boolean().optional(),
  defaultValue: z.string().optional()
}).strict()
const logsSchema = z.object({ name: z.string(), text: z.string(), truncated: z.boolean() }).strict()

export const rpcContract = defineRpcContract({
  dockerStatus: {
    input: z.null(),
    output: z.object({ ready: z.boolean(), message: z.string() }).strict()
  },
  dockerStart: {
    input: z.null(),
    output: z.object({ ready: z.boolean(), message: z.string() }).strict()
  },
  imageStatus: {
    input: z.null(),
    output: z.object({ images: z.array(imageStatusSchema) }).strict()
  },
  list: {
    input: z.null(),
    output: z.object({ databases: z.array(databaseSchema) }).strict()
  },
  create: {
    input: z.object({ kind: kindSchema, alias: z.string().optional() }).strict(),
    output: z.object({ database: databaseSchema }).strict()
  },
  action: {
    input: z.object({
      id: z.string(),
      action: z.enum(["start", "restart", "pause", "unpause", "stop"])
    }).strict(),
    output: z.object({ database: databaseSchema }).strict()
  },
  remove: {
    input: z.object({ id: z.string() }).strict(),
    output: z.object({ removed: z.boolean() }).strict()
  },
  logs: {
    input: z.object({ id: z.string(), tail: z.number().int().min(1).max(2_000).optional() }).strict(),
    output: logsSchema
  },
  query: {
    input: z.object({ id: z.string(), text: z.string().min(1), limit: z.number().int().min(1).max(500).optional() }).strict(),
    output: queryResultSchema
  },
  schemas: {
    input: z.object({ id: z.string() }).strict(),
    output: z.object({ schemas: z.array(schemaSchema) }).strict()
  },
  tables: {
    input: z.object({ id: z.string(), schema: z.string().optional() }).strict(),
    output: z.object({ tables: z.array(tableSchema) }).strict()
  },
  describe: {
    input: z.object({ id: z.string(), table: tableSchema }).strict(),
    output: z.object({ columns: z.array(columnSchema) }).strict()
  },
  browse: {
    input: z.object({ id: z.string(), table: tableSchema, limit: z.number().int().min(1).max(500).optional() }).strict(),
    output: queryResultSchema
  }
})

const DockerLive = DockerClientLive.pipe(Layer.provide(CommandRunnerNodeLive))
const ManagerLive = DatabaseManagerLive.pipe(Layer.provide(DockerLive))
const AdaptersLive = DatabaseAdapterRegistryLive.pipe(Layer.provide(DockerLive))
const ExplorerLive = DatabaseExplorerLive.pipe(Layer.provide(AdaptersLive))
const CoreLive = Layer.mergeAll(DockerLive, ManagerLive, ExplorerLive)

const makeCoreRuntime = () => ManagedRuntime.make(CoreLive)
type CoreRuntime = ReturnType<typeof makeCoreRuntime>
type CoreServices = CoreRuntime extends ManagedRuntimeType<infer Services, unknown> ? Services : never

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

const runOrThrow = <A, E>(runtime: CoreRuntime, program: Effect.Effect<A, E, CoreServices>): Promise<A> =>
  runtime.runPromise(program).catch((error: unknown) => {
    throw new Error(errorMessage(error))
  })

const databaseOutput = (database: ManagedDatabase) => ({
  id: database.id,
  name: database.name,
  alias: database.alias,
  image: database.image,
  kind: database.kind,
  status: database.status,
  ports: database.ports.map((port) => ({ ...port })),
  connection: database.connection === null ? null : { ...database.connection }
})

const imageStatusOutput = (images: ReadonlyArray<DatabaseImageStatus>) =>
  images.map((image) => ({ ...image }))

const queryOutput = (result: QueryResult) => ({
  columns: [...result.columns],
  rows: result.rows.map((row) => [...row]),
  rowCount: result.rowCount,
  truncated: result.truncated,
  ...(result.note === undefined ? {} : { note: result.note })
})

const schemaOutput = (schemas: ReadonlyArray<SchemaInfo>) => schemas.map((schema) => ({ ...schema }))
const tableOutput = (tables: ReadonlyArray<TableInfo>) => tables.map((table) => ({ ...table }))
const columnOutput = (columns: ReadonlyArray<ColumnInfo>) => columns.map((column) => ({ ...column }))
const toJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

const helpText = `dbm — managed local Docker databases

Usage:
  bb dbm list
  bb dbm images
  bb dbm docker start
  bb dbm create <postgres|mysql|redis|mongo> [alias]
  bb dbm start|restart|pause|unpause|stop <id-or-alias>
  bb dbm delete <id-or-alias>
  bb dbm logs <id-or-alias> [tail]
  bb dbm connect <id-or-alias>
  bb dbm query <id-or-alias> <query-or-command>
`

const actionFor = (action: "start" | "restart" | "pause" | "unpause" | "stop", id: string) =>
  Effect.gen(function* () {
    const manager = yield* DatabaseManager
    switch (action) {
      case "start":
        return yield* manager.start(id)
      case "restart":
        return yield* manager.restart(id)
      case "pause":
        return yield* manager.pause(id)
      case "unpause":
        return yield* manager.unpause(id)
      case "stop":
        return yield* manager.stop(id)
    }
  })

const executeCli = async (argv: ReadonlyArray<string>, runtime: CoreRuntime): Promise<{ exitCode: number; stdout?: string; stderr?: string }> => {
  const command = argv[0]
  try {
    if (command === undefined || command === "help" || command === "--help") {
      return { exitCode: 0, stdout: helpText }
    }
    if (command === "list") {
      const result = await runOrThrow(runtime, Effect.gen(function* () {
        const manager = yield* DatabaseManager
        return yield* manager.list
      }))
      return { exitCode: 0, stdout: toJson({ databases: result.map(databaseOutput) }) }
    }
    if (command === "images") {
      const images = await runOrThrow(runtime, Effect.gen(function* () {
        const manager = yield* DatabaseManager
        return yield* manager.imageStatus
      }))
      return { exitCode: 0, stdout: toJson({ images: imageStatusOutput(images) }) }
    }
    if (command === "docker" && argv[1] === "start") {
      const status = await runOrThrow(runtime, Effect.gen(function* () {
        const docker = yield* DockerClient
        yield* docker.startOrbStack
        yield* docker.waitUntilReady()
        return { ready: true, message: "Docker is ready." }
      }))
      return { exitCode: 0, stdout: toJson(status) }
    }
    if (command === "create") {
      const kind = argv[1]
      if (kind !== "postgres" && kind !== "mysql" && kind !== "redis" && kind !== "mongo") {
        return { exitCode: 2, stderr: "create requires a supported database kind.\n" }
      }
      const database = await runOrThrow(runtime, Effect.gen(function* () {
        const manager = yield* DatabaseManager
        return yield* manager.create({ kind, alias: argv[2] })
      }))
      return { exitCode: 0, stdout: toJson({ database: databaseOutput(database) }) }
    }
    if (command === "delete") {
      const id = argv[1]
      if (id === undefined) {
        return { exitCode: 2, stderr: "delete requires an id or alias.\n" }
      }
      await runOrThrow(runtime, Effect.gen(function* () {
        const manager = yield* DatabaseManager
        yield* manager.remove(id)
      }))
      return { exitCode: 0, stdout: toJson({ removed: true }) }
    }
    if (command === "logs") {
      const id = argv[1]
      if (id === undefined) {
        return { exitCode: 2, stderr: "logs requires an id or alias.\n" }
      }
      const tail = argv[2] === undefined ? undefined : Number.parseInt(argv[2], 10)
      const logs = await runOrThrow(runtime, Effect.gen(function* () {
        const manager = yield* DatabaseManager
        return yield* manager.logs(id, tail)
      }))
      return { exitCode: 0, stdout: logs.text }
    }
    if (command === "connect") {
      const id = argv[1]
      if (id === undefined) {
        return { exitCode: 2, stderr: "connect requires an id or alias.\n" }
      }
      const database = await runOrThrow(runtime, Effect.gen(function* () {
        const manager = yield* DatabaseManager
        return yield* manager.get(id)
      }))
      return { exitCode: 0, stdout: toJson(database.connection) }
    }
    const lifecycleAction = command === "start" || command === "restart" || command === "pause" || command === "unpause" || command === "stop"
      ? command
      : undefined
    if (lifecycleAction !== undefined) {
      const id = argv[1]
      if (id === undefined) {
        return { exitCode: 2, stderr: `${command} requires an id or alias.\n` }
      }
      const database = await runOrThrow(runtime, actionFor(lifecycleAction, id))
      return { exitCode: 0, stdout: toJson({ database: databaseOutput(database) }) }
    }
    if (command === "query") {
      const id = argv[1]
      const text = argv.slice(2).join(" ")
      if (id === undefined || text === "") {
        return { exitCode: 2, stderr: "query requires an id or alias and a query.\n" }
      }
      const result = await runOrThrow(runtime, Effect.gen(function* () {
        const manager = yield* DatabaseManager
        const explorer = yield* DatabaseExplorer
        const database = yield* manager.get(id)
        return yield* explorer.query(managedToDetectedDatabase(database), { text })
      }))
      return { exitCode: 0, stdout: toJson(queryOutput(result)) }
    }
    return { exitCode: 2, stderr: `Unknown command '${command}'.\n\n${helpText}` }
  } catch (error: unknown) {
    return { exitCode: 1, stderr: `${errorMessage(error)}\n` }
  }
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded")
  const runtime = makeCoreRuntime()

  const emitChanged = () => bb.realtime.publish("instances", { changedAt: Date.now() })
  const explorerCall = <A, E, R>(
    id: string,
    operation: (explorer: DatabaseExplorerService, database: ManagedDatabase) => Effect.Effect<A, E>
  ) => Effect.gen(function* () {
    const manager = yield* DatabaseManager
    const explorer = yield* DatabaseExplorer
    const database = yield* manager.get(id)
    return yield* operation(explorer, database)
  })

  bb.rpc.register(rpcContract, {
    dockerStatus: async () => runOrThrow(runtime, Effect.gen(function* () {
      const docker = yield* DockerClient
      return yield* docker.check.pipe(
        Effect.map(() => ({ ready: true, message: "Docker is ready." })),
        Effect.catch((error) => Effect.succeed({ ready: false, message: error.message }))
      )
    })),
    dockerStart: async () => runOrThrow(runtime, Effect.gen(function* () {
      const docker = yield* DockerClient
      yield* docker.startOrbStack
      yield* docker.waitUntilReady()
      return { ready: true, message: "Docker is ready." }
    })),
    imageStatus: async () => {
      const images = await runOrThrow(runtime, Effect.gen(function* () {
        const manager = yield* DatabaseManager
        return yield* manager.imageStatus
      }))
      return { images: imageStatusOutput(images) }
    },
    list: async () => {
      const databases = await runOrThrow(runtime, Effect.gen(function* () {
        const manager = yield* DatabaseManager
        return yield* manager.list
      }))
      return { databases: databases.map(databaseOutput) }
    },
    create: async (input) => {
      const database = await runOrThrow(runtime, Effect.gen(function* () {
        const manager = yield* DatabaseManager
        return yield* manager.create(input)
      }))
      emitChanged()
      return { database: databaseOutput(database) }
    },
    action: async (input) => {
      const database = await runOrThrow(runtime, actionFor(input.action, input.id))
      emitChanged()
      return { database: databaseOutput(database) }
    },
    remove: async (input) => {
      await runOrThrow(runtime, Effect.gen(function* () {
        const manager = yield* DatabaseManager
        yield* manager.remove(input.id)
      }))
      emitChanged()
      return { removed: true }
    },
    logs: async (input) => {
      const logs = await runOrThrow(runtime, Effect.gen(function* () {
        const manager = yield* DatabaseManager
        return yield* manager.logs(input.id, input.tail)
      }))
      return logs
    },
    query: async (input) => {
      const result = await runOrThrow(runtime, explorerCall(input.id, (explorer, database) =>
        explorer.query(managedToDetectedDatabase(database), { text: input.text, limit: input.limit })))
      return queryOutput(result)
    },
    schemas: async (input) => {
      const schemas = await runOrThrow(runtime, explorerCall(input.id, (explorer, database) =>
        explorer.listSchemas(managedToDetectedDatabase(database))))
      return { schemas: schemaOutput(schemas) }
    },
    tables: async (input) => {
      const tables = await runOrThrow(runtime, explorerCall(input.id, (explorer, database) =>
        explorer.listTables(managedToDetectedDatabase(database), input.schema)))
      return { tables: tableOutput(tables) }
    },
    describe: async (input) => {
      const columns = await runOrThrow(runtime, explorerCall(input.id, (explorer, database) =>
        explorer.describeTable(managedToDetectedDatabase(database), input.table)))
      return { columns: columnOutput(columns) }
    },
    browse: async (input) => {
      const result = await runOrThrow(runtime, explorerCall(input.id, (explorer, database) =>
        explorer.browseTable(managedToDetectedDatabase(database), input.table, input.limit)))
      return queryOutput(result)
    }
  })

  bb.cli.register({
      name: "dbm",
    summary: "Create and manage local Docker databases",
    commands: [
      { name: "list", summary: "List dbm-managed database instances", usage: "bb dbm list" },
      { name: "images", summary: "Show supported image versions and local availability", usage: "bb dbm images" },
      { name: "create", summary: "Create a Postgres, MySQL, Redis, or MongoDB instance", usage: "bb dbm create <kind> [alias]" },
      { name: "lifecycle", summary: "Start, restart, pause, unpause, or stop an instance", usage: "bb dbm <start|restart|pause|unpause|stop> <id-or-alias>" },
      { name: "delete", summary: "Delete a dbm-managed instance", usage: "bb dbm delete <id-or-alias>" },
      { name: "logs", summary: "Read recent instance logs", usage: "bb dbm logs <id-or-alias> [tail]" },
      { name: "connect", summary: "Print the generated connection URL and config", usage: "bb dbm connect <id-or-alias>" },
      { name: "query", summary: "Run a query or native database command", usage: "bb dbm query <id-or-alias> <query-or-command>" }
    ],
    run: async (argv, _context) => executeCli(argv, runtime)
  })

  bb.onDispose(async () => {
    await runtime.dispose()
    bb.log.info("disposed")
  })
}

export type RpcContract = typeof rpcContract
export type RpcDatabase = ReturnType<typeof databaseOutput>
export type RpcConnection = DatabaseConnection
export type RpcPort = ContainerPort
export type RpcStatus = ManagedDatabaseStatus
export type RpcKind = DatabaseKind
export type RpcImage = DatabaseImageStatus
export type RpcResult = QueryResult
export type RpcSchema = SchemaInfo
export type RpcTable = TableInfo
export type RpcColumn = ColumnInfo
