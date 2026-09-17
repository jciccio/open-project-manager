#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Run using npx tsx from repo directory
npx tsx "${SCRIPT_DIR}/install-skills.ts" "$@"
