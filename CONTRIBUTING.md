# Contributing

## Set up the repository

Use a supported macOS or Linux machine with Bun 1.4 or newer and a working
Docker Engine or OrbStack installation.

```sh
git clone https://github.com/celeroncoder/dbm.git
cd dbm
bun install --frozen-lockfile
bun run check
bun run test
```

The `prepare` script clones Effect into the ignored `.repos/effect` directory
when it is missing. This checkout is for local API research. Do not commit it.

Set up the BB plugin separately with Node 22, npm, and BB 0.39 or newer:

```sh
cd bb-plugin-dbm
npm ci --install-links
bb plugin types --check
npm run check
npm run test
npm run build
```

## Code map

- `src/core` contains reusable Effect services, Docker boundaries, discovery,
  adapters, exploration, and managed-instance behavior.
- `src/cli` contains the Bun terminal outlet.
- `bb-plugin-dbm` contains the BB server, RPC/CLI wiring, Databases panel, and
  packaged agent skill.
- `test` contains core tests with injected command runners.
- `scripts/verify-plugin.ts` runs the live four-adapter Docker verification.

Keep process execution behind `CommandRunner`. Keep Docker behavior behind
`DockerClient`. Adapters should translate one database's native client into
the shared `DatabaseAdapter` contract without moving terminal or BB UI logic
into the core.

## Effect style

- Define dependencies with `Context.Service` and construct them with `Layer`.
- Use schema-backed tagged errors for typed boundary failures.
- Use `Effect.fn` for reusable business operations.
- Provide layers at entry points or test boundaries.
- Keep expected failures in the typed error channel.
- Do not use `any`, unsafe type assertions, namespaces, or thrown exceptions
  for normal control flow.

Check the local Effect guides and `.repos/effect` source before using an API
that is unfamiliar or version-sensitive.

## Tests and Docker cleanup

Run all normal checks before opening a pull request:

```sh
bun run check:repository
bun run check
bun run test
cd bb-plugin-dbm
npm run check
npm run test
npm run build
```

For live verification, use only disposable aliases with the
`dbm-verify-` prefix, create no named volumes, record every exact container ID,
and remove only those IDs plus their attached anonymous volumes in `finally`.
Never use a broad cleanup pattern.

```sh
bun run verify:docker
docker ps -a --filter name=dbm-verify-
```

The verifier must cover discovery, query, schema or keyspace listing, table,
key, or collection inspection, browsing, logs, lifecycle actions, and exact
cleanup for all four adapters.

## Global development command

Link the current checkout when testing unpublished CLI changes:

```sh
bun run link:global
dbm
bun run unlink:global
```

This is a development path. Do not use a release artifact when the goal is to
exercise local source changes.

## Keep public behavior aligned

Update `README.md` and `.agents/skills/dbm-cli/SKILL.md` when CLI commands,
supported images, native clients, Docker permissions, or verification steps
change. Plugin behavior also requires updates to `bb-plugin-dbm/README.md` and
`bb-plugin-dbm/skills/dbm-management/SKILL.md`.

UI changes need a screenshot. Docker changes need the exact resources created
and cleanup proof in the pull request.

The project currently has one maintainer, so there is no `CODEOWNERS` file.
Add one when review ownership can be divided meaningfully. Signed commits are
not required for the first release; CI and protected-branch checks provide the
current merge gate.
