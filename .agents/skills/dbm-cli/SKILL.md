---
name: dbm-cli
description: Use when running, verifying, documenting, or extending the dbm terminal database explorer. Covers Bun commands, Docker/OrbStack readiness, supported database adapters, safe disposable-container verification, global linked installation, and keeping the CLI usage guidance current with code changes.
---

# dbm CLI

Use this skill when working in the dbm repository or when a user asks how to run, verify, extend, or maintain its Docker database explorer.

The repository also contains a BB plugin outlet at `bb-plugin-dbm/`; read its
packaged `skills/dbm-management/SKILL.md` for instance-management workflows.

## Run the CLI

Install dependencies and launch the interactive terminal UI:

```sh
bun install
bun run dev
```

The CLI checks Docker before scanning. If the daemon is unavailable, it offers `orb start` and polls until Docker responds. It detects running Postgres, MySQL/MariaDB, Redis/Valkey, and MongoDB containers, then offers:

1. Query
2. Schemas/databases
3. Browse tables, keys, or collections
4. List tables, keys, or collections

Database clients run inside the selected container, so users do not provide connection strings. The database image needs its native client: `psql`, `mysql`, `redis-cli`, `mongosh`, or legacy `mongo`.

The shared Docker service also retries a socket permission failure with
non-interactive `sudo -n docker` when the local machine allows it. If that
fallback is unavailable, grant the user Docker socket access or start the
engine with the normal OrbStack workflow; dbm never prompts for a sudo
password.

## Global development install

Link the checked-out package globally so the command points at the working tree and picks up source changes immediately:

```sh
bun run link:global
dbm
```

Use `bun run unlink:global` when the link is no longer needed. Do not publish or install a stale registry version for local development when the goal is to exercise current code.

## Verification workflow

Run the normal checks first:

```sh
bun run check
bun run test
```

For live adapter verification, use disposable names with the `dbm-verify-` prefix, create no volumes, and record the exact container names before starting. Seed only small fixtures, drive the actual CLI, and remove only those exact containers afterward:

```sh
docker rm -f dbm-verify-postgres dbm-verify-mysql dbm-verify-redis dbm-verify-mongo
docker ps -a --filter name=^/dbm-verify-
```

If Docker socket permissions require `sudo -n`, use it consistently for the disposable containers and CLI process. Never delete unrelated containers, volumes, images, or broad name patterns as cleanup. Confirm the verification containers are absent after cleanup. Test at least one query and one browse/inspection flow for each adapter that was started.

## Maintenance contract

The reusable services live under `src/core`; the terminal outlet lives under `src/cli`. Keep adapter behavior in the core so another outlet can reuse it.

The BB outlet reuses the same core through the local `dbm` package dependency.
Its Node command runner is in `src/core/command.ts`; the Bun-specific runner
for the terminal remains in `src/core/command-bun.ts`.
The BB database selector and `bb dbm images` expose the exact supported image
tag/version and whether Docker has each image installed locally.

When changing commands, menu actions, supported images, environment-variable discovery, native-client requirements, or cleanup procedures:

1. Update the implementation and tests.
2. Update `README.md`.
3. Update this skill file with the new user-facing workflow.
4. Update `AGENTS.md` if the project-wide handoff or verification contract changes.
5. Run `bun run check && bun run test` before handing off.

Keep this skill aligned with the CLI after every completed implementation change so a new agent can operate the current code without rediscovering its workflow.

For changes that affect the BB plugin outlet, also update
`bb-plugin-dbm/README.md` and `bb-plugin-dbm/skills/dbm-management/SKILL.md`,
then run `cd bb-plugin-dbm && npm run check && npm run test && npm run build`.
