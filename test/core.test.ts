import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { CommandRunner, type CommandRunnerService } from "../src/core/command"
import { CommandError } from "../src/core/errors"
import { DatabaseDiscovery, DatabaseDiscoveryLive, detectDatabaseKind } from "../src/core/discovery"
import { DockerClient, DockerClientLive } from "../src/core/docker"
import { jsonValueToQueryResult } from "../src/core/adapters/mongo"
import { parseCsv, tokenizeCommand } from "../src/core/result"

describe("database detection", () => {
  it("recognizes common image and service names", () => {
    assert.strictEqual(detectDatabaseKind("postgres:16", "app-db"), "postgres")
    assert.strictEqual(detectDatabaseKind("mysql:8", "mysql"), "mysql")
    assert.strictEqual(detectDatabaseKind("redis:7-alpine", "cache"), "redis")
    assert.strictEqual(detectDatabaseKind("mongo:7", "documents"), "mongo")
    assert.isUndefined(detectDatabaseKind("nginx:latest", "web"))
  })
})

describe("result parsing", () => {
  it("parses quoted CSV cells and embedded commas", () => {
    assert.deepStrictEqual(parseCsv('id,name\n1,"Ada, Lovelace"\n'), [
      ["id", "name"],
      ["1", "Ada, Lovelace"]
    ])
  })

  it.effect("tokenizes quoted Redis commands", () =>
    Effect.gen(function* () {
      const tokens = yield* tokenizeCommand('HSET user:1 name "Ada Lovelace"')
      assert.deepStrictEqual(tokens, ["HSET", "user:1", "name", "Ada Lovelace"])
    })
  )

  it("normalizes MongoDB documents into a table result", () => {
    const result = jsonValueToQueryResult([
      { _id: "1", name: "Ada" },
      { _id: "2", active: true }
    ])
    assert.deepStrictEqual(result.columns, ["_id", "name", "active"])
    assert.deepStrictEqual(result.rows, [
      ["1", "Ada", null],
      ["2", null, "true"]
    ])
  })
})

describe("Docker client boundary", () => {
  it.effect("decodes running containers through the injected command runner", () => {
    const runner: CommandRunnerService = {
      run: (_command, args) => {
        if (args[0] === "ps") {
          return Effect.succeed({
            stdout: '{"ID":"abc123","Image":"postgres:16","Names":"db","Status":"Up 2 minutes","Ports":"0.0.0.0:5432->5432/tcp","Labels":"com.example.role=database"}\n',
            stderr: "",
            exitCode: 0
          })
        }
        return Effect.succeed({ stdout: "", stderr: "", exitCode: 0 })
      }
    }
    const layer = DockerClientLive.pipe(Layer.provide(Layer.succeed(CommandRunner)(runner)))

    return Effect.gen(function* () {
      const docker = yield* DockerClient
      const containers = yield* docker.listContainers
      assert.strictEqual(containers.length, 1)
      assert.strictEqual(containers[0]?.name, "db")
      assert.strictEqual(containers[0]?.ports[0]?.publicPort, "5432")
    }).pipe(Effect.provide(layer))
  })
})

describe("database discovery", () => {
  it.effect("keeps a supported container even if inspect metadata is incomplete", () => {
    const runner: CommandRunnerService = {
      run: (_command, args) => {
        if (args[0] === "ps") {
          return Effect.succeed({
            stdout: '{"ID":"abc123","Image":"redis:7","Names":"cache","Status":"Up","Ports":"","Labels":""}\n',
            stderr: "",
            exitCode: 0
          })
        }
        return Effect.fail(new CommandError({
          command: "docker inspect",
          message: "inspect failed",
          exitCode: 1,
          stderr: "inspect failed"
        }))
      }
    }
    const dockerLayer = DockerClientLive.pipe(Layer.provide(Layer.succeed(CommandRunner)(runner)))
    const layer = DatabaseDiscoveryLive.pipe(Layer.provide(dockerLayer))

    return Effect.gen(function* () {
      const discovery = yield* DatabaseDiscovery
      const databases = yield* discovery.list
      assert.strictEqual(databases.length, 1)
      assert.strictEqual(databases[0]?.kind, "redis")
      assert.strictEqual(databases[0]?.name, "cache")
    }).pipe(Effect.provide(layer))
  })
})
