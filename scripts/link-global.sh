#!/usr/bin/env sh

set -eu

bun link

bun_install_dir="${BUN_INSTALL:-${HOME}/.bun}"
global_bin="${bun_install_dir}/bin"
user_bin="${HOME}/.local/bin"

mkdir -p "$user_bin"
ln -sfn "${global_bin}/dbm" "${user_bin}/dbm"

echo "dbm linked live at ${user_bin}/dbm"
