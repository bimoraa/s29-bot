#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 || ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
  echo "expected one lowercase 40-character commit SHA" >&2
  exit 64
fi

release_sha=$1
root_dir=/srv/s29-bots
shared_dir="$root_dir/shared"
releases_dir="$root_dir/releases"
release_dir="$releases_dir/$release_sha"
current_link="$root_dir/current"

if [[ ! -s "$shared_dir/.env" ]]; then
  echo "production environment file is missing" >&2
  exit 1
fi

install -d -o root -g root -m 0755 "$root_dir" "$shared_dir" "$releases_dir"
archive_path=$(mktemp /var/tmp/s29-bots-deploy.XXXXXX.tar.gz)
chmod 0600 "$archive_path"
cleanup_archive() {
  python3 - "$archive_path" <<'PY'
from pathlib import Path
import sys

Path(sys.argv[1]).unlink(missing_ok=True)
PY
}
trap cleanup_archive EXIT
cat > "$archive_path"

python3 - "$archive_path" <<'PY'
import pathlib
import sys
import tarfile

archive_path = sys.argv[1]
allowed_files = {
    ".dockerignore",
    "Dockerfile",
    "compose.yaml",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
}
required_files = allowed_files - {".dockerignore"}
seen_files = set()
seen_source = False

try:
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive.getmembers():
            path = pathlib.PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError("archive contains an unsafe path")
            if member.isdir():
                if member.name != "src" and not member.name.startswith("src/"):
                    raise ValueError("archive contains an unexpected directory")
                continue
            if not member.isfile():
                raise ValueError("archive contains a non-regular file")
            if member.name not in allowed_files and not member.name.startswith("src/"):
                raise ValueError("archive contains an unexpected file")
            seen_files.add(member.name)
            seen_source = seen_source or member.name.startswith("src/")

    if not required_files.issubset(seen_files) or not seen_source:
        raise ValueError("archive is missing required application files")
except (OSError, tarfile.TarError, ValueError) as error:
    print(f"deployment archive rejected: {error}", file=sys.stderr)
    raise SystemExit(1)
PY

previous_release=$(readlink -f "$current_link" 2>/dev/null || true)
if [[ "$previous_release" != "$release_dir" ]]; then
  if [[ -e "$release_dir" ]]; then
    if [[ ! -d "$release_dir" || ! -f "$release_dir/compose.yaml" || ! -L "$release_dir/.env" ]]; then
      echo "an incomplete release already exists for this commit" >&2
      exit 1
    fi
    if [[ "$(readlink "$release_dir/.env")" != "$shared_dir/.env" ]]; then
      echo "release environment link points outside the shared config" >&2
      exit 1
    fi
  else
    install -d -o root -g root -m 0755 "$release_dir"
    tar --extract --gzip --file="$archive_path" --directory="$release_dir" --no-same-owner --no-same-permissions
    ln -s "$shared_dir/.env" "$release_dir/.env"
  fi
fi

compose() {
  local image_tag=$1
  local project_dir=$2
  shift 2
  S29_IMAGE_TAG="$image_tag" docker compose \
    --project-name s29-bots \
    --project-directory "$project_dir" \
    --file "$project_dir/compose.yaml" \
    "$@"
}

wait_until_ready() {
  local attempt
  for attempt in {1..40}; do
    if curl --fail --silent --max-time 2 http://127.0.0.1:3000/readyz >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  return 1
}

rollback() {
  if [[ -z "$previous_release" || "$previous_release" == "$release_dir" ]]; then
    echo "deployment did not become ready; no previous release is available" >&2
    return 1
  fi

  previous_sha=${previous_release##*/}
  echo "deployment did not become ready; restoring the previous release" >&2
  if ! compose "$previous_sha" "$previous_release" up -d; then
    echo "previous release could not be restarted" >&2
    return 1
  fi
  if ! wait_until_ready; then
    echo "previous release did not become ready after rollback" >&2
    return 1
  fi
}

if ! compose "$release_sha" "$release_dir" config --quiet; then
  echo "production Compose configuration is invalid" >&2
  exit 1
fi

if ! compose "$release_sha" "$release_dir" build bot; then
  rollback || true
  exit 1
fi

if ! compose "$release_sha" "$release_dir" up -d; then
  rollback || true
  exit 1
fi

if ! wait_until_ready; then
  rollback || true
  exit 1
fi

current_temp="$root_dir/.current-$release_sha"
ln -sfn "$release_dir" "$current_temp"
mv -Tf "$current_temp" "$current_link"

echo "deployed s29-bots $release_sha"
