# Docker safety

Docker daemon access is root-equivalent on typical developer machines. dbm is
for trusted local development, not production or remote database management.

## Discovered containers

The terminal reads running containers, inspects metadata, and executes the
image's own database client inside the selected container. It does not create,
stop, or delete discovered containers.

## Managed containers

The BB plugin creates containers with:

- `com.dbm.managed=true`
- `com.dbm.kind=<kind>`
- `com.dbm.alias=<normalized-alias>`
- `com.dbm.schema=1`

Managed ports use `127.0.0.1::<private-port>`, so Docker allocates an available
localhost-only port. Built-in usernames and passwords are for disposable local
data only. dbm does not create named volumes. Official images may attach
anonymous volumes declared by the image; exact container deletion includes
Docker's `--volumes` flag so those anonymous volumes are removed with it.

Aliases are normalized to lowercase letters, numbers, and hyphens before they
reach Docker. Container references must match Docker's safe name or ID shape.
Every reference is passed as one argument after `--`, never through a shell.

## Deletion

`DatabaseManager.remove` lists containers with the managed-label filter,
inspects the selected entry again, requires the exact managed label, and then
deletes its exact validated container ID and attached anonymous volumes. It
refuses an unlabelled container even if stale or malicious list metadata
claimed ownership.

## Verification cleanup

Live verification records exact IDs as containers are created. Its `finally`
block removes only those IDs and their anonymous volumes, then fails if any
container remains. Do not replace this with cleanup by a broad name, label,
image, volume, or project pattern.

## Socket permissions

dbm first calls Docker as the current user. A Docker socket permission error
is retried as `sudo -n docker`, which never opens an interactive password
prompt. If that fails, fix Docker group or socket access, or use the normal
OrbStack workflow. Do not grant this access on an untrusted machine.
