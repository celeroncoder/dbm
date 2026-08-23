import { randomUUID } from "node:crypto"
import { Context, Duration, Effect, Layer, Option } from "effect"
import { detectDatabaseKind } from "./discovery"
import { DockerClient } from "./docker"
import { DockerOperationError } from "./errors"
import type {
  ContainerPort,
  CreateDatabaseRequest,
  DatabaseConnection,
  DatabaseImageStatus,
  DatabaseKind,
  DatabaseLogs,
  DetectedDatabase,
  ManagedDatabase,
  ManagedDatabaseStatus
} from "./model"
import { databaseKinds } from "./model"

export const dbmManagedLabel = "com.dbm.managed"
export const dbmKindLabel = "com.dbm.kind"
export const dbmAliasLabel = "com.dbm.alias"
export const dbmVersionLabel = "com.dbm.schema"

interface DatabaseTemplate {
  readonly image: string
  readonly version: string
  readonly privatePort: number
  readonly database: string
  readonly username: string
  readonly password: string | null
  readonly environment: Readonly<Record<string, string>>
}

const templateFor = (kind: DatabaseKind): DatabaseTemplate => {
  switch (kind) {
    case "postgres":
      return {
        image: "postgres:16-alpine",
        version: "16-alpine",
        privatePort: 5432,
        database: "dbm",
        username: "dbm",
        password: "dbm",
        environment: {
          POSTGRES_DB: "dbm",
          POSTGRES_USER: "dbm",
          POSTGRES_PASSWORD: "dbm"
        }
      }
    case "mysql":
      return {
        image: "mysql:8.4",
        version: "8.4",
        privatePort: 3306,
        database: "dbm",
        username: "dbm",
        password: "dbm",
        environment: {
          MYSQL_DATABASE: "dbm",
          MYSQL_USER: "dbm",
          MYSQL_PASSWORD: "dbm",
          MYSQL_ROOT_PASSWORD: "dbmroot"
        }
      }
    case "redis":
      return {
        image: "redis:7-alpine",
        version: "7-alpine",
        privatePort: 6379,
        database: "0",
        username: "",
        password: null,
        environment: {}
      }
    case "mongo":
      return {
        image: "mongo:7",
        version: "7",
        privatePort: 27017,
        database: "dbm",
        username: "dbm",
        password: "dbm",
        environment: {
          MONGO_INITDB_DATABASE: "dbm",
          MONGO_INITDB_ROOT_USERNAME: "dbm",
          MONGO_INITDB_ROOT_PASSWORD: "dbm"
        }
      }
  }
}

export const normalizeDatabaseAlias = (value: string | undefined, kind: DatabaseKind, suffix: string): string => {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "")
  return normalized === undefined || normalized === "" ? `${kind}-${suffix}` : normalized.slice(0, 48)
}

const containerNameFor = (alias: string, suffix: string): string =>
  `dbm-managed-${alias.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").slice(0, 48)}-${suffix}`

const statusFor = (status: string): ManagedDatabaseStatus => {
  const normalized = status.toLowerCase()
  if (normalized.includes("paused")) {
    return "paused"
  }
  if (normalized.startsWith("up") || normalized.startsWith("running")) {
    return "running"
  }
  if (normalized.startsWith("created")) {
    return "created"
  }
  if (normalized.startsWith("exited") || normalized.startsWith("dead")) {
    return "stopped"
  }
  return "unknown"
}

const kindFrom = (value: string | undefined): DatabaseKind | undefined => {
  switch (value) {
    case "postgres":
    case "mysql":
    case "redis":
    case "mongo":
      return value
    default:
      return undefined
  }
}

const publicPortFor = (ports: ReadonlyArray<ContainerPort>, privatePort: number): number | undefined => {
  const match = ports.find((port) => port.privatePort === String(privatePort) && port.publicPort !== undefined)
  if (match?.publicPort === undefined) {
    return undefined
  }
  const port = Number.parseInt(match.publicPort, 10)
  return Number.isInteger(port) && port > 0 ? port : undefined
}

