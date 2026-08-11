# AI SOC Analyst L1 — Setup Guide (Multi-VM SSH Edition)

An n8n workflow that turns **Wazuh** alerts into AI-triaged incident reports, collects live host logs **over SSH**, enriches with threat intel, and can auto-block malicious IPs with `ufw` — all driven from one configuration node.

> **Which edition is this?** This is the **SSH / multi-VM** edition. It logs into each monitored host over SSH to pull recent logs and (optionally) to block IPs with `ufw deny`. If you instead want the API-only edition that queries the Wazuh Indexer/Manager REST APIs and uses Wazuh active-response (with a dry-run safety toggle), use the *"AI SOC Analyst L1 — For Wazuh SIEM"* package instead.

**Flow:**
Wazuh alert → webhook → sanitize → dedup → detect OS → enrich (VirusTotal + AbuseIPDB) → **SSH into the alerting host and pull logs** → AI log summary → AI incident report → notify (**one or more of** Discord/Slack/Telegram/Email, in parallel) → optional case (TheHive) + audit log (Sheets) → optional auto-block via `ufw` over SSH.

Every setting referenced below is documented in full in **[CONFIGURATION.md](CONFIGURATION.md)**.

---

## 1. Prerequisites

- A running **Wazuh** deployment sending alerts (level ≥ 12).
- **SSH reachability** from your n8n instance to every host you want to pull logs from / block on, plus an SSH user on each.
  - **Linux/macOS hosts:** standard OpenSSH.
  - **Windows hosts:** OpenSSH Server enabled; the workflow runs PowerShell (`Get-WinEvent`) over that SSH session.
- A chat model the AI nodes can reach — self-hosted **Ollama** by default (you choose the model), or a cloud model you wire in (see §6).
- API keys: **VirusTotal** and **AbuseIPDB** (free tiers are fine).
- At least one notification target: **Discord** webhook (default), Slack webhook, Telegram bot, or SMTP.
- For auto-blocking: `ufw` installed on the target hosts and **passwordless `sudo`** for the `ufw` command for your SSH user.

---

## 2. Import

1. In n8n: **Workflows → Import from File** → select `workflow/ai-soc-analyst-l1.json`.
2. Open it. Almost every setting lives in the **⚙️ CONFIGURATION** node. The exceptions are the **two routing Switches** and the **SSH nodes**, which you must map to *your* hosts — see §3.

---

## 3. ⚠️ Map your Wazuh agents to your hosts (do this first)

This edition ships wired for a reference lab. Out of the box it routes five **Linux** agent names to five SSH nodes. You must change these to match your environment.

### 3a. Rename the agent names in the two Switch nodes

Open **`Route to VM by Agent`** (log collection) and **`Route to VM by Agent1`** (IP blocking). Each has five rules comparing the Wazuh **agent name**. Replace the shipped names with your own:

| Shipped agent name | Routes to SSH node | Change to… |
|---|---|---|
| `WDashboard-VM` | `Wazuh Dashboard` / `Wazuh Dashboard1` | your agent name |
| `IRIS-VM` | `IRIS-VM` / `IRIS-VM1` | your agent name |
| `n8n-VM` | `n8n-VM` / `n8n-VM1` | your agent name |
| `wmanager` | `Wazuh manager` / `Wazuh manager1` | your agent name |
| `WIndexer-VM` | `Wazuh indexer` / `Wazuh indexer1` | your agent name |

The agent name must match exactly what Wazuh sends in `agent.name`. If you monitor fewer/more hosts, delete or add rules in **both** Switches and wire the new outputs to SSH nodes.

> An alert whose `agent.name` matches **no** rule is dropped by the Switch: no logs are collected for it. The report is still produced and delivered, but its log section will be empty. If you want a catch-all, add a final rule (or a fallback output) pointing at one SSH node.

### 3b. Point each SSH node at the right host

Every SSH node needs an **SSH credential** (host, port, user, key/password). Set the credential on each:

- **Linux log collectors** (routed from `Route to VM by Agent`): `Wazuh Dashboard`, `IRIS-VM`, `n8n-VM`, `Wazuh manager`, `Wazuh indexer`.
- **Windows / macOS log collectors:** `Execute a command` (Windows) and `Execute a command1` (macOS) — point these at your Windows / macOS host.
- **Block nodes** (routed from `Route to VM by Agent1`): `Wazuh Dashboard1`, `IRIS-VM1`, `n8n-VM1`, `Wazuh manager1`, `Wazuh indexer1`.

