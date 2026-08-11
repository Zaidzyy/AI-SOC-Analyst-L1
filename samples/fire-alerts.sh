#!/usr/bin/env bash
# AI SOC Analyst L1 — demo runner (Linux / macOS)
#
# Fires the sample Wazuh alerts at your webhook, pausing between them so each
# run finishes before the next arrives.
#
#   export SOC_TOKEN="your-webhook-token"
#   ./samples/fire-alerts.sh
#
#   # optional
#   export SOC_URL="http://localhost:5678/webhook/reportlvl12"
#   WAIT=90 ./samples/fire-alerts.sh
#
# Each alert's agent name gets a random suffix, so repeated runs are never
# swallowed by the 15-minute deduplication window.

set -euo pipefail

URL="${SOC_URL:-http://localhost:5678/webhook/reportlvl12}"
WAIT="${WAIT:-75}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/test-alerts"

if [ -z "${SOC_TOKEN:-}" ]; then
  cat <<'MSG'
SOC_TOKEN is not set.

The webhook is authenticated. You need the same token in two places:
  1. the Header Auth credential on the webhook node in n8n
  2. this environment variable

If you have not created one yet, generate a token:

    openssl rand -hex 32

Then in n8n: Credentials -> Add credential -> Header Auth
    Name  = X-SOC-Token      (this is the HTTP header name, not a label)
    Value = the token you just generated
  ...and select it on the webhook node's Authentication field.

Finally, export it here:

    export SOC_TOKEN="your-token"

Full walkthrough: SETUP-GUIDE.md section 4a
MSG
  exit 1
fi

command -v jq >/dev/null || { echo "jq is required: apt install jq"; exit 1; }

fire() {
  local file="$1" label="$2" expect="$3"
  local path="$SRC/$file"
  [ -f "$path" ] || { echo "  missing: $path"; return; }

  # unique agent name per run so deduplication never suppresses the test
  local tmp; tmp="$(mktemp)"
  jq --arg s "-$RANDOM" '.agent.name = (.agent.name + $s)' "$path" > "$tmp"

  printf '\n>>> %s\n    expect: %s\n' "$label" "$expect"

  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL" \
    -H 'Content-Type: application/json' \
    -H "X-SOC-Token: $SOC_TOKEN" \
    --data @"$tmp")"

  case "$code" in
    200) echo "    200 accepted" ;;
    401|403) echo "    $code token mismatch — n8n credential vs SOC_TOKEN (SETUP-GUIDE §4a)"; rm -f "$tmp"; return ;;
    404) echo "    404 workflow inactive, or wrong webhook path"; rm -f "$tmp"; return ;;
    *)   echo "    $code unexpected" ;;
  esac

  rm -f "$tmp"
  sleep "$WAIT"
}

echo "AI SOC Analyst L1 — firing sample alerts at $URL"
echo "waiting ${WAIT}s between alerts so each run completes"

fire ssh-bruteforce.json    "LINUX — SSH brute force"       "CRITICAL, auto-block path, T1110"
fire malware-detection.json "LINUX — crypto-miner file"     "NOT brute force — Resource Hijacking, T1496"
fire suspicious-login.json  "WINDOWS — valid-account logon" "T1078, exercises the Windows branch"

cat <<'EOF'

Done. Check:
  - your notification channel for three reports
  - n8n Executions — anything under ~200ms was deduplicated, not run
  - the dashboard, if Supabase is wired up
EOF
