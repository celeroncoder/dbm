# Security policy

## Supported versions

dbm is pre-1.0. Security fixes are applied to the latest published `0.1.x`
release and the `main` branch. Older prereleases are not supported.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/celeroncoder/dbm/security/advisories/new).
Do not open a public issue for a suspected vulnerability. Do not include real
credentials, connection strings, private keys, or production data in a report.

Include the affected dbm version or commit, operating system, Docker or
OrbStack version, database image, impact, and a minimal sanitized reproduction.
The maintainer will acknowledge reports when available, validate the impact,
and coordinate a fix and disclosure. This project does not promise a response
or remediation SLA.

## Trust model

Docker daemon access can control the host. Run dbm only on trusted local
development machines. dbm is not a production database manager and does not
connect to remote databases.

The BB plugin creates disposable local containers with generated fixed
development credentials. Ports bind to `127.0.0.1` on random available host
ports. Managed containers carry `com.dbm.managed=true`; lifecycle and deletion
operations resolve a managed entry, revalidate its inspected label, and pass
its exact validated container ID after Docker's option boundary. Exact
deletion also removes anonymous volumes declared by the image. dbm refuses to
mutate containers when fresh ownership inspection fails.

Treat connection output as sensitive even when it only describes a disposable
local database. Delete managed instances after use and never reuse the built-in
credentials outside local development.
