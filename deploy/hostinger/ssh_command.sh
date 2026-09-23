#!/bin/sh
set -eu

case "${SSH_ORIGINAL_COMMAND:-}" in
  "deploy "*) ;;
  *)
    echo "unsupported deployment command" >&2
    exit 64
    ;;
esac

release_sha=${SSH_ORIGINAL_COMMAND#deploy }
if [ "${#release_sha}" -ne 40 ]; then
  echo "invalid release identifier" >&2
  exit 64
fi

case "$release_sha" in
  *[!0123456789abcdef]*)
    echo "invalid release identifier" >&2
    exit 64
    ;;
esac

exec sudo -n /usr/local/sbin/deploy_s29_bots "$release_sha"