All twelve SSH nodes ship with their **Command** already wired — you only need to attach credentials.

---

## 4. Create credentials

Attach these in the n8n UI (**Credentials**), then select them on the matching nodes:

| Credential (type) | Used on | Notes |
|---|---|---|
| **SSH** (one per host, or a shared key) | all 12 SSH nodes (§3b) | host + user + private key (recommended) or password |
| **VirusTotal API** | `VirusTotal IP Check` | predefined VirusTotal credential |
| **HTTP Header Auth** (AbuseIPDB) | `🔍 AbuseIPDB Check` | header name `Key`, value = your AbuseIPDB key |
| **Ollama API** | `Ollama Chat Model`, `Ollama Chat Model1`, `AI: Summarize Logs`, `AI: Summarize Win/Mac Logs` | your Ollama base URL |
| **Discord Webhook** | `Discord`, `Discord1`, `🚨 Error to Discord` | only if Discord is in your channel list |
| **SMTP** | `📧 Email Alert` | only if you send email over SMTP (see §10a) |
| **Gmail OAuth2** | `📧 Gmail Alert` | only if you send email via Gmail instead of SMTP (see §10a) |
| **HTTP Header Auth** (webhook) | `🔔 Alert Webhook - Level 12+` | **required** — see §4a |
| (optional) TheHive Header Auth, Google Sheets OAuth | optional nodes | only if enabled |

> The imported workflow arrives with credential *slots* referencing the packaging environment's names. n8n will show them as unresolved until you select your own on each node.

> Tip: if all your hosts share one SSH key/user, create a single SSH credential and select it on every SSH node.

---

### 4a. ⚠️ Webhook authentication — do not skip this

The webhook is **authenticated**. An unauthenticated SOC webhook is a remote trigger for privileged actions: anyone who learns the URL can POST a fabricated Wazuh alert, and the workflow will SSH into your hosts and — if blocking is enabled — write a firewall rule against an IP of their choosing.

The same secret has to exist in **two** places. If they don't match, every alert is rejected and the workflow looks broken.

**1 — Generate a token**

```bash
openssl rand -hex 32
```

```powershell
# Windows / PowerShell
-join (1..64 | % { '0123456789abcdef'[(Get-Random -Max 16)] })
```

**2 — Create the credential in n8n**

**Credentials → Add credential → Header Auth**

| Field | Value |
|---|---|
| **Name** (this is the HTTP *header name*, not a label) | `X-SOC-Token` |
| **Value** | your token |

Save it as something obvious like `SOC Webhook Token`.

> The most common mistake here: the **Name** field is the header name sent on the request. It is not a display label.

**3 — Attach it to the webhook node**

Open `🔔 Alert Webhook - Level 12+` → **Authentication: Header Auth** → select your credential.

**4 — Send the same header from Wazuh**

Wazuh's `<integration>` block cannot set custom headers, so alerts are posted by a small integration script. On the Wazuh **Manager**:

```bash
sudo nano /var/ossec/integrations/custom-n8n
```

```python
#!/usr/bin/env python3
import sys, json, requests

with open(sys.argv[1]) as f:
    alert = json.load(f)

requests.post(
    "https://YOUR-N8N/webhook/reportlvl12",
    json=alert,
    headers={
        "Content-Type": "application/json",
        "X-SOC-Token": "PASTE_THE_SAME_TOKEN_HERE",
    },
    timeout=10,
)
```

```bash
sudo chmod 750 /var/ossec/integrations/custom-n8n
sudo chown root:wazuh /var/ossec/integrations/custom-n8n
sudo apt install python3-requests -y      # not pip — avoids externally-managed-environment
sudo systemctl restart wazuh-manager
```

The script name **must** match the `<name>` in `ossec.conf` (§7), or Wazuh logs `File not found inside 'integrations'`.

**5 — Verify before going further**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://YOUR-N8N/webhook/reportlvl12 \
  -H "Content-Type: application/json" \
  -H "X-SOC-Token: YOUR_TOKEN" \
  -d '{"test":"ping"}'
