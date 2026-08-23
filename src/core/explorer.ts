import { Context, Effect, Layer } from "effect"
import { DatabaseOperationError } from "./errors"
import type {
  ColumnInfo,
  DatabaseKind,
  DetectedDatabase,
  QueryRequest,
  QueryResult,
  SchemaInfo,
  TableInfo
} from "./model"

export interface DatabaseAdapter {
  readonly kind: DatabaseKind
  readonly testConnection: (database: DetectedDatabase) => Effect.Effect<void, DatabaseOperationError>
  readonly query: (database: DetectedDatabase, request: QueryRequest) => Effect.Effect<QueryResult, DatabaseOperationError>
  readonly listSchemas: (database: DetectedDatabase) => Effect.Effect<ReadonlyArray<SchemaInfo>, DatabaseOperationError>
  readonly listTables: (database: DetectedDatabase, schema?: string) => Effect.Effect<ReadonlyArray<TableInfo>, DatabaseOperationError>
  readonly describeTable: (database: DetectedDatabase, table: TableInfo) => Effect.Effect<ReadonlyArray<ColumnInfo>, DatabaseOperationError>
  readonly browseTable: (database: DetectedDatabase, table: TableInfo, limit?: number) => Effect.Effect<QueryResult, DatabaseOperationError>
}

export class DatabaseAdapterRegistry extends Context.Service<DatabaseAdapterRegistry, {
  readonly get: (kind: DatabaseKind) => DatabaseAdapter
}>()("dbm/DatabaseAdapterRegistry") {}

export type DatabaseAdapterRegistryService = Context.Service.Shape<typeof DatabaseAdapterRegistry>

export class DatabaseExplorer extends Context.Service<DatabaseExplorer, {
  readonly testConnection: (database: DetectedDatabase) => Effect.Effect<void, DatabaseOperationError>
  readonly query: (database: DetectedDatabase, request: QueryRequest) => Effect.Effect<QueryResult, DatabaseOperationError>
  readonly listSchemas: (database: DetectedDatabase) => Effect.Effect<ReadonlyArray<SchemaInfo>, DatabaseOperationError>
  readonly listTables: (database: DetectedDatabase, schema?: string) => Effect.Effect<ReadonlyArray<TableInfo>, DatabaseOperationError>
  readonly describeTable: (database: DetectedDatabase, table: TableInfo) => Effect.Effect<ReadonlyArray<ColumnInfo>, DatabaseOperationError>
  readonly browseTable: (database: DetectedDatabase, table: TableInfo, limit?: number) => Effect.Effect<QueryResult, DatabaseOperationError>
}>()("dbm/DatabaseExplorer") {}

export type DatabaseExplorerService = Context.Service.Shape<typeof DatabaseExplorer>

const makeDatabaseExplorer = Effect.gen(function* () {
  const registry = yield* DatabaseAdapterRegistry

  const testConnection = Effect.fn("DatabaseExplorer.testConnection")(function* (database: DetectedDatabase) {
    return yield* registry.get(database.kind).testConnection(database)
  })

  const query = Effect.fn("DatabaseExplorer.query")(function* (
    database: DetectedDatabase,
    request: QueryRequest
  ) {
    return yield* registry.get(database.kind).query(database, request)
  })

  const listSchemas = Effect.fn("DatabaseExplorer.listSchemas")(function* (database: DetectedDatabase) {
    return yield* registry.get(database.kind).listSchemas(database)
  })

  const listTables = Effect.fn("DatabaseExplorer.listTables")(function* (
    database: DetectedDatabase,
    schema?: string
  ) {
    return yield* registry.get(database.kind).listTables(database, schema)
  })

  const describeTable = Effect.fn("DatabaseExplorer.describeTable")(function* (
    database: DetectedDatabase,
    table: TableInfo
  ) {
    return yield* registry.get(database.kind).describeTable(database, table)
  })

  const browseTable = Effect.fn("DatabaseExplorer.browseTable")(function* (
    database: DetectedDatabase,
    table: TableInfo,
    limit?: number
  ) {
    return yield* registry.get(database.kind).browseTable(database, table, limit)
  })

  return {
    testConnection,
    query,
    listSchemas,
    listTables,
    describeTable,
    browseTable
  }
})

export const DatabaseExplorerLive = Layer.effect(DatabaseExplorer, makeDatabaseExplorer)
