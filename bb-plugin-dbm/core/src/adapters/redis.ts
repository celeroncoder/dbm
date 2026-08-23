import { Effect } from "effect"
import type { DockerClientService } from "../docker"
import { DatabaseOperationError } from "../errors"
import { parseCsv, tokenizeCommand } from "../result"
import { emptyResult } from "../result"
import type { DatabaseAdapter } from "../explorer"
import type {
  ColumnInfo,
  DetectedDatabase,
  QueryRequest,
  QueryResult,
  SchemaInfo,
  TableInfo
} from "../model"

const redisError = (operation: string, error: { readonly message: string }): DatabaseOperationError =>
  DatabaseOperationError.make({
    operation,
    message: error.message
  })

const redisKind: "redis" = "redis"

const toRedisResult = (stdout: string): QueryResult => {
  const rows = parseCsv(stdout)
  if (rows.length === 0) {
    return emptyResult()
  }
  const width = Math.max(...rows.map((row) => row.length))
  const columns = Array.from({ length: width }, (_value, index) =>
    index === 0 && width === 1 ? "value" : `value_${index + 1}`
  )
  return {
    columns,
    rows,
    rowCount: rows.length,
    truncated: false
  }
}

export const makeRedisAdapter = (docker: DockerClientService): Effect.Effect<DatabaseAdapter, never> =>
  Effect.succeed<DatabaseAdapter>({
    kind: redisKind,
    testConnection: Effect.fn("RedisAdapter.testConnection")(function* (database: DetectedDatabase) {
      yield* runRedis(docker, database, ["PING"])
    }),
    query: Effect.fn("RedisAdapter.query")(function* (database: DetectedDatabase, request: QueryRequest) {
      const args = yield* tokenizeCommand(request.text).pipe(
        Effect.mapError((error) => redisError("parse Redis command", error))
      )
      if (args.length === 0) {
        return yield* Effect.fail(
          DatabaseOperationError.make({
            operation: "run Redis command",
            message: "Enter a Redis command, for example GET my-key."
          })
        )
      }
      const result = yield* runRedis(docker, database, args)
      return toRedisResult(result)
    }),
    listSchemas: Effect.fn("RedisAdapter.listSchemas")(function* (_database: DetectedDatabase) {
      const schemas: ReadonlyArray<SchemaInfo> = [{ name: "default", kind: "keyspace" }]
      return schemas
    }),
    listTables: Effect.fn("RedisAdapter.listTables")(function* (database: DetectedDatabase) {
      const output = yield* runRedis(docker, database, ["SCAN", "0", "COUNT", "1000"])
      const rows = parseCsv(output)
      const keys = rows.flatMap((row) => row.slice(1)).filter((key) => key !== "")
      return keys.map((key) => ({
        name: key,
        kind: "key",
        rowCount: -1
      }))
    }),
    describeTable: Effect.fn("RedisAdapter.describeTable")(function* (database: DetectedDatabase, table: TableInfo) {
      const typeOutput = yield* runRedis(docker, database, ["TYPE", table.name])
      const ttlOutput = yield* runRedis(docker, database, ["TTL", table.name])
      const type = parseCsv(typeOutput)[0]?.[0] ?? "unknown"
      const ttl = parseCsv(ttlOutput)[0]?.[0] ?? "unknown"
      const columns: ReadonlyArray<ColumnInfo> = [
        { name: "key", dataType: "string", nullable: false },
        { name: "type", dataType: type, nullable: false },
        { name: "ttl_seconds", dataType: "integer", nullable: false, defaultValue: ttl }
      ]
      return columns
    }),
    browseTable: Effect.fn("RedisAdapter.browseTable")(function* (
      database: DetectedDatabase,
      table: TableInfo,
      limit = 50
    ) {
      const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)))
      const typeOutput = yield* runRedis(docker, database, ["TYPE", table.name])
      const type = parseCsv(typeOutput)[0]?.[0] ?? "string"
      let command: ReadonlyArray<string>
      switch (type) {
        case "list":
          command = ["LRANGE", table.name, "0", String(boundedLimit - 1)]
          break
        case "set":
          command = ["SSCAN", table.name, "0", "COUNT", String(boundedLimit)]
          break
        case "zset":
          command = ["ZRANGE", table.name, "0", String(boundedLimit - 1), "WITHSCORES"]
          break
        case "hash":
          command = ["HGETALL", table.name]
          break
        case "stream":
          command = ["XRANGE", table.name, "-", "+", "COUNT", String(boundedLimit)]
          break
        default:
          command = ["GET", table.name]
      }
      const output = yield* runRedis(docker, database, command)
      return toRedisResult(output)
    })
  })

const runRedis = Effect.fn("RedisAdapter.runRedis")(function* (
  docker: DockerClientService,
  database: DetectedDatabase,
  args: ReadonlyArray<string>
) {
  const password = database.environment.REDIS_PASSWORD ?? database.environment.REDISCLI_AUTH
  const environment: Readonly<Record<string, string>> = password === undefined ? {} : { REDISCLI_AUTH: password }
  const result = yield* docker.exec(
    database.id,
    "redis-cli",
    ["--csv", "--no-auth-warning", ...args],
    environment
  ).pipe(Effect.mapError((error) => redisError("run Redis command", error)))
  return result.stdout
})
