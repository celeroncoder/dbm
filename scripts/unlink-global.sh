#!/usr/bin/env sh

set -eu

bun_install_dir="${BUN_INSTALL:-${HOME}/.bun}"
user_link="${HOME}/.local/bin/dbm"

if [ -L "$user_link" ]; then
  rm -f "$user_link"
fi

bun unlink

echo "dbm global link removed"