const connectionFor = (
  kind: DatabaseKind,
  environment: Readonly<Record<string, string>>,
  ports: ReadonlyArray<ContainerPort>
): DatabaseConnection | null => {
  const template = templateFor(kind)
  const port = publicPortFor(ports, template.privatePort)
  if (port === undefined) {
    return null
  }

  const host = "127.0.0.1"
  const database = kind === "postgres"
    ? environment.POSTGRES_DB ?? "postgres"
    : kind === "mysql"
      ? environment.MYSQL_DATABASE ?? ""
      : kind === "mongo"
        ? environment.MONGO_INITDB_DATABASE ?? "dbm"
        : "0"
  const username = kind === "postgres"
    ? environment.POSTGRES_USER ?? "postgres"
    : kind === "mysql"
      ? environment.MYSQL_USER ?? "root"
      : kind === "mongo"
        ? environment.MONGO_INITDB_ROOT_USERNAME ?? ""
        : ""
  const password = kind === "postgres"
    ? environment.POSTGRES_PASSWORD ?? null
    : kind === "mysql"
      ? environment.MYSQL_PASSWORD ?? environment.MYSQL_ROOT_PASSWORD ?? null
      : kind === "mongo"
        ? environment.MONGO_INITDB_ROOT_PASSWORD ?? null
        : environment.REDIS_PASSWORD ?? environment.REDISCLI_AUTH ?? null
  const encodedUser = encodeURIComponent(username)
  const encodedPassword = password === null ? "" : encodeURIComponent(password)
  const authority = username === ""
    ? `${host}:${port}`
    : `${encodedUser}:${encodedPassword}@${host}:${port}`
  const url = kind === "postgres"
    ? `postgresql://${authority}/${encodeURIComponent(database)}`
    : kind === "mysql"
      ? `mysql://${authority}/${encodeURIComponent(database)}`
      : kind === "mongo"
        ? `mongodb://${authority}/${encodeURIComponent(database)}?authSource=admin`
        : `redis://${authority}`

  return {
    host,
    port,
    url,
    database,
    username,
    password
  }
}

export const managedToDetectedDatabase = (database: ManagedDatabase): DetectedDatabase => ({
  id: database.id,
  name: database.name,
  image: database.image,
  kind: database.kind,
  status: database.status,
  ports: database.ports,
  labels: database.labels,
  environment: database.environment
})

export class DatabaseManager extends Context.Service<DatabaseManager, {
  readonly list: Effect.Effect<ReadonlyArray<ManagedDatabase>, DockerOperationError>
  readonly get: (id: string) => Effect.Effect<ManagedDatabase, DockerOperationError>
  readonly create: (request: CreateDatabaseRequest) => Effect.Effect<ManagedDatabase, DockerOperationError>
  readonly start: (id: string) => Effect.Effect<ManagedDatabase, DockerOperationError>
  readonly restart: (id: string) => Effect.Effect<ManagedDatabase, DockerOperationError>
  readonly pause: (id: string) => Effect.Effect<ManagedDatabase, DockerOperationError>
  readonly unpause: (id: string) => Effect.Effect<ManagedDatabase, DockerOperationError>
  readonly stop: (id: string) => Effect.Effect<ManagedDatabase, DockerOperationError>
  readonly remove: (id: string) => Effect.Effect<void, DockerOperationError>
  readonly logs: (id: string, tail?: number) => Effect.Effect<DatabaseLogs, DockerOperationError>
  readonly imageStatus: Effect.Effect<ReadonlyArray<DatabaseImageStatus>, DockerOperationError>
}>()("dbm/DatabaseManager") {}

export type DatabaseManagerService = Context.Service.Shape<typeof DatabaseManager>

const operationError = (operation: string, message: string): DockerOperationError =>
  DockerOperationError.make({ operation, message })

