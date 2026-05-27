# AI SOC Analyst L1 — Setup Guide

## Wazuh + n8n + Ollama | 73 Nodes | Multi-OS | Multi-Intel

This guide documents the full setup for the **AI SOC Analyst L1 ** workflow: a local, self-hosted SOC automation pipeline that receives Wazuh alerts, enriches them with threat intelligence, analyzes them with Ollama, and sends readable incident reports to Discord or other notification channels.

It is written for a **Windows host + Ubuntu VM** lab, which is the setup used during testing.

---

## 1. What this project does

The workflow automates:

- alert intake from Wazuh
- data normalization and sanitization
- duplicate alert filtering
- OS detection for endpoints
- VirusTotal enrichment
- AbuseIPDB enrichment
- log collection over SSH
- AI-generated incident reporting using Ollama
- notification delivery to Discord / Slack / Telegram / Email
- optional case management and logging

The workflow is designed to work locally with **no cloud dependency** for the SOC stack itself.

---

### Lab layout used in this setup

- **Windows host**
  - Runs n8n
  - Runs the Discord webhook destination
  - Acts as the monitored endpoint (`zaid-windows`)
- **Ubuntu VM**
  - Runs Wazuh Manager / Dashboard / Indexer
  - Receives Wazuh agent events
  - Sends alerts to n8n via webhook
- **Ollama**
  - Runs locally and powers the AI report generation
- **Wazuh Agent**
  - Installed on the monitored endpoint(s)

---

## 3. Prerequisites


- **Wazuh Manager** 4.x+
- **Wazuh Agents** 4.x+
- **n8n** 1.x+
- **Ollama** with at least one model pulled
- **VirusTotal API key**
- **AbuseIPDB API key**
- **SSH access** to monitored machines
- **Discord / Slack / Telegram / Email** for alerts
- Optional:
  - **TheHive** for case management
  - **Google Sheets** for audit logging

### Hardware guidance

A light lab works with around 8 GB RAM, but the smoother setup is closer to 16 GB RAM or more. For AI usage, the model matters a lot. The original guide recommends lightweight models like **Llama 3.2 3B** or **Gemma 2 2B** for smaller systems.

### Recommended lab choice

For a stable demo setup:

- Ubuntu VM: **24.04 LTS**
- RAM: **6 GB+**
- CPU: **4 cores**
- Disk: **60 GB**
- n8n on Windows host
- Ollama on the same machine that is handling the report generation workload

---

## 4. Installation summary

If you are building from scratch, install these in order:

1. Ubuntu VM
2. Wazuh all-in-one stack
3. Wazuh agent on the monitored endpoint
4. n8n
5. Ollama and model(s)
6. API credentials
7. Wazuh webhook integration
8. Test alerts
9. Snapshot / backup

---

## 5. Import the workflow into n8n

1. Open n8n in your browser.
2. Click the **three-dot menu** in the top right.
3. Choose **Import from File**.
4. Select the workflow JSON.
5. The workflow will load with red credential warnings. That is normal before setup.
6. Locate the **CONFIGURATION** node on the far left. This is the central control panel for the workflow.

---

## 6. Configuration node setup

The `CONFIGURATION` node controls the behavior of the workflow. Based on the original guide, the important settings are:

- `VT_MALICIOUS_THRESHOLD`
- `BLOCK_ENABLED`
- `AUTO_BLOCK_MIN_LEVEL`
- `WHITELIST_IPS`
- `DEDUP_WINDOW_MINUTES`
- `NOTIFICATION_CHANNEL`
- `THEHIVE_ENABLED`
- `THEHIVE_URL`
- `ABUSEIPDB_ENABLED`
- `LOG_STORAGE_ENABLED`
- `OLLAMA_MODEL`
- `SEVERITY_HIGH_THRESHOLD`
- `MAX_LOG_LINES`

### Suggested starting values

A stable starter configuration for the lab is:

```js
const config = {
  VT_MALICIOUS_THRESHOLD: 3,
  VT_SUSPICIOUS_THRESHOLD: 2,
  ABUSEIPDB_ENABLED: true,
  BLOCK_ENABLED: false,
  AUTO_BLOCK_MIN_LEVEL: 14,
  WHITELIST_IPS: "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,8.8.8.8,8.8.4.4,1.1.1.1",
  DEDUP_WINDOW_MINUTES: 15,
  NOTIFICATION_CHANNEL: "discord",
  THEHIVE_ENABLED: false,
  THEHIVE_URL: "http://your-thehive:9000",
  LOG_STORAGE_ENABLED: false,
  OLLAMA_MODEL: "llama3.2:latest",
  SEVERITY_HIGH_THRESHOLD: 14,
  MAX_LOG_LINES: 200
};
```

