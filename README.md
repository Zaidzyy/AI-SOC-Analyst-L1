# AI SOC Agent Pro – Autonomous Security Operations Engine

> AI-powered SOC automation system for autonomous L1 triage, threat intelligence enrichment, incident reporting, and vulnerability assessment.

![Workflow](/workflow.png)

## Overview

**AI SOC Agent Pro** is an **AI-powered Security Operations (SOC) automation system** designed to reduce repetitive Tier-1 analyst workload by autonomously investigating high-severity alerts, enriching threat intelligence, retrieving endpoint telemetry, generating structured incident reports, and escalating cases across security platforms.

Built around **Wazuh + n8n + Ollama**, the system combines **deterministic security controls** with **local AI-powered analysis** to reduce alert fatigue while maintaining security-focused safeguards.

Instead of analysts manually pivoting between SIEM dashboards, threat intelligence tools, logs, and case management systems, the workflow automates the repetitive L1 process in seconds.

---

## Key Features

### 🔍 Automated L1 Incident Triage
- Receives **high-severity alerts** from Wazuh
- Automatically normalizes alert data
- Deduplicates repetitive incidents to reduce alert fatigue
- Routes incidents based on operating system and alert type

### 🌍 Multi-Source Threat Intelligence Enrichment
- **VirusTotal** IP reputation analysis
- **AbuseIPDB** confidence scoring
- Unified threat severity assessment
- Multi-source enrichment for higher confidence triage

### 🤖 AI-Powered Incident Analysis
- Secure log retrieval from affected endpoints
- Local **Ollama-based LLM analysis**
- Security-focused log summarization
- Structured incident report generation

### 🛡️ Automated Response & Safeguards
- Configurable IP allowlists
- Automated IP blocking logic
- Input sanitization and validation
- Deterministic safeguards against unsafe execution
- False-positive reduction mechanisms

### 📂 Case Management & Notifications
- Automatic **TheHive case creation**
- Multi-channel alerting:
  - Discord
  - Slack
  - Email
  - Telegram
- Centralized audit logging

### ⚠️ Vulnerability Triage
- Detects vulnerability-based Wazuh alerts
- Parses **CVSS severity**
- Generates AI-powered vulnerability assessment reports
- Provides remediation recommendations

---

## Architecture

```text
                        ┌─────────────────────┐
                        │   Wazuh Alerts      │
                        │ (High Severity)     │
                        └──────────┬──────────┘
                                   │
                                   ▼
                     ┌──────────────────────────┐
                     │ Alert Intake via Webhook │
                     └──────────┬───────────────┘
                                │
                                ▼
                  ┌──────────────────────────────┐
                  │ Input Validation & Sanitization │
                  └──────────┬───────────────────┘
                              │
                              ▼
                    ┌────────────────────────┐
                    │ Alert Deduplication    │
                    └──────────┬─────────────┘
                               │
                               ▼
               ┌────────────────────────────────┐
               │ Threat Intelligence Enrichment │
               │ VirusTotal + AbuseIPDB         │
               └──────────┬─────────────────────┘
                          │
                          ▼
                ┌────────────────────────────┐
                │ OS Detection & Routing     │
                └───────┬─────────┬──────────┘
                        │         │
          ┌─────────────┘         └──────────────┐
          ▼                                      ▼
 ┌────────────────┐                     ┌────────────────┐
 │ Linux/macOS    │                     │ Windows Logs   │
 │ SSH Retrieval  │                     │ PowerShell     │
 └────────┬───────┘                     └────────┬───────┘
          │                                      │
          └────────────────┬─────────────────────┘
                           ▼
                ┌───────────────────────┐
                │ AI Log Analysis       │
                │ (Ollama Local LLM)    │
                └──────────┬────────────┘
                           │
                           ▼
                ┌───────────────────────┐
                │ Incident Report       │
                │ Generation            │
                └──────────┬────────────┘
                           │
                           ▼
          ┌────────────────────────────────────┐
          │ Case Creation + Notifications      │
          │ TheHive / Slack / Discord / Email  │
          └────────────────────────────────────┘
```

---

## Workflow Overview

When a **high-severity alert** is triggered:

1. **Wazuh sends the alert** to the workflow through a webhook.
2. The workflow **normalizes and validates** alert data.
3. Threat indicators are enriched using:
   - **VirusTotal**
   - **AbuseIPDB**
4. The system retrieves **relevant endpoint logs**.
5. **Ollama** analyzes logs and generates:
   - Threat summary
   - Severity assessment
   - MITRE ATT&CK context
   - Recommendations
6. A structured **incident report** is generated.
7. A case is automatically created in **TheHive**.
8. Notifications are sent to the SOC team.
9. Optional **automated IP blocking** occurs if thresholds are met.

---

## Tech Stack

### Security
- Wazuh SIEM
- VirusTotal
- AbuseIPDB
- TheHive
- Threat Intelligence APIs

### AI / LLM
- Ollama
- Mistral / Llama Models
- AI Incident Analysis
- Vulnerability Assessment

### Automation
- n8n
- Event-Driven Workflows
- Webhooks
- Incident Orchestration

### Languages & Scripting
- JavaScript
- Bash
- PowerShell

### Infrastructure
- Linux
- Windows
- macOS
- SSH

---

## Security Design Principles

This project follows a **deterministic-over-probabilistic security model**:

### ✅ AI Assists — It Does Not Control
The LLM provides:
- Contextual analysis
- Threat summaries
- Incident reporting

The LLM **does not**:
- Execute arbitrary commands
- Generate shell execution logic
- Control remediation directly

### ✅ Deterministic Safeguards
- Regex input sanitization
- Allowlisted execution paths
- Configurable whitelisting
- Validation before automated actions
- Deduplication for alert suppression

### ✅ Local-First Privacy
- Runs with **local Ollama models**
- Avoids sending sensitive logs to cloud AI providers
- Better fit for regulated environments

---

## Example Workflow

```text
Brute Force Alert
        ↓
VirusTotal + AbuseIPDB Enrichment
        ↓
SSH Log Retrieval
        ↓
AI Log Summarization
        ↓
Threat Severity Assessment
        ↓
Incident Report Generated
        ↓
TheHive Case Created
        ↓
Slack / Discord / Email Notification
```

---

## Screenshots

### Workflow Overview
![Workflow](assets/workflow.png)

### Incident Report Example
![Incident Report](assets/incident-report.png)

### Vulnerability Assessment Example
![Vulnerability Report](assets/vulnerability-report.png)

---

## Use Cases

- SOC Tier-1 alert automation
- Threat intelligence enrichment
- Security incident triage
- Vulnerability assessment automation
- Alert fatigue reduction
- Security homelab environments
- Security engineering experimentation

---

## Future Improvements

- [ ] MITRE ATT&CK confidence scoring
- [ ] Analyst feedback loop
- [ ] RAG-based incident memory
- [ ] Advanced threat correlation
- [ ] Adaptive risk scoring
- [ ] SOAR playbook expansion

---

## Repository Structure

```text
AI-SOC-Agent-Pro/
│── README.md
│── assets/
│   ├── workflow-banner.png
│   ├── workflow.png
│   ├── incident-report.png
│   └── vulnerability-report.png
│── docs/
│   ├── setup-guide.md
│   └── architecture.md
```

---

## Disclaimer

This project is intended for **security research, SOC automation, and defensive cybersecurity operations only**.

Automated response actions should be validated in **controlled environments** before deployment in production systems.

---

## Author

**Mohammed Zaid**  
Cybersecurity & AI Security Engineer

GitHub: [@Zaidzyy](https://github.com/Zaidzyy)
