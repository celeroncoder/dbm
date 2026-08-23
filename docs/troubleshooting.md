# Troubleshooting

## Docker is not running

Start Docker Desktop, Docker Engine, or OrbStack, then run `docker info`.
The terminal can offer `orb start`; the BB outlet exposes
`bb dbm docker start`. If `orb` is not installed, start your Docker engine
directly.

## Docker socket permission denied

dbm retries a recognized socket permission error with `sudo -n docker`. It
never prompts for a password. If the retry fails, add your user to the Docker
group according to your engine's documentation, correct the socket ownership,
or run through an account that already has Docker access. Docker access can
control the host.

## No databases are detected

Check `docker ps`. The container must be running and its image, name, or labels
must identify Postgres, MySQL or MariaDB, Redis or Valkey, or MongoDB. Custom
images may need an identifying service name or label.

## Native client is missing

dbm executes `psql`, `mysql`, `redis-cli`, or `mongosh` inside the selected
container. Older MongoDB images may use `mongo`. Use an image that includes its
native client or install the client in that disposable image.

## An image is unsupported

Run `bb dbm images` for the exact managed tags. Discovery can recognize common
variants such as MariaDB, Valkey, PostGIS, and pgvector, but the image still
needs compatible environment conventions and a native client.

## A managed port is unavailable

Managed containers ask Docker for a random localhost-only port. Inspect the
container with `bb dbm connect <alias>` and `docker port <container>`. Remove a
failed dbm-managed instance by its alias and retry. Do not bind a fixed public
port as a workaround.

## A managed database does not become ready

Run `bb dbm logs <alias> 200`. Image pulls, slow startup, invalid host
resources, or a native readiness command failure can delay creation. A failed
create removes the exact container ID it started.

## OrbStack is not installed

Ignore the OrbStack startup command and start Docker through your installed
engine. dbm supports Docker-compatible engines; OrbStack is an optional macOS
startup path.

## BB plugin does not load

Run:

```sh
bb plugin list
bb plugin logs dbm -n 200
bb plugin reload dbm
```

Confirm BB is at least 0.39 and the plugin SDK is compatible with 0.4.8.
