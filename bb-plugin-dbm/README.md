# dbm Databases BB plugin

The `bb-plugin-dbm` package is the BB outlet for the dbm reusable Effect core.
It creates and manages local Postgres, MySQL, Redis, and MongoDB containers,
then exposes generated connection details, logs, lifecycle controls, and the
existing query/schema/table explorer through BB RPC, CLI, and a Databases panel.

## Development

```sh
npm install --install-links
bb plugin types --check
npm run check
npm run test
npm run build
```

The `dbm` file dependency uses `--install-links` so the plugin compiles the
same core source with one Effect runtime. The root CLI remains Bun-based; the
plugin uses the Node command runner because BB server plugins run under Node.

## Install locally

```sh
bb plugin install . --yes
bb plugin reload dbm
bb dbm list
bb dbm images
```

The plugin also registers a navigation panel at the Databases route. It owns
only containers labelled `com.dbm.managed=true`; deleting an instance removes
only the exact managed container.

The Databases selector shows the exact supported image tag/version and whether
Docker already has that image locally. `bb dbm images` exposes the same data to
agents and scripts; Docker pulls a missing image when creating an instance.

If the BB server cannot read the Docker socket directly, the shared core tries
`sudo -n docker` without prompting. Configure Docker socket access when that
fallback is not available.

Read the packaged [dbm-management skill](skills/dbm-management/SKILL.md) for
the full agent workflow and cleanup contract.

## Install a tagged release

```sh
bb plugin install git:https://github.com/celeroncoder/dbm.git@0.1.0 --plugin dbm --yes
bb plugin list
bb dbm images
```

Tagged installs use the root `.bb/plugins.json` collection manifest and keep
the plugin aligned with the CLI and reusable core at the same version.
