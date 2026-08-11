# Samples — see the output, then run it yourself

```
samples/
├── sample-report.html     open in a browser — real output, no install needed
├── test-alerts/           3 realistic Wazuh alerts
│   ├── ssh-bruteforce.json
│   ├── malware-detection.json
│   └── suspicious-login.json
├── fire-alerts.ps1        demo runner — Windows
└── fire-alerts.sh         demo runner — Linux / macOS
```

**Want to see what it produces before installing anything?** Open [`sample-report.html`](sample-report.html) in any browser.

---

## Demo runner

Fires all three sample alerts at your webhook and waits between them so each run completes before the next arrives.

### 1. Generate a webhook token

The webhook is authenticated — an unauthenticated SOC webhook is a remote trigger for privileged actions. The **same** token has to exist in two places.

```bash
# Linux / macOS
openssl rand -hex 32
```

```powershell
# Windows
-join (1..64 | % { '0123456789abcdef'[(Get-Random -Max 16)] })
```

### 2. Create the credential in n8n

**Credentials → Add credential → Header Auth**

| Field | Value |
|---|---|
| **Name** | `X-SOC-Token` |
| **Value** | the token you generated |

> The **Name** field is the HTTP *header name* that gets sent on the request — not a display label. This is the single most common setup mistake.

Then open `🔔 Alert Webhook - Level 12+` → **Authentication: Header Auth** → select the credential.

### 3. Run it

```powershell
# Windows
$env:SOC_TOKEN = "your-token"
.\samples\fire-alerts.ps1
```

```bash
# Linux / macOS  (needs jq)
export SOC_TOKEN="your-token"
chmod +x samples/fire-alerts.sh
./samples/fire-alerts.sh
```

Options:

| Variable | Default |
|---|---|
| `SOC_TOKEN` | *required* |
| `SOC_URL` | `http://localhost:5678/webhook/reportlvl12` |
| `WAIT` / `-Wait` | `75` seconds between alerts |

---

## What each alert exercises

| Alert | Path it takes | Expected result |
|---|---|---|
| `ssh-bruteforce.json` | Linux branch, high-reputation source IP | `CRITICAL`, `T1110`, auto-block path evaluated |
| `malware-detection.json` | Linux branch, VirusTotal file detection | **Not** brute force — Resource Hijacking, `T1496`. This one catches a model that pattern-matches instead of reading the alert |
| `suspicious-login.json` | **Windows** branch, valid credentials | `T1078`. Confirms report generation works outside Linux |

The runner appends a random suffix to each agent name, so repeated runs are never suppressed by the 15-minute deduplication window.

---

## Reading the result

| Where | What to look for |
|---|---|
| Your notification channel | three incident reports |
| **n8n → Executions** | anything under ~200 ms was **deduplicated**, not executed |
| The dashboard | three new rows, if Supabase is configured |

**If nothing arrives:**

| Code | Meaning |
|---|---|
| `200` | accepted |
| `401` / `403` | token mismatch — the n8n credential and `SOC_TOKEN` differ |
| `404` | workflow not active, or wrong webhook path |
| timeout | n8n unreachable from where you're running the script |

The runner prints the status code for each alert, so you get the answer immediately rather than waiting for a report that was never going to come.

Full walkthrough in [`SETUP-GUIDE.md`](../SETUP-GUIDE.md) §4a.