const makeDatabaseManager = Effect.gen(function* () {
  const docker = yield* DockerClient

  const ensureDocker = Effect.fn("DatabaseManager.ensureDocker")(function* () {
    yield* docker.check.pipe(
      Effect.mapError((error) => operationError("check Docker daemon", error.message))
    )
  })

  const summaryToManaged = Effect.fn("DatabaseManager.summaryToManaged")(function* (
    summary: {
      readonly id: string
      readonly image: string
      readonly name: string
      readonly status: string
      readonly ports: ReadonlyArray<ContainerPort>
      readonly labelsText: string
    }
  ) {
    const fallbackLabels = Object.fromEntries(
      summary.labelsText
        .split(",")
        .map((label) => label.trim())
        .filter((label) => label.includes("="))
        .map((label) => {
          const separator = label.indexOf("=")
          return [label.slice(0, separator), label.slice(separator + 1)]
        })
    )
    const fallback = {
      id: summary.id,
      name: summary.name,
      image: summary.image,
      environment: {},
      labels: fallbackLabels
    }
    const inspected = yield* docker.inspectContainer(summary.id).pipe(Effect.option)
    const details = Option.getOrElse(inspected, () => fallback)
    const labels = Option.isSome(inspected) ? inspected.value.labels : fallbackLabels
    if (labels[dbmManagedLabel] !== "true") {
      return yield* Effect.fail(operationError(
        "read managed database",
        `Refusing container ${summary.name} because it is not labelled ${dbmManagedLabel}=true.`
      ))
    }
    const kind = kindFrom(labels[dbmKindLabel]) ?? detectDatabaseKind(details.image, details.name)
    if (kind === undefined) {
      return yield* Effect.fail(operationError("read managed database", `Unsupported database container ${details.name}.`))
    }
    const alias = labels[dbmAliasLabel] ?? details.name
    return {
      id: details.id,
      name: details.name,
      alias,
      image: details.image,
      kind,
      status: statusFor(summary.status),
      ports: summary.ports,
      labels,
      environment: details.environment,
      connection: connectionFor(kind, details.environment, summary.ports)
    }
  })

  const list = Effect.fn("DatabaseManager.list")(function* () {
    yield* ensureDocker()
    const containers = yield* docker.listManagedContainers
    const databases: Array<ManagedDatabase> = []
    for (const container of containers) {
      const database = yield* summaryToManaged(container)
      databases.push(database)
    }
    return databases
  })

  const get = Effect.fn("DatabaseManager.get")(function* (id: string) {
    const databases = yield* list()
    const database = databases.find((entry) => entry.id === id || entry.name === id || entry.alias === id)
    return database === undefined
      ? yield* Effect.fail(operationError("find managed database", `No dbm-managed database matches ${id}.`))
      : database
  })

  const getOwnedContainerId = Effect.fn("DatabaseManager.getOwnedContainerId")(function* (id: string) {
    const database = yield* get(id)
    const details = yield* docker.inspectContainer(database.id).pipe(
      Effect.mapError((error) => operationError(
        "validate managed database ownership",
        `Could not inspect ${database.name}; refusing lifecycle operation. ${error.message}`
      ))
    )
    if (details.labels[dbmManagedLabel] !== "true") {
      return yield* Effect.fail(operationError(
        "validate managed database ownership",
        `Refusing container ${database.name} because it is not labelled ${dbmManagedLabel}=true.`
      ))
    }
    return details.id
  })

  const readyCheck = Effect.fn("DatabaseManager.readyCheck")(function* (
    database: ManagedDatabase
  ) {
    const environment = database.environment
    const check = database.kind === "postgres"
      ? docker.exec(database.id, "pg_isready", [
          "-U", environment.POSTGRES_USER ?? "postgres",
          "-d", environment.POSTGRES_DB ?? "postgres"
        ])
      : database.kind === "mysql"
        ? docker.exec(database.id, "mysql", [
            "--protocol=socket",
            "--batch",
            "--skip-column-names",
            "-u", environment.MYSQL_USER ?? "root",
            "-e", "SELECT 1",
            ...(environment.MYSQL_DATABASE === undefined ? [] : [environment.MYSQL_DATABASE])
          ], environment.MYSQL_PASSWORD === undefined ? {} : { MYSQL_PWD: environment.MYSQL_PASSWORD })
        : database.kind === "redis"
          ? docker.exec(database.id, "redis-cli", ["PING"], environment.REDIS_PASSWORD === undefined ? {} : { REDISCLI_AUTH: environment.REDIS_PASSWORD })
          : (() => {
              const mongoAuth = environment.MONGO_INITDB_ROOT_USERNAME === undefined
                ? []
                : [
                    "--username", environment.MONGO_INITDB_ROOT_USERNAME,
                    "--password", environment.MONGO_INITDB_ROOT_PASSWORD ?? "",
                    "--authenticationDatabase", "admin"
                  ]
              const mongoArgs = [
                ...mongoAuth,
                "--quiet",
                "--eval", "db.runCommand({ ping: 1 })"
              ]
              return docker.exec(database.id, "mongosh", mongoArgs).pipe(
                Effect.catch((error) => error.message.includes("not found") || error.message.includes("No such file")
                  ? docker.exec(database.id, "mongo", ["--quiet", ...mongoArgs.filter((arg) => arg !== "--quiet")])
                  : Effect.fail(error)))
            })()
    yield* check
  })

  const waitUntilDatabaseReady = Effect.fn("DatabaseManager.waitUntilDatabaseReady")(function* (
    database: ManagedDatabase,
    timeoutMs = 90_000
  ) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const ready = yield* readyCheck(database).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false))
      )
      if (ready) {
        return database
      }
      yield* Effect.sleep(Duration.millis(500))
    }
    return yield* Effect.fail(operationError(
      "wait for database readiness",
      `${database.alias} did not accept connections within ${timeoutMs}ms. Run bb dbm logs ${database.alias}.`
    ))
  })

  const create = Effect.fn("DatabaseManager.create")(function* (request: CreateDatabaseRequest) {
    yield* ensureDocker()
    const template = templateFor(request.kind)
    const suffix = randomUUID().slice(0, 8)
    const alias = normalizeDatabaseAlias(request.alias, request.kind, suffix)
    const name = containerNameFor(alias, suffix)
    const labels = [
      "--label", `${dbmManagedLabel}=true`,
      "--label", `${dbmKindLabel}=${request.kind}`,
      "--label", `${dbmAliasLabel}=${alias}`,
      "--label", `${dbmVersionLabel}=1`
    ]
    const environment = Object.entries(template.environment).flatMap(([key, value]) => ["--env", `${key}=${value}`])
    const createResult = yield* docker.run([
      "run",
      "--detach",
      "--name", name,
      ...labels,
      ...environment,
      "--publish", `127.0.0.1::${template.privatePort}`,
      template.image
    ], {
      displayCommand: `docker run --detach --name ${name} ${template.image}`,
      timeoutMs: 120_000
    })
    const createdId = createResult.stdout.trim()
    return yield* list().pipe(
      Effect.flatMap((databases) => {
        const created = databases.find((entry) => entry.id === createdId || entry.name === name)
        return created === undefined
          ? Effect.fail(operationError("read created database", `Docker created ${name}, but it was not found.`))
          : Effect.succeed(created)
      }),
      Effect.flatMap((database) => waitUntilDatabaseReady(database)),
      Effect.tapError(() => docker.remove(createdId).pipe(Effect.ignore))
    )
  })

  const withLifecycle = (operation: string, action: (id: string) => Effect.Effect<void, DockerOperationError>) =>
    Effect.fn(`DatabaseManager.${operation}`)(function* (id: string) {
      const ownedId = yield* getOwnedContainerId(id)
      yield* action(ownedId)
      return yield* get(ownedId)
    })

  const start = withLifecycle("start", docker.start)
  const restart = withLifecycle("restart", docker.restart)
  const pause = withLifecycle("pause", docker.pause)
  const unpause = withLifecycle("unpause", docker.unpause)
  const stop = withLifecycle("stop", docker.stop)

  const remove = Effect.fn("DatabaseManager.remove")(function* (id: string) {
    const ownedId = yield* getOwnedContainerId(id)
    yield* docker.remove(ownedId)
  })

  const logs = Effect.fn("DatabaseManager.logs")(function* (id: string, tail = 200) {
    const database = yield* get(id)
    const result = yield* docker.logs(database.id, tail)
    const text = `${result.stdout}${result.stderr}`
    const maxLength = 20_000
    return {
      name: database.name,
      text: text.length > maxLength ? text.slice(text.length - maxLength) : text,
      truncated: text.length > maxLength
    }
  })

  const imageStatus = Effect.fn("DatabaseManager.imageStatus")(function* () {
    yield* ensureDocker()
    const statuses: Array<DatabaseImageStatus> = []
    for (const kind of databaseKinds) {
      const template = templateFor(kind)
      statuses.push({
        kind,
        image: template.image,
        version: template.version,
        installed: yield* docker.imageExists(template.image)
      })
    }
    return statuses
  })

  return { list: list(), get, create, start, restart, pause, unpause, stop, remove, logs, imageStatus: imageStatus() }
})

export const DatabaseManagerLive = Layer.effect(DatabaseManager, makeDatabaseManager)

export const databaseTemplate = (kind: DatabaseKind): Readonly<{
  readonly image: string
  readonly version: string
  readonly port: number
}> => {
  const template = templateFor(kind)
  return { image: template.image, version: template.version, port: template.privatePort }
}
