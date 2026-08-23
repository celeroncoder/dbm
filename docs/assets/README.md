# Media assets

- `dbm-logo.svg` is the project wordmark derived from the BB plugin database icon.
- `github-social-preview.svg` is the editable 1280 by 640 social-preview source.
- `github-social-preview.png` is the rendered image for the GitHub repository setting.

Release screenshots and terminal recordings in this directory must come from
the real CLI or BB plugin. Keep each tracked asset below 5 MiB.

`dbm-cli.gif` is recorded from `scripts/record-demo.ts` against a disposable
Postgres container named `dbm-verify-recording-postgres`. The script calls the
real Docker discovery and Postgres adapter services and uses the production
terminal renderers.
