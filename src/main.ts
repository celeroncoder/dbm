#!/usr/bin/env bun
import { Effect, Layer } from "effect"
import { DatabaseDiscoveryLive } from "../bb-plugin-dbm/core/src/discovery"
import { DockerClientLive } from "../bb-plugin-dbm/core/src/docker"
import { DatabaseAdapterRegistryLive } from "../bb-plugin-dbm/core/src/adapters"
import { DatabaseExplorerLive } from "../bb-plugin-dbm/core/src/explorer"
import { CommandRunnerLive } from "../bb-plugin-dbm/core/src/command-bun"
import { runCli } from "./cli/app"
import { TerminalLive } from "./cli/terminal"
import { completionFor, isCompletionShell } from "./cli/completions"
import { doctorHasFailures, renderDoctorReport, runDoctor } from "./cli/doctor"
import { dbmVersion } from "./version"

const usage = `dbm ${dbmVersion}

Explore supported database containers running in the local Docker engine.

Usage:
  dbm
  dbm doctor [--json]
  dbm completions <bash|zsh|fish>
  dbm --help
  dbm --version

Running dbm without arguments opens the interactive container explorer.
`

const DockerLive = DockerClientLive.pipe(Layer.provide(CommandRunnerLive))
const DiscoveryLive = DatabaseDiscoveryLive.pipe(Layer.provide(DockerLive))
const AdaptersLive = DatabaseAdapterRegistryLive.pipe(Layer.provide(DockerLive))
const ExplorerLive = DatabaseExplorerLive.pipe(Layer.provide(AdaptersLive))

export const AppLive = Layer.mergeAll(
  TerminalLive,
  CommandRunnerLive,
  DockerLive,
  DiscoveryLive,
  AdaptersLive,
  ExplorerLive
)

const args = Bun.argv.slice(2)

const handleFailure = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`dbm stopped: ${message}`)
  process.exitCode = 1
}

if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
  console.log(usage)
} else if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
  console.log(dbmVersion)
} else if ((args.length === 1 || args.length === 2) && args[0] === "doctor" && (args.length === 1 || args[1] === "--json")) {
  void Effect.runPromise(runDoctor.pipe(Effect.provide(AppLive))).then((report) => {
    console.log(args[1] === "--json" ? JSON.stringify(report, null, 2) : renderDoctorReport(report))
    if (doctorHasFailures(report)) {
      process.exitCode = 1
    }
  }).catch(handleFailure)
} else if (args.length === 2 && args[0] === "completions" && isCompletionShell(args[1])) {
  console.log(completionFor(args[1]))
} else if (args.length > 0) {
  console.error(`Unknown argument: ${args.join(" ")}\n\n${usage}`)
  process.exitCode = 2
} else {
  void Effect.runPromise(runCli().pipe(Effect.provide(AppLive))).catch(handleFailure)
}