```

| Code | Meaning |
|---|---|
| `200` | reachable and the token is accepted |
| `401` / `403` | reachable but **the token doesn't match** — n8n credential ≠ script header |
| `404` | workflow not active, or wrong webhook path |
| timeout | firewall or wrong host — n8n is not reachable from the Wazuh box |

This checks **reachability and the token only**. `{"test":"ping"}` is not a Wazuh
alert, so the run itself stops at the first node — expected, and visible in
**n8n → Executions** as a rejection naming the missing fields. A `200` here means
the header was accepted, not that the pipeline ran.

Run it once **with** the header and once **without**. The version without it must
fail at the webhook. If an unauthenticated POST gets past the webhook, the
credential isn't attached to the node.

To exercise the pipeline itself, use a real alert shape — see **Test C** in §8, or
`samples/fire-alerts.sh`.

---

## 5. Configure (⚙️ CONFIGURATION node)

Everything below lives in the `⚙️ CONFIGURATION` Code node. Full reference: **[CONFIGURATION.md](CONFIGURATION.md)**.

```js
// --- Threat Intelligence ---
VT_MALICIOUS_THRESHOLD: 3,     // VT "malicious" count needed to consider blocking
VT_SUSPICIOUS_THRESHOLD: 2,    // VT "suspicious" count needed to consider blocking
ABUSEIPDB_ENABLED: true,

// --- Auto-Blocking (ufw over SSH) ---
BLOCK_ENABLED: true,           // master toggle
AUTO_BLOCK_MIN_LEVEL: 14,      // Wazuh rule level required to auto-block
WHITELIST_IPS: "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,8.8.8.8,8.8.4.4,1.1.1.1",

// --- Alert Deduplication ---
DEDUP_WINDOW_MINUTES: 15,      // identical alerts within this window are skipped

// --- Notifications (MULTI-CHANNEL) ---
NOTIFICATION_CHANNELS: "discord",   // comma-separated; every channel listed is
                                    // delivered AT THE SAME TIME.
                                    // e.g. "discord,slack,telegram,email"
SLACK_WEBHOOK_URL:  "https://hooks.slack.com/services/YOUR/WEBHOOK/URL",
TELEGRAM_BOT_TOKEN: "YOUR_BOT_TOKEN",
TELEGRAM_CHAT_ID:   "YOUR_CHAT_ID",
EMAIL_FROM:         "soc-alerts@yourdomain.com",
EMAIL_TO:           "soc-team@yourdomain.com",

// --- Optional ---
THEHIVE_ENABLED: false,
THEHIVE_URL: "http://your-thehive:9000",
LOG_STORAGE_ENABLED: true,       // Google Sheets audit log (node still must be enabled)
SEVERITY_HIGH_THRESHOLD: 14,
MAX_LOG_LINES: 200
```

**A block only fires when ALL are true:** `BLOCK_ENABLED` = true · the IP is **not** in `WHITELIST_IPS` · VirusTotal malicious ≥ `VT_MALICIOUS_THRESHOLD` **or** suspicious ≥ `VT_SUSPICIOUS_THRESHOLD` · Wazuh `rule.level` ≥ `AUTO_BLOCK_MIN_LEVEL`.

> ⚠️ **There is no dry-run in this edition.** Once the workflow is active and the conditions above are met, it executes `sudo ufw deny from <ip>` on the matching host(s) for real. Test with `BLOCK_ENABLED: false` (or a high `AUTO_BLOCK_MIN_LEVEL`) until you trust the triage. If you want a dry-run safety gate, use the "For Wazuh SIEM" edition.

---

## 6. Choose the AI model

Models are **left to you** — set them where you like. The relevant nodes:

| Node | Role | Default model |
|---|---|---|
| `Ollama Chat Model` → `AI: SOC Incident Report` | main incident report | `ministral-3:3b` |
| `AI: Summarize Logs` (Linux branch) | log parsing | `ministral-3:3b` |
| `AI: Summarize Win/Mac Logs` | log parsing | `mistral:latest` |
| `Ollama Chat Model1` → `AI Agent` | vulnerability summary | `ministral-3:latest` |

- **Keep Ollama** (private, local — no data leaves your network): set your model name on each node and make sure n8n can reach your Ollama server. Pull the models first (e.g. `ollama pull mistral`).
- **Use a cloud model:** delete the `Ollama Chat Model` sub-node and connect an `OpenAI Chat Model` / `Anthropic Chat Model` (etc.) to the agent's `ai_languageModel` input instead.

> The default model names are **not** unified across nodes by design — set each to whatever you have pulled.

---

## 7. Point Wazuh at the webhook

> **Do §4a first.** The webhook requires an auth header. Without it Wazuh's alerts are rejected and nothing in this section will appear to work.

1. Copy the **Production URL** from the `🔔 Alert Webhook - Level 12+` node (path `/reportlvl12`).
2. On the Wazuh **Manager**, register the integration script from §4a. The `<name>` **must** match the filename in `/var/ossec/integrations/`:

```xml
<integration>
  <name>custom-n8n</name>
  <hook_url>https://YOUR-N8N/webhook/reportlvl12</hook_url>
  <level>12</level>
  <alert_format>json</alert_format>
