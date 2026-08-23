#!/usr/bin/env bash

set -euo pipefail

max_bytes=$((5 * 1024 * 1024))
failed=0

while IFS= read -r path; do
  case "$path" in
    .env|*/.env|.env.*|*/.env.*)
      if [[ "$path" != ".env.example" && "$path" != */.env.example ]]; then
        printf 'refusing tracked environment file: %s\n' "$path" >&2
        failed=1
      fi
      ;;
    *.pem|*.key|*.p12|*.pfx|.npmrc|*/.npmrc|.netrc|*/.netrc|.pypirc|*/.pypirc|credentials.json|*/credentials.json|service-account*.json|*/service-account*.json)
      printf 'refusing tracked credential or key file: %s\n' "$path" >&2
      failed=1
      ;;
    *.db|*.db-journal|*.sqlite|*.sqlite-journal|*.sqlite3|*.sqlite3-journal)
      printf 'refusing tracked local database file: %s\n' "$path" >&2
      failed=1
      ;;
    .bb/plugins.json)
      ;;
    node_modules/*|*/node_modules/*|dist/*|*/dist/*|coverage/*|*/coverage/*|.bb/*)
      printf 'refusing tracked generated or machine-local path: %s\n' "$path" >&2
      failed=1
      ;;
  esac

  if [[ -f "$path" ]]; then
    size=$(wc -c < "$path")
    if (( size > max_bytes )); then
      printf 'refusing tracked file larger than 5 MiB: %s (%s bytes)\n' "$path" "$size" >&2
      failed=1
    fi
  fi
done < <(git ls-files --cached --others --exclude-standard)

if (( failed != 0 )); then
  exit 1
fi

printf 'tracked repository files pass the safety policy\n'
