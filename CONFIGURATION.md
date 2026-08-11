# Configuration Reference

Every setting below lives in the **`⚙️ CONFIGURATION`** Code node — the first node after the webhook. It attaches a `config` object to the alert as it flows through, and every downstream node reads from it.

Edit values, save, done. You should not need to open any other node except the two routing Switches and the SSH credentials (see [SETUP-GUIDE.md §3](SETUP-GUIDE.md)).

---

## Threat intelligence

| Setting | Default | What it does |
|---|---|---|
| `VT_MALICIOUS_THRESHOLD` | `3` | How many VirusTotal engines must flag the source IP as **malicious** before it is considered blockable. |
| `VT_SUSPICIOUS_THRESHOLD` | `2` | Same, for the **suspicious** verdict. Either threshold being met satisfies the intel condition. |
| `ABUSEIPDB_ENABLED` | `true` | Include AbuseIPDB in enrichment. Requires the HTTP Header Auth credential on `🔍 AbuseIPDB Check`. |

Both sources feed a **combined threat score** (0–100) built in `🧩 Combine Enrichment`:

```
score = min(VT_malicious × 5, 50) + min(AbuseIPDB_confidence × 0.5, 50)
```

| Score | Threat level |
|---|---|
| ≥ 70 | `CRITICAL` |
| ≥ 50 | `HIGH` |
| ≥ 30 | `MEDIUM` |
| < 30 | `LOW` |

The score is passed to the AI report as context — it informs the verdict, it does not decide it.

---

## Auto-blocking

> ⚠️ This edition has **no dry-run**. When the conditions below are all met, `sudo ufw deny from <ip>` runs for real on the matching host.

| Setting | Default | What it does |
|---|---|---|
| `BLOCK_ENABLED` | `true` | Master switch. `false` disables all blocking regardless of everything else. |
| `AUTO_BLOCK_MIN_LEVEL` | `14` | Minimum Wazuh `rule.level` required to block. Level 12–13 alerts are reported but never blocked. |
| `WHITELIST_IPS` | RFC1918 + public resolvers | Comma-separated IPs and CIDRs that are **never** blocked. |

**A block fires only when all four are true:**

1. `BLOCK_ENABLED` is `true`
2. the source IP is **not** matched by `WHITELIST_IPS`
3. VirusTotal malicious ≥ `VT_MALICIOUS_THRESHOLD` **or** suspicious ≥ `VT_SUSPICIOUS_THRESHOLD`
4. Wazuh `rule.level` ≥ `AUTO_BLOCK_MIN_LEVEL`

The whitelist is evaluated in `🛡️ Whitelist Check` with proper CIDR maths, not string matching — `10.0.0.0/8` correctly covers `10.20.0.31`. Add your VPN ranges, your monitoring hosts, and your office egress IPs here **before** you enable blocking.

To undo a block on a host: `sudo ufw delete deny from <ip>`.

---

## Deduplication

| Setting | Default | What it does |
|---|---|---|
| `DEDUP_WINDOW_MINUTES` | `15` | Cooldown window. The same **source IP + rule ID + agent name** seen again inside this window is counted and dropped. |

State lives in n8n's workflow static data, so it survives across executions but not across a workflow re-import. A 200-attempt brute force therefore costs one report, one VirusTotal lookup and one AI pass.

Tune it by alert volume: raise it if the same attacker generates repeated reports; lower it if you are missing genuinely distinct waves.

---

## Notifications (multi-channel)

| Setting | Default | What it does |
|---|---|---|
| `NOTIFICATION_CHANNELS` | `"discord"` | **Comma-separated list.** Every channel listed receives the report, all at the same time. |
| `SLACK_WEBHOOK_URL` | placeholder | Incoming-webhook URL. Only needed if `slack` is listed. |
| `TELEGRAM_BOT_TOKEN` | placeholder | Bot token from @BotFather. Only needed if `telegram` is listed. |
| `TELEGRAM_CHAT_ID` | placeholder | Target chat/channel ID. Only needed if `telegram` is listed. |
| `EMAIL_FROM` | placeholder | Sender address. SMTP transport only — Gmail uses the authenticated account. |
| `EMAIL_TO` | placeholder | Recipient address. Used by both email transports. |

Valid channel values: `discord`, `slack`, `telegram`, `email`, `gmail`.

```js
NOTIFICATION_CHANNELS: "discord"                       // Discord only
NOTIFICATION_CHANNELS: "discord,slack"                 // both, in parallel
NOTIFICATION_CHANNELS: "discord,slack,telegram,email"  // all four, in parallel
```

### How it works

The config node expands your list into per-channel booleans:

```js
config.NOTIFY = { discord: true, slack: true, telegram: false, email: false }
```

`📢 Notification Router` is a Switch with **"send to all matching outputs"** enabled, so it fires every branch whose flag is `true` — rather than stopping at the first match, which is what a plain Switch does.

`NOTIFY.email` is set by **either** `email` or `gmail` appearing in the list — both words switch on the same HTML email branch.

### Per-channel notes

