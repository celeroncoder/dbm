import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { readFile } from "node:fs/promises"
import { CommandRunner, type CommandRunnerService } from "../src/core/command"
import { CommandError } from "../src/core/errors"
import { DatabaseDiscovery, DatabaseDiscoveryLive, detectDatabaseKind } from "../src/core/discovery"
import { DockerClient, DockerClientLive, isSafeContainerReference } from "../src/core/docker"
import { DatabaseManager, DatabaseManagerLive, normalizeDatabaseAlias } from "../src/core/manager"
import { jsonValueToQueryResult } from "../src/core/adapters/mongo"
import { parseCsv, tokenizeCommand } from "../src/core/result"
import { dbmVersion } from "../src/version"
import { completionFor, isCompletionShell } from "../src/cli/completions"
import { doctorHasFailures, renderDoctorReport } from "../src/cli/doctor"
import type { DoctorReport } from "../src/cli/doctor"

describe("release metadata", () => {
  it("keeps the CLI version aligned with the package", async () => {
    const metadata: unknown = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
    const pluginMetadata: unknown = JSON.parse(await readFile(new URL("../bb-plugin-dbm/package.json", import.meta.url), "utf8"))
    assert.isTrue(typeof metadata === "object" && metadata !== null && "version" in metadata)
    assert.isTrue(typeof pluginMetadata === "object" && pluginMetadata !== null && "version" in pluginMetadata)
    if (typeof metadata === "object" && metadata !== null && "version" in metadata) {
      assert.strictEqual(metadata.version, dbmVersion)
    }
    if (typeof pluginMetadata === "object" && pluginMetadata !== null && "version" in pluginMetadata) {
      assert.strictEqual(pluginMetadata.version, dbmVersion)
    }
  })
})

describe("non-interactive CLI helpers", () => {
  it("renders completions for supported shells", () => {
    assert.isTrue(isCompletionShell("bash"))
    assert.isTrue(isCompletionShell("zsh"))
    assert.isTrue(isCompletionShell("fish"))
    assert.isFalse(isCompletionShell("powershell"))
    assert.include(completionFor("bash"), "complete -F _dbm_complete dbm")
    assert.include(completionFor("zsh"), "#compdef dbm")
    assert.include(completionFor("fish"), "complete -c dbm")
  })

  it("marks a failed native-client check as unhealthy", () => {
    const report: DoctorReport = {
      version: 1,
      bun: { ok: true, version: "1.4.0" },
      platform: { ok: true, value: "linux", support: "Supported." },
      docker: { ok: true, message: "Docker is reachable." },
      orbstack: { available: false },
      bb: { available: true, version: "0.39.0" },
      databases: [{
        id: "abc123",
        name: "local-postgres",
        image: "postgres:16-alpine",
        kind: "postgres",
        nativeClient: "psql",
        ready: false,
        message: "psql is unavailable"
      }]
    }
    assert.isTrue(doctorHasFailures(report))
    assert.include(renderDoctorReport(report), "✗ local-postgres")
  })
})

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

  it("accepts only option-safe Docker container references", () => {
    assert.isTrue(isSafeContainerReference("abc123"))
    assert.isTrue(isSafeContainerReference("dbm-managed-postgres-1234"))
    assert.isFalse(isSafeContainerReference("--help"))
    assert.isFalse(isSafeContainerReference("name with spaces"))
    assert.isFalse(isSafeContainerReference("name/with/slashes"))
  })

  describe("destructive command arguments", () => {
    const calls: Array<ReadonlyArray<string>> = []
    const runner: CommandRunnerService = {
      run: (_command, args) => {
        calls.push(args)
        return Effect.succeed({ stdout: "", stderr: "", exitCode: 0 })
      }
    }
    const dockerLayer = DockerClientLive.pipe(Layer.provide(Layer.succeed(CommandRunner)(runner)))

    it.layer(dockerLayer)("uses an option boundary and rejects malicious references", (it) => {
      it.effect("keeps the exact id after the option boundary", () =>
        Effect.gen(function* () {
          const docker = yield* DockerClient
          yield* docker.remove("abc123")
          assert.deepStrictEqual(calls.at(-1), ["rm", "--force", "--volumes", "--", "abc123"])
        })
      )

      it.effect("does not invoke Docker for an unsafe reference", () =>
        Effect.gen(function* () {
          const docker = yield* DockerClient
          const callCount = calls.length
          const error = yield* docker.remove("--help").pipe(Effect.flip)
          assert.include(error.message, "unsafe container reference")
          assert.strictEqual(calls.length, callCount)
        })
      )
    })
  })
})