### Practical notes from the lab

- `BLOCK_ENABLED` should remain `false` while testing.
- Keep the IP whitelist broad enough to avoid blocking your own lab environment.
- Set the notification channel to the one you are actually using.
- Keep the model small if the machine is limited.

---

## 7. Credentials setup

n8n will show red nodes until credentials are created.

### 7.1 Ollama

For each Ollama node:

1. Open the node.
2. Go to **Credentials**.
3. Create a new Ollama credential.
4. Set the base URL to your Ollama server.

Common local value:

```text
http://localhost:11434
```

### 7.2 VirusTotal

Create a **Header Auth** credential:

- Header name: `x-apikey`
- Value: your VirusTotal API key

### 7.3 AbuseIPDB

Create a **Header Auth** credential:

- Header name: `Key`
- Value: your AbuseIPDB API key

### 7.4 SSH credentials

Create SSH password credentials for each monitored VM.

Example naming:

- `SSH - Wazuh Manager`
- `SSH - Windows Endpoint`
- `SSH - Linux Server`

Use descriptive names. It saves time later.

### 7.5 Discord webhook

Create a Discord webhook credential and paste the webhook URL from:

**Discord → Server Settings → Integrations → Webhooks**

### 7.6 Slack / Telegram / Email

If you use them:

- Slack: incoming webhook
- Telegram: bot token + chat ID
- Email: SMTP credentials

---

## 8. Ollama model selection

The workflow calls Ollama twice per alert. The model should be lightweight enough to respond quickly.

### Models to avoid

- Qwen 2.5 / Qwen 3
- DeepSeek R1
- very large models on CPU
- models that produce visible `<think>` blocks
- code-centric models like CodeLlama if you want narrative reports

### Recommended models

- **8 GB RAM**: Gemma 2 2B / Llama 3.2 3B
- **16 GB RAM**: Ministral 3B
- **32 GB RAM**: Mistral 7B
- **32 GB+**: Llama 3.1 8B
- **64 GB+**: Mistral Small 22B

### Example commands

```bash
ollama pull llama3.2:3b
ollama pull mistral:latest
ollama pull ministral-3:latest
```

### Practical lesson

For this project, **Llama 3.2** is a strong balance of speed and report quality.

---

## 9. Wazuh installation (Ubuntu VM)

The guide is designed around Wazuh 4.x.

### Recommended lab setup

Use:

- Ubuntu Server 24.04 LTS
- 6 GB RAM minimum
- 4 CPU cores
- 60 GB disk

### Install the Wazuh all-in-one stack

```bash
curl -sO https://packages.wazuh.com/4.12/wazuh-install.sh
sudo bash wazuh-install.sh -a
```

### Notes

- The install may take 10–25 minutes or longer.
- It is normal for the CPU and RAM to spike.
- Save the dashboard credentials shown at the end.

### After install

Check status:

```bash
sudo service wazuh-manager status
sudo service wazuh-dashboard status
sudo service wazuh-indexer status
```

---

## 10. Wazuh agent setup

Install the Wazuh agent on your monitored endpoint.

### Windows agent

Use the Wazuh Windows agent installer and point it to the Ubuntu VM manager IP.

Typical manager IP in the lab:

```text
192.168.13.133
```

### Confirm the agent is active

In the Wazuh dashboard, make sure the endpoint becomes **Active**.

---

## 11. Webhook integration between Wazuh and n8n

This was the most important real-world troubleshooting step in the lab.

### What must happen

Wazuh must send alerts to n8n using a webhook path that matches your workflow trigger.

The n8n workflow used here listens on:

```text
http://192.168.13.1:5678/webhook/reportlvl12
```

where:

- `192.168.13.1` = Windows host / n8n machine on the VMware network
- `5678` = n8n port
- `reportlvl12` = webhook path

### Important lesson

Do **not** use `localhost` in Wazuh if the Wazuh manager is inside Ubuntu and n8n is on Windows.

Use the Windows host IP reachable from the Ubuntu VM.

---

## 12. Creating the custom webhook integration script

Wazuh expects an integration executable when you define a custom integration name.

Create this file on the Ubuntu VM:

```bash
sudo nano /var/ossec/integrations/custom-webhook
```

