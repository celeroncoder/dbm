import { Context, Effect, Layer } from "effect"
import { DockerClient } from "./docker"
import { DockerOperationError } from "./errors"
import type { DatabaseKind, DetectedDatabase } from "./model"
import { databaseKinds } from "./model"

const contains = (value: string, needles: ReadonlyArray<string>): boolean =>
  needles.some((needle) => value.includes(needle))

export const detectDatabaseKind = (
  image: string,
  name: string,
  labelsText = ""
): DatabaseKind | undefined => {
  const value = `${image} ${name} ${labelsText}`.toLowerCase()
  if (contains(value, ["postgres", "postgis", "pgvector"])) {
    return "postgres"
  }
  if (contains(value, ["mysql", "mariadb"])) {
    return "mysql"
  }
  if (contains(value, ["redis", "valkey"])) {
    return "redis"
  }
  if (contains(value, ["mongo", "mongodb"])) {
    return "mongo"
  }
  return undefined
}

export const displayDatabaseKind = (kind: DatabaseKind): string => {
  switch (kind) {
    case "postgres":
      return "PostgreSQL"
    case "mysql":
      return "MySQL"
    case "redis":
      return "Redis"
    case "mongo":
      return "MongoDB"
  }
}

export class DatabaseDiscovery extends Context.Service<DatabaseDiscovery, {
  readonly list: Effect.Effect<ReadonlyArray<DetectedDatabase>, DockerOperationError>
}>()("dbm/DatabaseDiscovery") {}

const makeDatabaseDiscovery = Effect.gen(function* () {
  const docker = yield* DockerClient

  const list = Effect.fn("DatabaseDiscovery.list")(function* () {
    const containers = yield* docker.listContainers
    const databases: Array<DetectedDatabase> = []

    for (const container of containers) {
      const kind = detectDatabaseKind(container.image, container.name, container.labelsText)
      if (kind === undefined) {
        continue
      }

      const fallbackDetails = {
        id: container.id,
        name: container.name,
        image: container.image,
        environment: {},
        labels: {}
      }
      const details = yield* docker.inspectContainer(container.id).pipe(
        Effect.catch(() => Effect.succeed(fallbackDetails))
      )

      databases.push({
        id: container.id,
        name: details.name,
        image: details.image,
        kind,
        status: container.status,
        ports: container.ports,
        labels: Object.keys(details.labels).length === 0
          ? Object.fromEntries(
              container.labelsText
                .split(",")
                .map((label) => label.trim())
                .filter((label) => label.includes("="))
                .map((label) => {
                  const separator = label.indexOf("=")
                  return [label.slice(0, separator), label.slice(separator + 1)]
                })
            )
          : details.labels,
        environment: details.environment
      })
    }

    return databases
  })

  return { list: list() }
})

export const DatabaseDiscoveryLive = Layer.effect(DatabaseDiscovery, makeDatabaseDiscovery)

export const supportedDatabaseKinds = databaseKinds
