import { Effect } from "effect"
import { CommandRunner } from "../core/command"
import { DatabaseDiscovery } from "../core/discovery"
import { DockerClient } from "../core/docker"
import { DatabaseAdapterRegistry } from "../core/explorer"
import type { DatabaseKind } from "../core/model"

export interface DoctorCommandCheck {
  readonly available: boolean
  readonly version?: string
}

export interface DoctorDatabaseCheck {
  readonly id: string
  readonly name: string
  readonly image: string
  readonly kind: DatabaseKind
  readonly nativeClient: string
  readonly ready: boolean
  readonly message: string
}

export interface DoctorReport {
  readonly version: 1
  readonly bun: { readonly ok: true; readonly version: string }
  readonly platform: { readonly ok: boolean; readonly value: string; readonly support: string }
  readonly docker: { readonly ok: boolean; readonly message: string }
  readonly orbstack: DoctorCommandCheck
  readonly bb: DoctorCommandCheck
  readonly databases: ReadonlyArray<DoctorDatabaseCheck>
}

const nativeClientFor = (kind: DatabaseKind): string => {
  switch (kind) {
    case "postgres":
      return "psql"
    case "mysql":
      return "mysql"
    case "redis":
      return "redis-cli"
    case "mongo":
      return "mongosh or mongo"
  }
}

const optionalVersion = Effect.fn("Doctor.optionalVersion")(function* (
  command: string,
  args: ReadonlyArray<string> = ["--version"]
) {
  const runner = yield* CommandRunner
  return yield* runner.run(command, args, { timeoutMs: 5_000 }).pipe(
    Effect.map((result): DoctorCommandCheck => ({
      available: true,
      version: result.stdout.trim() || result.stderr.trim()
    })),
    Effect.catch(() => Effect.succeed<DoctorCommandCheck>({ available: false }))
  )
})

export const runDoctor = Effect.gen(function* () {
  const docker = yield* DockerClient
  const discovery = yield* DatabaseDiscovery
  const registry = yield* DatabaseAdapterRegistry

  const dockerCheck = yield* docker.check.pipe(
    Effect.as({ ok: true, message: "Docker is reachable." }),
    Effect.catch((error) => Effect.succeed({ ok: false, message: error.message }))
  )
  const orbstack = process.platform === "darwin"
    ? yield* optionalVersion("orb", ["version"])
    : { available: false }
  const bb = yield* optionalVersion("bb")
  const databases: Array<DoctorDatabaseCheck> = []

  if (dockerCheck.ok) {
    const detected = yield* discovery.list
    for (const database of detected) {
      const connection = yield* registry.get(database.kind).testConnection(database).pipe(
        Effect.as({ ready: true, message: "Native client connected." }),
        Effect.catch((error) => Effect.succeed({ ready: false, message: error.message }))
      )
      databases.push({
        id: database.id,
        name: database.name,
        image: database.image,
        kind: database.kind,
        nativeClient: nativeClientFor(database.kind),
        ...connection
      })
    }
  }

  return {
    version: 1,
    bun: { ok: true, version: Bun.version },
    platform: process.platform === "win32"
      ? { ok: false, value: process.platform, support: "Unsupported. Use a supported Linux or macOS host; WSL2 is experimental." }
      : { ok: true, value: process.platform, support: "Supported." },
    docker: dockerCheck,
    orbstack,
    bb,
    databases
  } satisfies DoctorReport
})

export const doctorHasFailures = (report: DoctorReport): boolean =>
  !report.platform.ok || !report.docker.ok || report.databases.some((database) => !database.ready)

const commandLine = (label: string, check: DoctorCommandCheck, optional: boolean): string => {
  if (!check.available) {
    return `${optional ? "○" : "✗"} ${label}: not found${optional ? " (optional)" : ""}`
  }
  return `✓ ${label}: ${check.version ?? "available"}`
}

export const renderDoctorReport = (report: DoctorReport): string => {
  const lines = [
    `✓ Bun: ${report.bun.version}`,
    `${report.platform.ok ? "✓" : "✗"} Platform: ${report.platform.value} (${report.platform.support})`,
    `${report.docker.ok ? "✓" : "✗"} Docker: ${report.docker.message}`,
    commandLine("OrbStack", report.orbstack, true),
    commandLine("BB", report.bb, true)
  ]
  if (report.databases.length === 0) {
    lines.push("○ Databases: no supported running containers detected")
  } else {
    for (const database of report.databases) {
      lines.push(
        `${database.ready ? "✓" : "✗"} ${database.name}: ${database.kind}, ${database.image}, ${database.nativeClient} (${database.message})`
      )
    }
  }
  return lines.join("\n")
}