Paste:

```python
#!/usr/bin/env python3

import sys
import json
import requests

with open(sys.argv[1], "r") as f:
    alert = json.load(f)

url = "http://192.168.13.1:5678/webhook/reportlvl12"

headers = {
    "Content-Type": "application/json"
}

requests.post(url, json=alert, headers=headers)
```

Then:

```bash
sudo chmod +x /var/ossec/integrations/custom-webhook
```

### Install the Python dependency

On Ubuntu 24.04, use the package manager:

```bash
sudo apt install python3-requests -y
```

This avoids the `externally-managed-environment` issue from `pip`.

---

## 13. Update `ossec.conf`

Edit the Wazuh manager config:

```bash
sudo nano /var/ossec/etc/ossec.conf
```

Make sure the integration block exists inside the main `<ossec_config>` block:

```xml
<integration>
  <name>custom-webhook</name>
  <hook_url>http://192.168.13.1:5678/webhook/reportlvl12</hook_url>
  <level>4</level>
  <alert_format>json</alert_format>
</integration>
```

### Important lessons from troubleshooting

- Keep the integration block **inside** the correct `<ossec_config>` block.
- Make sure the integration name matches the executable filename.
- Restart Wazuh after any config change.

### Restart Wazuh

```bash
sudo systemctl restart wazuh-manager
sudo systemctl status wazuh-manager
```

You want to see:

```text
active (running)
```

---

## 14. Why the integration initially failed

A few real issues were encountered during setup:

### 14.1 Integration name mismatch

If the config says `custom-webhook`, Wazuh expects:

```text
/var/ossec/integrations/custom-webhook
```

If that file does not exist, Wazuh logs an error similar to:

```text
File not found inside 'integrations'
```

### 14.2 `localhost` confusion

`localhost` only works on the machine itself.  
Wazuh on Ubuntu must reach n8n on the Windows host through the actual host IP.

### 14.3 Prompt mode in the AI node

The AI agent can return structured function-like output if the prompt is too loose. To fix that, the report prompt must explicitly tell the model:

- do not return JSON
- do not call tools
- return plain readable text only

---

## 15. VirusTotal and AbuseIPDB setup

### VirusTotal

- Create a `Header Auth` credential with `x-apikey`
- Use the IP reputation endpoint
- Keep in mind free tiers have request limits

### AbuseIPDB

- Create a `Header Auth` credential with `Key`
- Make sure the key header name is exact
- AbuseIPDB is useful for reputation, report count, and confidence score

### Troubleshooting note

If VirusTotal returns 401/403, check:

- key is valid
- header name is `x-apikey`
- credential is attached to the node

If AbuseIPDB returns 401, check:

- header name is exactly `Key`
- the value is your real API key

---

## 16. SSH access and endpoint log collection

The workflow uses SSH nodes to collect logs from Linux and Windows endpoints.

### Recommended approach

Create a credential per endpoint or per endpoint type.

Example:

- `SSH - Wazuh Manager`
- `SSH - Linux Server`
- `SSH - Windows Endpoint`

### Test SSH manually first

From Windows PowerShell:

```powershell
ssh zaidzyy@192.168.13.133
```

If it connects, the credentials are correct.

### Why SSH matters

The AI report is much better when it can summarize relevant endpoint logs, not just the Wazuh alert alone.

---

## 17. Testing the full pipeline

The guide recommends testing with a real alert or a Wazuh log test.

### 17.1 Manual n8n test

In n8n:

1. Open the workflow.
2. Click **Execute Workflow**.
3. Trigger a test event at the webhook node if you are manually testing.

### 17.2 Real SSH failed login test

A realistic test is a failed SSH attempt against the Ubuntu VM.

From Windows PowerShell:

```powershell
ssh invaliduser@192.168.13.133
```

Or repeat failed attempts to generate a stronger alert.

### 17.3 Windows failed login test

A Windows-side failed login event can also generate Wazuh alerts.

Example:

```powershell
for ($i=1; $i -le 5; $i++) {
    net user fakeuser wrongpassword
}
```

### 17.4 Expected test checklist

Verify that:

- alert arrives at the webhook node
- configuration is attached correctly
- sanitization passes valid IPs
- dedup filter allows the first alert
- OS detection works
- VirusTotal and AbuseIPDB return results
- threat score is calculated
- AI report is readable
- the notification channel receives the report

---

## 18. AI incident report formatting

A major improvement made during real setup was changing the AI prompt to produce a clean report instead of JSON/tool output.

