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
| (optional) TheHive Header Auth, Google Sheets OAuth | optional nodes | only if enabled |

> The imported workflow arrives with credential *slots* referencing the packaging environment's names. n8n will show them as unresolved until you select your own on each node.

> Tip: if all your hosts share one SSH key/user, create a single SSH credential and select it on every SSH node.

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

1. Copy the **Production URL** from the `🔔 Alert Webhook - Level 12+` node (path `/reportlvl12`).
2. On the Wazuh **Manager**, add an integration that POSTs level ≥ 12 alerts as JSON. Example `ossec.conf`:

```xml
<integration>
  <name>custom-n8n</name>
  <hook_url>https://YOUR-N8N/webhook/reportlvl12</hook_url>
  <level>12</level>
  <alert_format>json</alert_format>
</integration>
```

3. Restart `wazuh-manager`.

The workflow accepts both a raw alert body and a `{ "full_alert": {…} }` wrapper.

---

## 8. Test

Set `BLOCK_ENABLED: false` first, so testing can never block anything.

### Test A — pipeline and delivery (no host mapping needed)

Send a sample alert:

```bash
curl -X POST https://YOUR-N8N/webhook/reportlvl12 \
  -H "Content-Type: application/json" \
  --data @"samples/test-alerts/ssh-bruteforce.json"
```

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