describe("managed database safety", () => {
  it("normalizes aliases before they reach Docker arguments or labels", () => {
    assert.strictEqual(normalizeDatabaseAlias("  PROD DB; --privileged  ", "postgres", "1234"), "prod-db-privileged")
    assert.strictEqual(normalizeDatabaseAlias("---", "redis", "1234"), "redis-1234")
    assert.strictEqual(normalizeDatabaseAlias("A".repeat(80), "mongo", "1234").length, 48)
  })

  it.effect("waits for readiness when create is composed through flatMap", () => {
    const createRunner: CommandRunnerService = {
      run: (_command, args) => {
        if (args[0] === "run") {
          return Effect.succeed({ stdout: "created123\n", stderr: "", exitCode: 0 })
        }
        if (args[0] === "ps") {
          return Effect.succeed({
            stdout: '{"ID":"created123","Image":"postgres:16-alpine","Names":"dbm-managed-postgres-test","Status":"Up","Ports":"127.0.0.1:54321->5432/tcp","Labels":"com.dbm.managed=true,com.dbm.kind=postgres,com.dbm.alias=test"}\n',
            stderr: "",
            exitCode: 0
          })
        }
        if (args[0] === "inspect" && args[2] === "{{.Id}}") {
          return Effect.succeed({ stdout: "created123\n", stderr: "", exitCode: 0 })
        }
        if (args[0] === "inspect" && args[2] === "{{.Name}}") {
          return Effect.succeed({ stdout: "/dbm-managed-postgres-test\n", stderr: "", exitCode: 0 })
        }
        if (args[0] === "inspect" && args[2] === "{{.Config.Image}}") {
          return Effect.succeed({ stdout: "postgres:16-alpine\n", stderr: "", exitCode: 0 })
        }
        if (args[0] === "inspect" && args[2] === "{{json .Config.Env}}") {
          return Effect.succeed({
            stdout: '["POSTGRES_DB=dbm","POSTGRES_USER=dbm","POSTGRES_PASSWORD=dbm"]\n',
            stderr: "",
            exitCode: 0
          })
        }
        if (args[0] === "inspect" && args[2] === "{{json .Config.Labels}}") {
          return Effect.succeed({
            stdout: '{"com.dbm.managed":"true","com.dbm.kind":"postgres","com.dbm.alias":"test"}\n',
            stderr: "",
            exitCode: 0
          })
        }
        return Effect.succeed({ stdout: "", stderr: "", exitCode: 0 })
      }
    }
    const createDockerLayer = DockerClientLive.pipe(Layer.provide(Layer.succeed(CommandRunner)(createRunner)))
    const createManagerLayer = DatabaseManagerLive.pipe(Layer.provide(createDockerLayer))

    return Effect.gen(function* () {
      const manager = yield* DatabaseManager
      const created = yield* manager.create({ kind: "postgres", alias: "test" })
      assert.strictEqual(created.id, "created123")
      assert.strictEqual(created.connection?.port, 54321)
    }).pipe(Effect.provide(createManagerLayer))
  })

  const calls: Array<ReadonlyArray<string>> = []
  const runner: CommandRunnerService = {
    run: (_command, args) => {
      calls.push(args)
      if (args[0] === "ps") {
        return Effect.succeed({
          stdout: '{"ID":"abc123","Image":"postgres:16","Names":"foreign-db","Status":"Up","Ports":"","Labels":"com.dbm.managed=true,com.dbm.kind=postgres"}\n',
          stderr: "",
          exitCode: 0
        })
      }
      if (args[0] === "inspect" && args[2] === "{{.Id}}") {
        return Effect.succeed({ stdout: "abc123\n", stderr: "", exitCode: 0 })
      }
      if (args[0] === "inspect" && args[2] === "{{.Name}}") {
        return Effect.succeed({ stdout: "/foreign-db\n", stderr: "", exitCode: 0 })
      }
      if (args[0] === "inspect" && args[2] === "{{.Config.Image}}") {
        return Effect.succeed({ stdout: "postgres:16\n", stderr: "", exitCode: 0 })
      }
      if (args[0] === "inspect" && args[2] === "{{json .Config.Env}}") {
        return Effect.succeed({ stdout: "[]\n", stderr: "", exitCode: 0 })
      }
      if (args[0] === "inspect" && args[2] === "{{json .Config.Labels}}") {
        return Effect.succeed({ stdout: "{}\n", stderr: "", exitCode: 0 })
      }
      return Effect.succeed({ stdout: "", stderr: "", exitCode: 0 })
    }
  }
  const dockerLayer = DockerClientLive.pipe(Layer.provide(Layer.succeed(CommandRunner)(runner)))
  const managerLayer = DatabaseManagerLive.pipe(Layer.provide(dockerLayer))

  it.layer(managerLayer)("revalidates ownership from inspect metadata", (it) => {
    it.effect("refuses to delete a container whose managed label is missing", () =>
      Effect.gen(function* () {
        const manager = yield* DatabaseManager
        const error = yield* manager.remove("foreign-db").pipe(Effect.flip)
        assert.include(error.message, "not labelled com.dbm.managed=true")
        assert.isFalse(calls.some((args) => args[0] === "rm"))
      })
    )
  })

  it.effect("fails closed when ownership cannot be freshly inspected", () => {
    const unavailableCalls: Array<ReadonlyArray<string>> = []
    const unavailableRunner: CommandRunnerService = {
      run: (_command, args) => {
        unavailableCalls.push(args)
        if (args[0] === "ps") {
          return Effect.succeed({
            stdout: '{"ID":"abc123","Image":"postgres:16","Names":"managed-db","Status":"Up","Ports":"","Labels":"com.dbm.managed=true,com.dbm.kind=postgres"}\n',
            stderr: "",
            exitCode: 0
          })
        }
        if (args[0] === "info") {
          return Effect.succeed({ stdout: "", stderr: "", exitCode: 0 })
        }
        return Effect.fail(new CommandError({
          command: "docker inspect",
          message: "inspection unavailable",
          exitCode: 1,
          stderr: "inspection unavailable"
        }))
      }
    }
    const unavailableDocker = DockerClientLive.pipe(Layer.provide(Layer.succeed(CommandRunner)(unavailableRunner)))
    const unavailableManager = DatabaseManagerLive.pipe(Layer.provide(unavailableDocker))

    return Effect.gen(function* () {
      const manager = yield* DatabaseManager
      const error = yield* manager.remove("managed-db").pipe(Effect.flip)
      assert.include(error.message, "refusing lifecycle operation")
      assert.isFalse(unavailableCalls.some((args) => args[0] === "rm"))
    }).pipe(Effect.provide(unavailableManager))
  })
})