### Good report format

The AI should output something like:

```text
🚨 AI SOC INCIDENT REPORT

Time:
2026-05-27 19:15 UTC

Agent:
zaidslinux

Threat Type:
SSH login attempt using a non-existent user

Severity:
LOW

MITRE ATT&CK:
• T1110.001 – Password Guessing
• T1021.004 – SSH

Source IP:
192.168.13.1

Threat Intelligence:
VirusTotal: Clean
AbuseIPDB: 0 confidence score

Assessment:
This activity appears to be a failed SSH authentication attempt.
No strong malicious indicators observed.

Recommended Actions:
1. Monitor repeated attempts
2. Review SSH authentication logs
3. Block IP if threshold exceeded
```

### Prompt guidance

The prompt should explicitly say:

- do not output JSON
- do not call tools
- output plain readable text
- use the exact sections required

This makes Discord messages and attached report text much cleaner.

---

## 19. Vulnerability report branch vs incident report branch

The workflow has two different report paths:

### Incident report branch
Used for events like:

- SSH brute force
- login failures
- suspicious network activity
- general security alerts

### Vulnerability report branch
Used for:

- CVE findings
- package vulnerability alerts
- Wazuh vulnerability detection events

If vulnerability scanning is disabled, the vulnerability report branch will not fire.

---

## 20. Optional: TheHive and Google Sheets

### TheHive

If you want automatic case creation:

- enable `THEHIVE_ENABLED`
- set `THEHIVE_URL`
- configure authorization headers

### Google Sheets

If you want audit logging:

1. Create a sheet with a tab called `Incident_Log`
2. Add the required column headers
3. Connect the Google Sheets OAuth credential
4. Set the sheet ID in the node

---

## 21. Troubleshooting

### Webhook not receiving alerts

Check:

- `ossec.conf` has the correct webhook integration
- `custom-webhook` script exists and is executable
- Wazuh manager has been restarted
- n8n is reachable from the Ubuntu VM network

### VirusTotal returns 401/403

Check:

- API key is valid
- header name is `x-apikey`
- credential is attached correctly

### AbuseIPDB returns 401

Check:

- header name is exactly `Key`
- value is your AbuseIPDB key

### Ollama timeout or connection refused

Check:

```bash
curl http://localhost:11434/api/tags
ollama list
```

Make sure the model is actually pulled.

### Duplicate alerts still processing

Increase the dedup window in the configuration node.

### Discord report is too long

Discord has a message length limit. Keep the AI response concise.

### SSH node fails

Check:

- host
- username
- password
- port 22
- firewall rules

### AI output looks like JSON instead of a report

Update the prompt to say:

- no JSON
- no parameters object
- no tool calls
- plain readable text only

---

## 22. Useful commands cheat sheet

### Wazuh service

```bash
sudo systemctl status wazuh-manager
sudo systemctl restart wazuh-manager
sudo systemctl stop wazuh-manager
sudo systemctl start wazuh-manager
```

### Logs

```bash
sudo tail -f /var/ossec/logs/ossec.log
sudo tail -n 20 /var/ossec/logs/ossec.log
```

### SSH test

```powershell
ssh zaidzyy@192.168.13.133
```

### Check webhook from Ubuntu to Windows

```bash
curl -X POST http://192.168.13.1:5678/webhook/reportlvl12 \
  -H "Content-Type: application/json" \
  -d '{"test":"ubuntu"}'
```

### Install Python requests package

```bash
sudo apt install python3-requests -y
```

---

## 23. Recommended production checklist

Before treating the workflow as “done”:

- [ ] Wazuh manager running
- [ ] Wazuh agent active
- [ ] n8n webhook triggers successfully
- [ ] Discord receives reports
- [ ] VirusTotal and AbuseIPDB credentials work
- [ ] Ollama model responds correctly
- [ ] AI reports are readable and concise
- [ ] Deduplication is behaving correctly
- [ ] AI prompt outputs text, not JSON
- [ ] Snapshot or backup taken

---

## 24. Final notes

This project became much more reliable after the following real-world fixes:

- using the correct VM IP instead of localhost
- creating a real Wazuh integration script
- installing `python3-requests` instead of using `pip`
- adjusting the AI prompt to force text output
- testing with real failed SSH login events
- keeping the architecture modular between incident and vulnerability workflows

The result is a practical, local, AI-assisted SOC pipeline suitable for demos, lab work, and portfolio presentation.


---