| Channel | Credential | Format | Limits |
|---|---|---|---|
| **Discord** | Discord Webhook on the `Discord` node | Report as a `.txt` file attachment | — |
| **Slack** | none — the webhook URL is the auth | Plain text message | ~40 000 chars |
| **Telegram** | none — token is in config | Markdown message | Trimmed to 3 900 chars (API limit 4 096) |
| **Email (SMTP)** | SMTP on `📧 Email Alert` | Designed HTML + plain-text fallback (multipart) | — |
| **Email (Gmail)** | Gmail OAuth2 on `📧 Gmail Alert` | Designed HTML | Gmail send quotas apply |

### The HTML email branch

The email output does not send raw text. It routes through `🎨 Build HTML Email`, an HTML node that renders a designed report template, and **both** sender nodes receive the result:

```
Router ──(Email / Gmail)──▶ 🎨 Build HTML Email ──┬──▶ 📧 Email Alert  (SMTP)
                                                  └──▶ 📧 Gmail Alert  (OAuth)
```

Because both senders sit on the same branch, **enable only the transport you use** and deactivate the other — there is no config flag for this; it is a node-level enable/disable, same as TheHive and Sheets.

Three ready-made templates ship in `bonus/email-templates/`. The template field must stay in expression mode (stored value begins with `=`) or the `{{ }}` placeholders will be emailed literally.

Every delivery node is set to `onError: continueRegularOutput`. One dead channel cannot stop the others — but it also means **failed sends are silent**. If a channel goes quiet, check the execution log; the error notification chain will not fire for it.

Whitespace around list entries is ignored, and matching is case-insensitive, so `"Discord, Slack"` works.

---

## Case management & audit logging

| Setting | Default | What it does |
|---|---|---|
| `THEHIVE_ENABLED` | `false` | Create a TheHive alert per incident. |
| `THEHIVE_URL` | placeholder | Base URL of your TheHive instance, e.g. `http://thehive.internal:9000`. |
| `LOG_STORAGE_ENABLED` | `true` | Write a structured row per incident to Google Sheets. |

Both features also require their node to be **enabled** in the canvas — `🎫 Create TheHive Alert` and `📊 Log to Google Sheets` ship disabled so a fresh import cannot fail on missing credentials. Setting the flag alone does nothing.

TheHive severity is derived from the Wazuh rule level: level ≥ 14 → `3` (high), ≥ 12 → `2` (medium), otherwise `1` (low). The source IP is attached as an observable.

The Sheets row is built in `📋 Build Log Entry` and includes timestamps, agent, rule, MITRE tactic/technique, country, both intel scores, the combined score, threat level, and the first 500 characters of the AI report.

---

## AI model

| Setting | Default | What it does |
|---|---|---|
| `OLLAMA_MODEL` | `"mistral:latest"` | Documentation value. **The model is actually set on each AI node**, not read from here. |

This is the one setting that is not wired through — model selection lives on the four AI nodes because they can legitimately use different models (a small fast model for log parsing, a larger one for the report):

| Node | Role | Ships with |
|---|---|---|
| `Ollama Chat Model` → `AI: SOC Incident Report` | main incident report | `ministral-3:3b` |
| `AI: Summarize Logs` | Linux log parsing | `ministral-3:3b` |
| `AI: Summarize Win/Mac Logs` | Windows/macOS log parsing | `mistral:latest` |
| `Ollama Chat Model1` → `AI Agent` | vulnerability CVE summary | `ministral-3:latest` |

Pull the model on your Ollama host first (`ollama pull mistral`), then set the name on each node.

To use a cloud model instead, delete the `Ollama Chat Model` sub-node and connect an `OpenAI Chat Model` / `Anthropic Chat Model` to the agent's `ai_languageModel` input. Note that this sends alert contents and log excerpts off your network.

---

## Severity & collection

| Setting | Default | What it does |
|---|---|---|
| `SEVERITY_HIGH_THRESHOLD` | `14` | Level at which an alert is treated as escalated in reporting. |
| `MAX_LOG_LINES` | `200` | Documentation value for the log-pull depth. The actual `tail -n` / `-MaxEvents` counts are inside the three "Prepare commands" Code nodes. |

Raising the log depth gives the AI more context but costs inference time and can exceed a small model's context window. 200 lines suits a 3B model; if you move to a larger model you can afford more.

---

## What is *not* in this node

These require editing the canvas directly:

| What | Where |
|---|---|
| Wazuh agent name → host routing | `Route to VM by Agent` and `Route to VM by Agent1` Switch nodes |
| SSH hosts, users, keys | SSH credentials on the 12 SSH nodes |
| AI model names | the four AI nodes (above) |
| Log-pull depth and log sources per OS | `Prepare SSH Log Command For Linux Endpoints`, `Prepare commands For Windows Endpoints`, `Prepare commands For MacOS Endpoints` |
| Webhook path (`/reportlvl12`) | `🔔 Alert Webhook - Level 12+` |
| Report structure and tone | the prompt in `AI: SOC Incident Report` |
| Google Sheet ID | `📊 Log to Google Sheets` |
