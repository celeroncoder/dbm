import { Effect, Layer } from "effect"
import { DockerClient } from "../docker"
import { DatabaseAdapterRegistry } from "../explorer"
import { makeMongoAdapter } from "./mongo"
import { makeMysqlAdapter, makePostgresAdapter } from "./sql"
import { makeRedisAdapter } from "./redis"

const makeAdapterRegistry = Effect.gen(function* () {
  const docker = yield* DockerClient
  const postgres = yield* makePostgresAdapter(docker)
  const mysql = yield* makeMysqlAdapter(docker)
  const redis = yield* makeRedisAdapter(docker)
  const mongo = yield* makeMongoAdapter(docker)

  return {
    get: (kind: "postgres" | "mysql" | "redis" | "mongo") => {
      switch (kind) {
        case "postgres":
          return postgres
        case "mysql":
          return mysql
        case "redis":
          return redis
        case "mongo":
          return mongo
      }
    }
  }
})

export const DatabaseAdapterRegistryLive = Layer.effect(
  DatabaseAdapterRegistry,
  makeAdapterRegistry
)
