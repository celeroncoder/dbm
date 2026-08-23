#!/usr/bin/env bun
import { Effect, Layer } from "effect"
import { DatabaseDiscoveryLive } from "./core/discovery"
import { DockerClientLive } from "./core/docker"
import { DatabaseAdapterRegistryLive } from "./core/adapters"
import { DatabaseExplorerLive } from "./core/explorer"
import { CommandRunnerLive } from "./core/command-bun"
import { runCli } from "./cli/app"
import { TerminalLive } from "./cli/terminal"

const DockerLive = DockerClientLive.pipe(Layer.provide(CommandRunnerLive))
const DiscoveryLive = DatabaseDiscoveryLive.pipe(Layer.provide(DockerLive))
const AdaptersLive = DatabaseAdapterRegistryLive.pipe(Layer.provide(DockerLive))
const ExplorerLive = DatabaseExplorerLive.pipe(Layer.provide(AdaptersLive))

export const AppLive = Layer.mergeAll(
  TerminalLive,
  DockerLive,
  DiscoveryLive,
  AdaptersLive,
  ExplorerLive
)

void Effect.runPromise(runCli().pipe(Effect.provide(AppLive))).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`dbm stopped: ${message}`)
  process.exitCode = 1
})
