import { Effect } from "effect"
import { DatabaseDiscovery } from "../core/discovery"
import { DockerClient } from "../core/docker"
import { DatabaseExplorer } from "../core/explorer"
import type { DatabaseExplorerService } from "../core/explorer"
import type { DatabaseOperationError, DockerOperationError, DockerUnavailable, InputError } from "../core/errors"
import type { DatabaseKind, DetectedDatabase, TableInfo } from "../core/model"
import { displayDatabaseKind } from "../core/discovery"
import { renderColumns, renderDatabaseList, renderQueryResult, renderSchemas, renderTables } from "./render"
import { Terminal } from "./terminal"
import type { TerminalService } from "./terminal"

type CliError = DatabaseOperationError | DockerOperationError | DockerUnavailable | InputError

const isYes = (answer: string): boolean => {
  const normalized = answer.trim().toLowerCase()
  return normalized === "" || normalized === "y" || normalized === "yes"
}

const selection = (answer: string, size: number): number | undefined => {
  const value = Number.parseInt(answer.trim(), 10)
  return Number.isInteger(value) && value >= 1 && value <= size ? value - 1 : undefined
}

const queryPrompt = (kind: DatabaseKind): string => {
  switch (kind) {
    case "redis":
      return "Redis command (example: GET my-key, blank to cancel): "
    case "mongo":
      return "MongoDB expression (example: db.users.find({}).limit(20).toArray(), blank to cancel): "
    default:
      return "SQL query (blank to cancel): "
  }
}

const renderConnectionFailure = (error: CliError): string => `Connection failed: ${error.message}`

const makeDatabaseMenu = Effect.fn("Cli.databaseMenu")(function* (
  terminal: TerminalService,
  explorer: DatabaseExplorerService,
  database: DetectedDatabase
) {
  yield* terminal.writeLine(`\nSelected ${database.name} (${displayDatabaseKind(database.kind)}).`)
  yield* explorer.testConnection(database).pipe(
    Effect.tap(() => terminal.writeLine("Connection ready.")),
    Effect.catch((error) => terminal.writeLine(renderConnectionFailure(error)))
  )

  let active = true
  while (active) {
    yield* terminal.writeLine(
      "\n1. Query   2. Schemas/databases   3. Browse tables/keys   4. List tables/keys   b. Back"
    )
    const action = (yield* terminal.readLine("dbm> ")).trim().toLowerCase()
    switch (action) {
      case "1": {
        const text = yield* terminal.readLine(queryPrompt(database.kind))
        if (text.trim() === "") {
          break
        }
        yield* explorer.query(database, { text }).pipe(
          Effect.flatMap((result) => terminal.writeLine(renderQueryResult(result))),
          Effect.catch((error) => terminal.writeLine(`Query failed: ${error.message}`))
        )
        break
      }
      case "2":
        yield* explorer.listSchemas(database).pipe(
          Effect.flatMap((schemas) => terminal.writeLine(renderSchemas(schemas))),
          Effect.catch((error) => terminal.writeLine(`Schema inspection failed: ${error.message}`))
        )
        break
      case "3":
        yield* browseTables(terminal, explorer, database)
        break
      case "4": {
        const schema = database.kind === "postgres" || database.kind === "mysql"
          ? (yield* terminal.readLine("Schema/database filter (blank for all): ")).trim()
          : undefined
        yield* explorer.listTables(database, schema === "" ? undefined : schema).pipe(
          Effect.flatMap((tables) => terminal.writeLine(renderTables(tables))),
          Effect.catch((error) => terminal.writeLine(`Table listing failed: ${error.message}`))
        )
        break
      }
      case "b":
      case "back":
      case "q":
        active = false
        break
      default:
        yield* terminal.writeLine("Choose 1–4 or b.")
    }
  }
})