describe("database discovery", () => {
  it.effect("uses the canonical container id returned by inspection", () => {
    const fullId = "abc1230000000000000000000000000000000000000000000000000000000000"
    const runner: CommandRunnerService = {
      run: (_command, args) => {
        if (args[0] === "ps") {
          return Effect.succeed({
            stdout: '{"ID":"abc123000000","Image":"postgres:16-alpine","Names":"database","Status":"Up","Ports":"","Labels":""}\n',
            stderr: "",
            exitCode: 0
          })
        }
        if (args[0] === "inspect" && args[2] === "{{.Id}}") {
          return Effect.succeed({ stdout: `${fullId}\n`, stderr: "", exitCode: 0 })
        }
        if (args[0] === "inspect" && args[2] === "{{.Name}}") {
          return Effect.succeed({ stdout: "/database\n", stderr: "", exitCode: 0 })
        }
        if (args[0] === "inspect" && args[2] === "{{.Config.Image}}") {
          return Effect.succeed({ stdout: "postgres:16-alpine\n", stderr: "", exitCode: 0 })
        }
        if (args[0] === "inspect" && args[2] === "{{json .Config.Env}}") {
          return Effect.succeed({ stdout: "[]\n", stderr: "", exitCode: 0 })
        }
        return Effect.succeed({ stdout: "{}\n", stderr: "", exitCode: 0 })
      }
    }
    const dockerLayer = DockerClientLive.pipe(Layer.provide(Layer.succeed(CommandRunner)(runner)))
    const layer = DatabaseDiscoveryLive.pipe(Layer.provide(dockerLayer))

    return Effect.gen(function* () {
      const discovery = yield* DatabaseDiscovery
      const databases = yield* discovery.list
      assert.strictEqual(databases[0]?.id, fullId)
    }).pipe(Effect.provide(layer))
  })

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
