#!/usr/bin/env bash
# Resolve o ficheiro de ambiente a usar (DEV / QA / PROD).
# Preferência: VELOCELY_ENV → branch git → .env.shared legado
resolve_env_file() {
  local root="${1:-.}"
  local env_name="${VELOCELY_ENV:-}"
  if [[ -z "$env_name" ]] && command -v git >/dev/null 2>&1; then
    local branch
    branch="$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    case "$branch" in
      DEV|dev) env_name="dev" ;;
      QA|qa) env_name="qa" ;;
      PROD|prod) env_name="prod" ;;
    esac
  fi
  env_name="$(echo "${env_name:-dev}" | tr '[:upper:]' '[:lower:]')"

  local candidate="$root/.env.${env_name}"
  if [[ -f "$candidate" ]]; then
    echo "$candidate"
    return 0
  fi
  if [[ -f "$root/.env.shared" ]]; then
    echo "$root/.env.shared"
    return 0
  fi
  echo ""
  return 1
}
