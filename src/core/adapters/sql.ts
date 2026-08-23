import { Effect } from "effect"
import type { DockerClientService } from "../docker"
import { DatabaseOperationError } from "../errors"
import { csvToQueryResult, tsvToQueryResult } from "../result"
import type {
  DetectedDatabase,
  QueryRequest,
  TableInfo
} from "../model"
import type { DatabaseAdapter } from "../explorer"

const valueAt = (row: ReadonlyArray<string | null>, index: number): string => row[index] ?? ""

const errorFrom = (operation: string, error: { readonly message: string }): DatabaseOperationError =>
  DatabaseOperationError.make({
    operation,
    message: error.message
  })

const quotePostgresIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`
const quoteMysqlIdentifier = (value: string): string => `\`${value.replaceAll("`", "``")}\``
const quoteSqlLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`

interface SqlAdapterConfig {
  readonly kind: "postgres" | "mysql"
  readonly command: string
  readonly user: (database: DetectedDatabase) => string
  readonly database: (database: DetectedDatabase) => string
  readonly password: (database: DetectedDatabase) => string | undefined
  readonly passwordVariable: string
  readonly listSchemasSql: string
  readonly listTablesSql: (schema?: string) => string
  readonly describeTableSql: (table: TableInfo) => string
  readonly browseTableSql: (table: TableInfo, limit: number) => string
}

const makeSqlAdapter = Effect.fn("makeSqlAdapter")(function* (
  docker: DockerClientService,
  config: SqlAdapterConfig
) {
  const run = Effect.fn("SqlAdapter.run")(function* (database: DetectedDatabase, request: QueryRequest) {
    const user = config.user(database)
    const databaseName = config.database(database)
    const password = config.password(database)
    const environment = password === undefined ? {} : { [config.passwordVariable]: password }
    const args =
      config.kind === "postgres"
        ? [
            "-X",
            "-q",
            "--csv",
            "-P",
            "footer=off",
            "-P",
            "null=NULL",
            "-U",
            user,
            "-d",
            databaseName,
            "-c",
            request.text
          ]
        : [
            "--batch",
            "--raw",
            "--column-names",
            "--skip-auto-rehash",
            "-u",
            user,
            "-e",
            request.text,
            ...(databaseName === "" ? [] : [databaseName])
          ]
    const result = yield* docker.exec(database.id, config.command, args, environment).pipe(
      Effect.mapError((error) => errorFrom("run database query", error))
    )
    return config.kind === "postgres"
      ? csvToQueryResult(result.stdout)
      : tsvToQueryResult(result.stdout)
  })

  const testConnection = Effect.fn("SqlAdapter.testConnection")(function* (database: DetectedDatabase) {
    yield* run(database, { text: "SELECT 1" })
  })

  const listSchemas = Effect.fn("SqlAdapter.listSchemas")(function* (database: DetectedDatabase) {
    const result = yield* run(database, { text: config.listSchemasSql })
    return result.rows.map((row) => ({ name: valueAt(row, 0) })).filter((schema) => schema.name !== "")
  })

  const listTables = Effect.fn("SqlAdapter.listTables")(function* (
    database: DetectedDatabase,
    schema?: string
  ) {
    const result = yield* run(database, { text: config.listTablesSql(schema) })
    return result.rows
      .map((row) => ({
        schema: valueAt(row, 0),
        name: valueAt(row, 1),
        kind: valueAt(row, 2)
      }))
      .filter((table) => table.name !== "")
  })

  const describeTable = Effect.fn("SqlAdapter.describeTable")(function* (
    database: DetectedDatabase,
    table: TableInfo
  ) {
    const result = yield* run(database, { text: config.describeTableSql(table) })
    return result.rows
      .map((row) => ({
        name: valueAt(row, 0),
        dataType: valueAt(row, 1),
        nullable: valueAt(row, 2).toUpperCase() === "YES",
        defaultValue: valueAt(row, 3)
      }))
      .filter((column) => column.name !== "")
  })

  const browseTable = Effect.fn("SqlAdapter.browseTable")(function* (
    database: DetectedDatabase,
    table: TableInfo,
    limit = 50
  ) {
    const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)))
    return yield* run(database, { text: config.browseTableSql(table, boundedLimit) })
  })

  const adapter: DatabaseAdapter = {
    kind: config.kind,
    testConnection,
    query: run,
    listSchemas,
    listTables,
    describeTable,
    browseTable
  }
  return adapter
})

export const makePostgresAdapter = (docker: DockerClientService): Effect.Effect<DatabaseAdapter, never> =>
  makeSqlAdapter(docker, {
    kind: "postgres",
    command: "psql",
    user: (database) => database.environment.POSTGRES_USER ?? "postgres",
    database: (database) =>
      database.environment.POSTGRES_DB ?? database.environment.POSTGRES_USER ?? "postgres",
    password: (database) => database.environment.POSTGRES_PASSWORD,
    passwordVariable: "PGPASSWORD",
    listSchemasSql:
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog', 'information_schema') ORDER BY schema_name",
    listTablesSql: (schema) => {
      const condition = schema === undefined
        ? "table_schema NOT IN ('pg_catalog', 'information_schema')"
        : `table_schema = ${quoteSqlLiteral(schema)}`
      return `SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE ${condition} ORDER BY table_schema, table_name`
    },
    describeTableSql: (table) => {
      const schema = table.schema ?? "public"
      return `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = ${quoteSqlLiteral(schema)} AND table_name = ${quoteSqlLiteral(table.name)} ORDER BY ordinal_position`
    },
    browseTableSql: (table, limit) => {
      const schema = table.schema ?? "public"
      return `SELECT * FROM ${quotePostgresIdentifier(schema)}.${quotePostgresIdentifier(table.name)} LIMIT ${limit}`
    }
  })

export const makeMysqlAdapter = (docker: DockerClientService): Effect.Effect<DatabaseAdapter, never> =>
  makeSqlAdapter(docker, {
    kind: "mysql",
    command: "mysql",
    user: (database) => database.environment.MYSQL_USER ?? "root",
    database: (database) => database.environment.MYSQL_DATABASE ?? "",
    password: (database) =>
      database.environment.MYSQL_PASSWORD ?? database.environment.MYSQL_ROOT_PASSWORD,
    passwordVariable: "MYSQL_PWD",
    listSchemasSql:
      "SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys') ORDER BY SCHEMA_NAME",
    listTablesSql: (schema) => {
      const condition = schema === undefined
        ? "TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')"
        : `TABLE_SCHEMA = ${quoteSqlLiteral(schema)}`
      return `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE ${condition} ORDER BY TABLE_SCHEMA, TABLE_NAME`
    },
    describeTableSql: (table) => {
      const schema = table.schema ?? ""
      return `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ${quoteSqlLiteral(schema)} AND TABLE_NAME = ${quoteSqlLiteral(table.name)} ORDER BY ORDINAL_POSITION`
    },
    browseTableSql: (table, limit) => {
      const schema = table.schema ?? ""
      const qualified = schema === ""
        ? quoteMysqlIdentifier(table.name)
        : `${quoteMysqlIdentifier(schema)}.${quoteMysqlIdentifier(table.name)}`
      return `SELECT * FROM ${qualified} LIMIT ${limit}`
    }
  })