const browseTables = Effect.fn("Cli.browseTables")(function* (
  terminal: TerminalService,
  explorer: DatabaseExplorerService,
  database: DetectedDatabase
) {
  const schema = database.kind === "postgres" || database.kind === "mysql"
    ? (yield* terminal.readLine("Schema/database filter (blank for all): ")).trim()
    : undefined
  const noTables: ReadonlyArray<TableInfo> = []
  const tables = yield* explorer.listTables(database, schema === "" ? undefined : schema).pipe(
    Effect.catch((error) =>
      terminal.writeLine(`Table listing failed: ${error.message}`).pipe(Effect.as(noTables))
    )
  )
  if (tables.length === 0) {
    return
  }
  yield* terminal.writeLine(`\n${renderTables(tables)}`)
  const answer = yield* terminal.readLine("Table number (blank to cancel): ")
  const index = selection(answer, tables.length)
  if (index === undefined) {
    return
  }
  const table = tables[index]
  if (table === undefined) {
    return
  }
  yield* terminal.writeLine(`\n${table.name} columns:`)
  yield* explorer.describeTable(database, table).pipe(
    Effect.flatMap((columns) => terminal.writeLine(renderColumns(columns))),
    Effect.catch((error) => terminal.writeLine(`Description failed: ${error.message}`))
  )
  yield* explorer.browseTable(database, table, 50).pipe(
    Effect.flatMap((result) => terminal.writeLine(`\nFirst rows/values:\n${renderQueryResult(result)}`)),
    Effect.catch((error) => terminal.writeLine(`Browse failed: ${error.message}`))
  )
})

export const runCli = Effect.fn("Cli.run")(function* () {
  const terminal = yield* Terminal
  const docker = yield* DockerClient
  const discovery = yield* DatabaseDiscovery
  const explorer = yield* DatabaseExplorer

  yield* terminal.writeLine("dbm — local Docker database explorer")
  const ready = yield* docker.check.pipe(
    Effect.as(true),
    Effect.catchTag("DockerUnavailable", () => Effect.succeed(false))
  )

  if (!ready) {
    yield* terminal.writeLine("Docker is not running.")
    const answer = yield* terminal.readLine("Start OrbStack with `orb start` and reconnect? [Y/n] ")
    if (!isYes(answer)) {
      yield* terminal.writeLine("Docker is required. Exiting.")
      return
    }
    const started = yield* docker.startOrbStack.pipe(
      Effect.as(true),
      Effect.catch((error) => terminal.writeLine(`Could not run orb start: ${error.message}`).pipe(Effect.as(false)))
    )
    if (!started) {
      return
    }
    const reconnected = yield* docker.waitUntilReady().pipe(
      Effect.as(true),
      Effect.catch((error) => terminal.writeLine(`Docker did not reconnect: ${error.message}`).pipe(Effect.as(false)))
    )
    if (!reconnected) {
      return
    }
    yield* terminal.writeLine("Docker is ready.")
  }

  let active = true
  while (active) {
    const databases = yield* discovery.list
    yield* terminal.writeLine(`\n${renderDatabaseList(databases)}`)
    if (databases.length === 0) {
      yield* terminal.writeLine("Start a supported database container and press Enter to scan again, or q to quit.")
      const answer = (yield* terminal.readLine("dbm> ")).trim().toLowerCase()
      active = answer !== "q" && answer !== "quit"
      continue
    }
    const answer = yield* terminal.readLine("Select a container number, r to rescan, or q to quit: ")
    const normalized = answer.trim().toLowerCase()
    if (normalized === "q" || normalized === "quit") {
      active = false
      continue
    }
    if (normalized === "r" || normalized === "rescan") {
      continue
    }
    const index = selection(answer, databases.length)
    if (index === undefined) {
      yield* terminal.writeLine("Choose a listed container, r, or q.")
      continue
    }
    const database = databases[index]
    if (database !== undefined) {
      yield* makeDatabaseMenu(terminal, explorer, database)
    }
  }

  yield* terminal.writeLine("Goodbye.")
})
