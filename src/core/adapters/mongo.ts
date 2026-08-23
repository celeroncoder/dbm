import { Effect } from "effect"
import type { DockerClientService } from "../docker"
import { DatabaseOperationError } from "../errors"
import { emptyResult } from "../result"
import type { DatabaseAdapter } from "../explorer"
import type {
  ColumnInfo,
  DetectedDatabase,
  QueryRequest,
  QueryResult,
  TableInfo
} from "../model"

const mongoError = (operation: string, error: { readonly message: string }): DatabaseOperationError =>
  DatabaseOperationError.make({
    operation,
    message: error.message
  })

const mongoKind: "mongo" = "mongo"

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const cellValue = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === "string") {
    return value
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value)
  }
  return JSON.stringify(value) ?? String(value)
}

export const jsonValueToQueryResult = (value: unknown): QueryResult => {
  if (Array.isArray(value)) {
    const records = value.filter(isRecord)
    if (records.length === value.length && records.length > 0) {
      const columns = Array.from(
        new Set(records.flatMap((record) => Object.keys(record)))
      )
      return {
        columns,
        rows: records.map((record) => columns.map((column) => cellValue(record[column]))),
        rowCount: records.length,
        truncated: false
      }
    }
    return {
      columns: ["value"],
      rows: value.map((item) => [cellValue(item)]),
      rowCount: value.length,
      truncated: false
    }
  }

  if (isRecord(value)) {
    const columns = Object.keys(value)
    return {
      columns,
      rows: [columns.map((column) => cellValue(value[column]))],
      rowCount: 1,
      truncated: false
    }
  }

  return value === undefined ? emptyResult() : {
    columns: ["value"],
    rows: [[cellValue(value)]],
    rowCount: 1,
    truncated: false
  }
}

const parseJsonOutput = (stdout: string): Effect.Effect<unknown, DatabaseOperationError> =>
  Effect.try({
    try: (): unknown => {
      const text = stdout.trim()
      return text === "undefined" || text === "" ? undefined : JSON.parse(text)
    },
    catch: (cause) => mongoError("parse MongoDB response", cause instanceof Error ? cause : new Error(String(cause)))
  })

const makeMongoArgs = (database: DetectedDatabase, script: string): ReadonlyArray<string> => {
  const user = database.environment.MONGO_INITDB_ROOT_USERNAME
  const password = database.environment.MONGO_INITDB_ROOT_PASSWORD
  const databaseName = database.environment.MONGO_INITDB_DATABASE ?? "test"
  const auth = user === undefined
    ? []
    : ["--username", user, "--password", password ?? "", "--authenticationDatabase", "admin"]
  return [
    ...auth,
    databaseName,
    "--quiet",
    "--json=canonical",
    "--eval",
    script
  ]
}

const runMongo = Effect.fn("MongoAdapter.runMongo")(function* (
  docker: DockerClientService,
  database: DetectedDatabase,
  script: string
) {
  const args = makeMongoArgs(database, script)
  const result = yield* docker.exec(database.id, "mongosh", args).pipe(
    Effect.catch((error) =>
      error.message.includes("not found") || error.message.includes("No such file")
        ? docker.exec(database.id, "mongo", ["--quiet", ...args.filter((arg) => arg !== "--json=canonical")])
        : Effect.fail(error)
    ),
    Effect.mapError((error) => mongoError("run MongoDB command", error))
  )
  return yield* parseJsonOutput(result.stdout)
})

export const makeMongoAdapter = (docker: DockerClientService): Effect.Effect<DatabaseAdapter, never> =>
  Effect.succeed<DatabaseAdapter>({
    kind: mongoKind,
    testConnection: Effect.fn("MongoAdapter.testConnection")(function* (database: DetectedDatabase) {
      yield* runMongo(docker, database, "print(EJSON.stringify(db.runCommand({ ping: 1 })))")
    }),
    query: Effect.fn("MongoAdapter.query")(function* (database: DetectedDatabase, request: QueryRequest) {
      const script = `const __value = (${request.text}); print(EJSON.stringify(__value))`
      const value = yield* runMongo(docker, database, script)
      return jsonValueToQueryResult(value)
    }),
    listSchemas: Effect.fn("MongoAdapter.listSchemas")(function* (database: DetectedDatabase) {
      const value = yield* runMongo(
        docker,
        database,
        "print(EJSON.stringify(db.getMongo().getDBs().databases.map((database) => database.name)))"
      )
      if (!Array.isArray(value)) {
        return []
      }
      return value
        .filter((item): item is string => typeof item === "string")
        .map((name) => ({ name, kind: "database" }))
    }),
    listTables: Effect.fn("MongoAdapter.listTables")(function* (database: DetectedDatabase) {
      const value = yield* runMongo(docker, database, "print(EJSON.stringify(db.getCollectionNames()))")
      if (!Array.isArray(value)) {
        return []
      }
      return value
        .filter((item): item is string => typeof item === "string")
        .map((name) => ({ name, kind: "collection", rowCount: -1 }))
    }),
    describeTable: Effect.fn("MongoAdapter.describeTable")(function* (database: DetectedDatabase, table: TableInfo) {
      const encodedName = JSON.stringify(table.name)
      const value = yield* runMongo(
        docker,
        database,
        `print(EJSON.stringify(db.getCollection(${encodedName}).findOne()))`
      )
      if (!isRecord(value)) {
        return []
      }
      return Object.keys(value).map((name): ColumnInfo => ({
        name,
        dataType: typeof value[name]
      }))
    }),
    browseTable: Effect.fn("MongoAdapter.browseTable")(function* (
      database: DetectedDatabase,
      table: TableInfo,
      limit = 50
    ) {
      const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)))
      const encodedName = JSON.stringify(table.name)
      const value = yield* runMongo(
        docker,
        database,
        `print(EJSON.stringify(db.getCollection(${encodedName}).find({}).limit(${boundedLimit}).toArray()))`
      )
      return jsonValueToQueryResult(value)
    })
  })
