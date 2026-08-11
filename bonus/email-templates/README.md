# 🎁 Bonus — Email Templates

Three drop-in HTML templates for the **`🎨 Build HTML Email`** node. Both email
transports (`📧 Email Alert` via SMTP and `📧 Gmail Alert` via OAuth) render whichever
template is loaded, so you only ever change it in one place.

| File | Style | Use it when |
|---|---|---|
| `00-default-incident-report.html` | Light, card layout, threat-intel tiles | **Shipped default.** Internal SOC channel, desktop-first. Keep a copy so you can restore it. |
| `01-compact-triage.html` | Dark, dense, monospace facts | High alert volume, on-call phone triage. Fits a phone screen without pinching. |
| `02-executive-client-brief.html` | Light, serif, branded | Forwarding to a client or a manager. Plain-language framing, no jargon tiles. |

---

## How to swap a template

1. Open the **`🎨 Build HTML Email`** node in n8n.
2. Click into the **HTML Template** field.
3. Select all (`Ctrl+A`), then paste the full contents of the file you want.
4. Save.

> **Keep the field in expression mode.** The stored value must begin with `=` for the
> `{{ }}` placeholders to resolve. It already does in the shipped workflow, and pasting
> over existing content preserves that — so don't delete the node and add a fresh one.
> If you ever see literal `{{ ... }}` text in a delivered email, that prefix is missing.

Preview any template in a browser before wiring it up — the `{{ }}` placeholders will
show as raw text, but the layout, colours and spacing render exactly as they will in
the email.

---

## White-labelling `02-executive-client-brief.html`

Two placeholders are marked `EDIT ME` in the file:

- **`YOUR COMPANY NAME`** — appears twice (header bar and footer). Your MSP/SOC brand.
- **`Client Name`** — appears once, under "Prepared for".

For multi-client setups, drive the client name from config instead of hardcoding it.
Add to the `⚙️ CONFIGURATION` node:

```js
CLIENT_NAME: "Acme Corp",
```

then replace the literal `Client Name` in the template with:

```
{{ $('⚙️ CONFIGURATION').first().json.config.CLIENT_NAME }}
```

---

## Data available to any template

Everything below is already resolved by the time `🎨 Build HTML Email` runs:

| Expression | Value |
|---|---|
| `$('AI: SOC Incident Report').item.json.output` | The full AI incident report (markdown-ish text) |
| `$('Detect OS Name').first().json.body.rule.level` | Wazuh rule level |
| `$('Detect OS Name').first().json.body.rule.id` | Wazuh rule ID |
| `$('Detect OS Name').first().json.body.rule.description` | Rule description |
| `$('Detect OS Name').first().json.body.rule.mitre?.technique` | MITRE technique(s), array |
| `$('Detect OS Name').first().json.body.agent.name` / `.ip` / `.os` | Affected host |
| `$('Detect OS Name').first().json.body.data.srcip` | Source IP |
| `$('Detect OS Name').first().json.body.GeoLocation?.country_name` | Origin country |
| `$('Detect OS Name').first().json.body.full_log` | Raw triggering log line |
| `$('Combine Data For Report').first().json.threat_level` | `CRITICAL` / `HIGH` / `MEDIUM` / `LOW` |
| `$('Combine Data For Report').first().json.combined_threat_score` | 0–100 |
| `$('Combine Data For Report').first().json.virustotal_stats?.[0]?.malicious` / `.suspicious` | VirusTotal counts |
| `$('Combine Data For Report').first().json.abuseipdb?.confidence_score` / `.total_reports` / `.isp` / `.usage_type` | AbuseIPDB |
| `$('⚙️ CONFIGURATION').first().json.config.*` | Anything you put in the config node |

> Use **`Detect OS Name`**, not `Normalize Alert Data1`, for alert fields. `Detect OS Name`
> runs before the OS Switch so it is populated for Linux, Windows *and* macOS alerts.
> `Normalize Alert Data1` only runs on the Linux branch.

---

## The markdown → HTML converter

The AI writes markdown-ish text (`**bold**`, `- bullets`, backtick code). Each template
converts it inline with a `.replace()` chain. If you write your own template, copy that
chain verbatim — the order matters:

1. escape `&`, `<`, `>` (must be first, or the AI's own output could inject markup)
2. `**bold**` → `<strong>`
3. `` `code` `` → `<code>`
4. `- item` → `<li>`
5. collapse whitespace between adjacent `<li>`
6. wrap each run of `<li>` in a `<ul>`
7. blank lines → new block
8. remaining newlines → `<br>`

Skipping step 1 means a crafted log line in the report body could inject HTML into an
email your team trusts. Keep it.

---

## Email client notes

- All styling is **inline** — Gmail, Outlook and Apple Mail strip or ignore `<style>` blocks in varying ways.
- Layout is **table-based** for the same reason; `flex`/`grid` do not survive Outlook.
- Widths are capped (600–680px) with `max-width` so mobile clients reflow.
- `📧 Email Alert` sends **multipart** (HTML + plain-text fallback). `📧 Gmail Alert` sends HTML only.

---
