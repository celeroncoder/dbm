# dbm

`dbm` is an interactive terminal explorer for database containers running in the local Docker engine. It detects Postgres, MySQL/MariaDB, Redis/Valkey, and MongoDB containers without asking for a connection string, then executes the native database client inside the selected container.

## Run

```sh
bun install
bun run dev
```

For a global command that stays linked to this checkout and picks up source changes immediately:

```sh
bun run link:global
dbm
```

Remove the link with `bun run unlink:global`.

On startup, `dbm` checks the Docker daemon. If it is unavailable, the CLI asks whether it should run `orb start`, waits for the engine to become ready, and scans again. This works with OrbStack; if OrbStack is not installed, the command error is shown directly.

The database clients are expected inside the database image:

- Postgres: `psql`
- MySQL/MariaDB: `mysql`
- Redis/Valkey: `redis-cli`
- MongoDB: `mongosh` or the legacy `mongo` shell

## Core design

The CLI is only one outlet over a reusable Effect service graph:

- `CommandRunner` — injectable process execution boundary
- `DockerClient` — daemon readiness, OrbStack startup, container listing, inspection, and `docker exec`
- `DatabaseDiscovery` — database image/service detection and environment metadata extraction
- `DatabaseAdapterRegistry` — pluggable Postgres, MySQL, Redis, and MongoDB adapters
- `DatabaseExplorer` — query, schemas, table/key/collection listing, descriptions, and bounded browsing

Other outlets can provide their own terminal, HTTP, TUI, or editor UI layer while reusing `src/core`.

The Docker service retries socket permission failures with non-interactive
`sudo -n docker` when permitted by the local machine. Otherwise, grant the
running user Docker socket access; dbm does not prompt for a sudo password.

## BB plugin outlet

`bb-plugin-dbm/` packages the same core for BB. It adds a `bb dbm` command and
Databases panel for creating and managing safe localhost-only Postgres, MySQL,
Redis, and MongoDB instances:

```sh
cd bb-plugin-dbm
npm install --install-links
npm run check
npm run test
npm run build
bb plugin install . --yes
bb plugin reload dbm
bb dbm images
bb dbm docker start
bb dbm create postgres local-postgres
bb dbm connect local-postgres
```

Managed instances can be listed, started, restarted, paused, unpaused, stopped,
logged, queried, inspected, or deleted. The plugin uses explicit
`com.dbm.managed=true` labels and exact container ids for safe cleanup; it never
removes unrelated Docker resources. The Databases selector and `bb dbm images`
show each exact image tag/version and whether that image is installed locally;
missing images are pulled by Docker when an instance is created. Its
agent-facing guidance lives in
`bb-plugin-dbm/skills/dbm-management/SKILL.md`.

Agent-facing CLI guidance lives in [.agents/skills/dbm-cli/SKILL.md](.agents/skills/dbm-cli/SKILL.md). Update it whenever CLI commands, supported adapters, or verification steps change.

## Development

```sh
bun run check
bun run test
```

The repository also follows the local Effect source setup used by the project guidance. `prepare` clones `https://github.com/Effect-TS/effect` into `.repos/effect` when it is missing; that checkout is ignored by Git.
