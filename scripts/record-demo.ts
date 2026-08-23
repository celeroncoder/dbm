import { Console, Duration, Effect, Layer } from "effect"
import { DatabaseAdapterRegistryLive } from "../bb-plugin-dbm/core/src/adapters"
import { CommandRunnerLive } from "../bb-plugin-dbm/core/src/command-bun"
import { DatabaseDiscovery, DatabaseDiscoveryLive } from "../bb-plugin-dbm/core/src/discovery"
import { DockerClient, DockerClientLive } from "../bb-plugin-dbm/core/src/docker"
import { InputError } from "../bb-plugin-dbm/core/src/errors"
import { DatabaseExplorer, DatabaseExplorerLive } from "../bb-plugin-dbm/core/src/explorer"
import {
  renderColumns,
  renderDatabaseList,
  renderQueryResult,
  renderSchemas,
  renderTables
} from "../src/cli/render"

const DockerLive = DockerClientLive.pipe(Layer.provide(CommandRunnerLive))
const DiscoveryLive = DatabaseDiscoveryLive.pipe(Layer.provide(DockerLive))
const AdaptersLive = DatabaseAdapterRegistryLive.pipe(Layer.provide(DockerLive))
const ExplorerLive = DatabaseExplorerLive.pipe(Layer.provide(AdaptersLive))
const AppLive = Layer.mergeAll(DockerLive, DiscoveryLive, AdaptersLive, ExplorerLive)

const pause = Effect.sleep(Duration.millis(700))
const write = (text: string) => Console.log(text).pipe(Effect.flatMap(() => pause))
const prompt = (text: string, answer: string) => write(`${text}\u001b[36m${answer}\u001b[0m`)

const demo = Effect.gen(function* () {
  const docker = yield* DockerClient
  const discovery = yield* DatabaseDiscovery
  const explorer = yield* DatabaseExplorer

  yield* write("dbm - local Docker database explorer")
  yield* docker.check
  const databases = yield* discovery.list
  yield* write(`\n${renderDatabaseList(databases)}`)

  const selectedIndex = databases.findIndex((database) => database.name === "dbm-verify-recording-postgres")
  if (selectedIndex < 0) {
    return yield* Effect.fail(InputError.make({ message: "The recording database was not discovered." }))
  }
  const database = databases[selectedIndex]
  if (database === undefined) {
    return yield* Effect.fail(InputError.make({ message: "The recording selection was not available." }))
  }

  yield* prompt("Select a container number, r to rescan, or q to quit: ", String(selectedIndex + 1))
  yield* write(`\nSelected ${database.name} (PostgreSQL).`)
  yield* explorer.testConnection(database)
  yield* write("Connection ready.")

  const menu = "\n1. Query   2. Schemas/databases   3. Browse tables/keys   4. List tables/keys   b. Back"
  yield* write(menu)
  yield* prompt("dbm> ", "2")
  const schemas = yield* explorer.listSchemas(database)
  yield* write(renderSchemas(schemas))

  yield* write(menu)
  yield* prompt("dbm> ", "3")
  yield* prompt("Schema/database filter (blank for all): ", "")
  const tables = yield* explorer.listTables(database)
  yield* write(`\n${renderTables(tables)}`)
  const tableIndex = tables.findIndex((table) => table.name === "dbm_demo")
  const table = tables[tableIndex]
  if (table === undefined) {
    return yield* Effect.fail(InputError.make({ message: "The recording table was not listed." }))
  }
  yield* prompt("Table number (blank to cancel): ", String(tableIndex + 1))
  yield* write(`\n${table.name} columns:`)
  yield* explorer.describeTable(database, table).pipe(
    Effect.flatMap((columns) => write(renderColumns(columns)))
  )
  yield* explorer.browseTable(database, table, 50).pipe(
    Effect.flatMap((result) => write(`\nFirst rows/values:\n${renderQueryResult(result)}`))
  )

  yield* write(menu)
  yield* prompt("dbm> ", "1")
  const query = "SELECT id, name FROM dbm_demo ORDER BY id;"
  yield* prompt("SQL query (blank to cancel): ", query)
  yield* explorer.query(database, { text: query }).pipe(
    Effect.flatMap((result) => write(renderQueryResult(result)))
  )
  yield* write(menu)
  yield* prompt("dbm> ", "b")
  yield* prompt("Select a container number, r to rescan, or q to quit: ", "q")
  yield* write("Goodbye.")
})

void Effect.runPromise(demo.pipe(Effect.provide(AppLive))).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