</integration>
```

Keep the block inside the main `<ossec_config>` block.

3. Restart `wazuh-manager`.

> **Do not use `localhost`** if Wazuh and n8n are on different machines. Use the address of the n8n host as reachable *from the Wazuh box*.

The workflow accepts both a raw alert body and a `{ "full_alert": {…} }` wrapper.

---

## 8. Test

Set `BLOCK_ENABLED: false` first, so testing can never block anything.

### Test A — pipeline and delivery (no host mapping needed)

Send a sample alert:

```bash
curl -X POST https://YOUR-N8N/webhook/reportlvl12 \
  -H "Content-Type: application/json" \
  -H "X-SOC-Token: YOUR_TOKEN" \
  --data @"samples/test-alerts/ssh-bruteforce.json"
```

> The `X-SOC-Token` header is required (§4a). Omit it and you get `401` before any node runs.

**Or use the demo runner**, which fires all three sample alerts with the right header, waits between them, and prints the status code for each:

```powershell
$env:SOC_TOKEN = "your-token"
.\samples\fire-alerts.ps1
```

```bash
export SOC_TOKEN="your-token"
./samples/fire-alerts.sh
```

See [`samples/README.md`](samples/README.md).

Confirm an AI incident report reaches **every** channel listed in `NOTIFICATION_CHANNELS`. The threat-intel section will be populated from real VirusTotal/AbuseIPDB lookups on the sample's source IP.

The **log analysis section will be empty or thin** — expected, because the sample's agent name is not yet one of *your* SSH-reachable hosts. That's what Test B is for.

### Test B — SSH log collection (after §3)

1. Pick a host you actually control and have wired an SSH credential for.
2. Edit `samples/test-alerts/ssh-bruteforce.json` and set `agent.name` to that host's Wazuh agent name (matching the rule you renamed in `Route to VM by Agent`).
3. Re-send the same `curl`.

Confirm the report's log section now contains real lines pulled from that host.

The three shipped samples exercise different paths:

| Sample | Rule level | Path exercised |
|---|---|---|
| `ssh-bruteforce.json` | 12 | Linux → `Route to VM by Agent` → `tail`/`journalctl` |
| `malware-detection.json` | 13 | Linux → VirusTotal-heavy enrichment |
| `suspicious-login.json` | 12 | Windows → `Execute a command` → `Get-WinEvent` |

Use **Executions** to inspect each step if anything is empty.

---

### Test C — a real Wazuh alert (end to end)

Tests A and B use curl, which proves the workflow. This proves the **integration** —
that Wazuh itself reaches n8n with the right header.

On the Wazuh manager, generate failed logins:

```bash
for i in $(seq 1 6); do ssh -o StrictHostKeyChecking=no -o BatchMode=yes invaliduser@localhost; done
```

Then check **n8n → Executions** for a new run within ~30 seconds.

**If nothing appears**, work down this list — each step rules out one layer:

```bash
# 1. is the alert rule even firing?
sudo tail -f /var/ossec/logs/alerts/alerts.json | grep -i sshd

# 2. did the integration try to send it?
sudo tail -30 /var/ossec/logs/ossec.log | grep -i integrat

# 3. can this box reach n8n at all, with the header?
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  http://YOUR-N8N:5678/webhook/reportlvl12 \
  -H "Content-Type: application/json" \
  -H "X-SOC-Token: YOUR_TOKEN" \
  --data @samples/test-alerts/ssh-bruteforce.json
```

| Where it fails | Cause |
|---|---|
| No alert in `alerts.json` | Wazuh isn't detecting it — rule or agent problem, not integration |
| Alert present, nothing in `ossec.log` | `<integration>` block missing or `<level>` too high |
| `ossec.log` says `File not found inside 'integrations'` | `<name>` doesn't match the script filename |
| Script runs but n8n sees nothing | Wrong host IP (don't use `localhost` across machines), firewall, or `python3-requests` missing |
| n8n returns 401 | Token mismatch between the script and the n8n credential |

> **Check your `<level>`.** If `ossec.conf` says `<level>4</level>`, Wazuh forwards
> almost everything — most of it routine noise with no source IP and nothing to
> triage. This workflow is built for level 12+. A low threshold burns your
> VirusTotal quota and fills the dashboard with non-incidents.

> **The webhook only accepts Wazuh alert JSON.** A payload without `rule.id`,
> `rule.level` and `agent.name` is rejected at the first node. This is deliberate —
> see the note below.

#### Why arbitrary JSON is rejected

An early version accepted any body. Sending `{"test":"ping"}` produced a complete,
confident incident report describing a threat that did not exist — the model read
empty fields and wrote a narrative around them.

An authenticated-but-malformed POST could therefore manufacture fake incidents.
The normalization nodes now verify the payload is actually a Wazuh alert and stop
if it isn't, rather than letting a language model interpret missing data as evidence.

---

## 9. Go live (auto-block)

When you trust the triage:
1. On each block target, confirm `ufw` is installed and your SSH user can run it without a password prompt, e.g. in `sudoers`:
   ```
   <ssh-user> ALL=(ALL) NOPASSWD: /usr/sbin/ufw
   ```
2. Set `BLOCK_ENABLED: true` and confirm `AUTO_BLOCK_MIN_LEVEL` / `WHITELIST_IPS` are what you want.
3. **Activate** the workflow (toggle, top-right).

Blocks run as `sudo ufw deny from <source-ip>` on the host matched by `Route to VM by Agent1`. To undo a block: `sudo ufw delete deny from <ip>` on that host.

---

## 10. Notification channels

`NOTIFICATION_CHANNELS` takes a **comma-separated list**, and every channel in it is delivered **at the same time** — not just the first match:

```js
NOTIFICATION_CHANNELS: "discord"                       // Discord only
NOTIFICATION_CHANNELS: "discord,slack"                 // both, in parallel
NOTIFICATION_CHANNELS: "discord,slack,telegram,email"  // all four, in parallel
```

| Channel | What it needs |
|---|---|
| `discord` | Discord Webhook credential on the `Discord` node. Sends the report as a `.txt` attachment. |
| `slack` | `SLACK_WEBHOOK_URL` in config. No credential needed — the webhook URL carries the auth. |
| `telegram` | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` in config. Message is trimmed to 3900 chars (Telegram's limit is 4096). |
| `email` *or* `gmail` | Switches on the **HTML email branch** — see below. |

Every delivery node is set to **continue on error**, so one misconfigured channel cannot stop the others from delivering. It also means a failed send is *silent* — if a channel goes quiet, check the execution log rather than waiting for an error notification.

### 10a. The HTML email branch — pick one transport

Email is the one channel that renders a designed **HTML report** rather than plain text:

```
📢 Notification Router ──(Email / Gmail)──▶ 🎨 Build HTML Email ──┬──▶ 📧 Email Alert  (SMTP)
                                                                  └──▶ 📧 Gmail Alert  (OAuth)
```

`🎨 Build HTML Email` renders the template once; **both** sender nodes then receive it.
Listing either `email` or `gmail` in `NOTIFICATION_CHANNELS` switches the branch on —
the two words are interchangeable.

**Enable the transport you use and disable the other**, otherwise the unconfigured one
fails on every alert (silently, thanks to continue-on-error, but it clutters your
execution log):

| Transport | Node | Needs |
|---|---|---|
| **SMTP** | `📧 Email Alert` | An SMTP credential, plus `EMAIL_FROM` / `EMAIL_TO` in config. Sends multipart HTML + plain-text fallback. |
| **Gmail** | `📧 Gmail Alert` | A Gmail OAuth2 credential. Sends to `EMAIL_TO`; the sender is the authenticated Gmail account, so `EMAIL_FROM` is ignored. HTML only. |

To disable a node: right-click it → **Deactivate** (or select it and press `D`).

**Changing the design.** The template lives in the `🎨 Build HTML Email` node's *HTML Template*
field. Two alternative designs — a dark compact triage layout and a client-facing executive
brief — ship in **[`bonus/email-templates/`](bonus/email-templates/)**, along with the full list
of data fields you can reference and instructions for writing your own.

### Other integrations

- **TheHive:** `THEHIVE_ENABLED: true` + `THEHIVE_URL`, add the header-auth credential, **enable** `🎫 Create TheHive Alert`.
- **Google Sheets audit log:** `LOG_STORAGE_ENABLED: true`, **enable** `📊 Log to Google Sheets`, set the sheet ID + OAuth credential.

(TheHive and Sheets nodes ship **disabled** — enable them after configuring.)

---

## 11. Vulnerability alerts

Wazuh **vulnerability-detector** alerts take a separate path: `Switch` (Vulnerability output) → `Code in JavaScript` → `AI Agent` → `Convert to File` → `Discord1`. This produces a CVE summary report and posts it to Discord. No SSH or blocking happens for vulnerability alerts. Set the model on `Ollama Chat Model1` and the webhook credential on `Discord1`.

---

## 12. Troubleshooting

| Symptom | Fix |
|---|---|
| **No alerts arriving at all** | **Check the auth header first (§4a).** The n8n credential value and the token in `/var/ossec/integrations/custom-n8n` must match exactly. A mismatch rejects every alert. |
| `401` / `403` from the webhook | Token mismatch, or the Header Auth credential isn't attached to the webhook node. |
| `404` from the webhook | Workflow not active, or the path doesn't match `/reportlvl12`. |
| Wazuh logs `File not found inside 'integrations'` | The `<name>` in `ossec.conf` doesn't match the script filename in `/var/ossec/integrations/`. |
| Curl works but Wazuh alerts never arrive | The integration script isn't executable, isn't owned `root:wazuh`, or `python3-requests` isn't installed. Check `/var/ossec/logs/ossec.log`. |
| No logs in the report | Agent name doesn't match a `Route to VM by Agent` rule (see §3a), or the SSH node has no/incorrect credential, or SSH can't reach the host. |
| Windows/macOS report empty | OpenSSH Server not enabled on the host, or the SSH credential on `Execute a command` / `Execute a command1` points at the wrong machine. |
| Only one channel receives the report | `NOTIFICATION_CHANNELS` still holds a single value — it takes a comma-separated **list** (§10). |
| A channel silently sends nothing | Delivery nodes continue on error by design. Open the execution and inspect that node's output for the API response. |
| Telegram returns 400 | Bad `TELEGRAM_CHAT_ID`, or the bot was never started in that chat. |
| Block never fires | `BLOCK_ENABLED` false, IP whitelisted, `rule.level` below `AUTO_BLOCK_MIN_LEVEL`, or VT below threshold. |
| `ufw` block errors / asks for password | `ufw` not installed, or SSH user lacks passwordless `sudo` for `ufw` (see §9). |
| AI report empty | Chat model unreachable — check the Ollama URL / cloud credential, and that the model is pulled. |
| Duplicate alerts dropped | Expected — `DEDUP_WINDOW_MINUTES` cooldown for the same IP + rule + agent. |
| Discord "operation" validation warning | Harmless. In Webhook mode n8n manages the Discord send operation internally; the node still posts correctly. |

Errors from any node are caught by the `⚠️ Error Trigger` → `Format Error Report` → `🚨 Error to Discord` chain and posted to Discord.

---

## Security notes

- Inbound alert data is sanitized (`🛡️ Input Sanitization`): the source IP is validated as IPv4/IPv6 and shell metacharacters are stripped before any value reaches an SSH command — this prevents command injection through crafted alerts.
- Auto-blocking is gated by a configurable IP/CIDR whitelist (`WHITELIST_IPS`) so you can never block your own infrastructure or trusted resolvers.
- Logs are pulled read-only (`tail`/`journalctl`/`Get-WinEvent`); the only state-changing action is the optional `ufw deny`.
- The AI runs locally on Ollama by default — alert contents, log excerpts and hostnames stay inside your network. Switching to a cloud model changes that; decide deliberately.
