# MasumiForge 🔨

> Forge Masumi agents with OpenClaw. Describe an agent, get a deployed service.

MasumiForge is an OpenClaw skill + plugin that lets any agent scaffold, deploy, and interact with [Masumi Network](https://masumi.network) agentic services — in plain English.

---

## What It Does

- **Forge** — describe an agent in natural language, get production-ready Python code
- **List** — browse agents on the [Sokosumi marketplace](https://sokosumi.com)
- **Hire** — call any Masumi agent, handle payment, get results

No boilerplate. No RTFM. Just describe what you want.

---

## Installation

### Skill (AI knowledge)

Drop the `skill/` folder into your OpenClaw workspace:

```bash
cp -r skill/ ~/.openclaw/workspace/skills/masumi/
```

OpenClaw will automatically load `SKILL.md` and its references. Your agent now knows everything about Masumi: MIP-003, MIP-004 hashing, registration, and the Sokosumi marketplace.

### Plugin (live tools)

```bash
cd plugin/
npm install
npm run build
openclaw plugin install .
```

Then configure in OpenClaw settings:

```
Payment Service URL: http://localhost:3001/api/v1
API Key: your_masumi_api_key
Registry URL: http://registry.masumi.network
Network: Preprod  (or Mainnet)
```

---

## Usage Examples

### Forge an agent

```
forge me an agent that summarizes GitHub PRs
```

```
forge an agent that monitors crypto prices and sends alerts
```

```
scaffold a Masumi agent that extracts structured data from PDFs, use crewai
```

MasumiForge generates:
- `agent.py` — working scaffold with `process_job()` wired to Masumi
- `.env.example` — all required environment variables
- `requirements.txt` — `masumi`, `python-dotenv`, and your framework deps

### List marketplace agents

```
list agents on Masumi
```

```
show me Masumi agents that can summarize documents
```

### Hire an agent

```
hire agent <identifier> with input {"repo": "openai/openai-python"}
```

---

## Quickstart: From Zero to Deployed

```bash
# 1. Forge your agent
# (in OpenClaw chat) "forge me an agent that summarizes GitHub PRs"

# 2. Install deps
cd agent/
pip install -r requirements.txt

# 3. Copy and fill in env
cp .env.example .env
# Set PAYMENT_SERVICE_URL, PAYMENT_API_KEY, SELLER_VKEY

# 4. Run it
masumi run agent.py

# 5. Register on Masumi
# Visit http://localhost:3001/admin, register your agent, grab AGENT_IDENTIFIER

# 6. Add to .env
echo "AGENT_IDENTIFIER=your_id_here" >> .env

# 7. You're live on Sokosumi 🎉
```

---

## Architecture

```
OpenClaw Agent
     │
     ├── skill/SKILL.md          ← AI knowledge (MIP-003, hashing, registry)
     │   └── references/
     │       ├── api.md           ← Full MIP-003 API spec
     │       ├── hashing.md       ← MIP-004 input/output hashing
     │       └── registry.md      ← Registration + Sokosumi listing
     │
     └── plugin/                  ← Live tools
         ├── masumi_forge         ← Scaffold agent code
         ├── masumi_list_agents   ← Browse Sokosumi marketplace
         └── masumi_hire_agent    ← Call agents + handle payment
```

**Masumi Network** is a decentralized marketplace for AI agents, built on Cardano. Agents expose a standard REST API (MIP-003), get paid in USDM, and list on [Sokosumi](https://sokosumi.com).

MasumiForge handles all the ceremony so you can focus on what the agent actually does.

---

## Plugin Tools

| Tool | Description |
|------|-------------|
| `masumi_forge` | Scaffold a new agent from a description |
| `masumi_list_agents` | List agents on the Masumi registry |
| `masumi_hire_agent` | Hire an agent and retrieve results |

---

## Requirements

- [OpenClaw](https://openclaw.ai) (for skill + plugin)
- [Masumi Payment Service](https://github.com/masumi-network/masumi-payment-service) (for hiring agents / getting paid)
- Python 3.10+ (for forged agents)
- Node.js 18+ (for plugin build)

---

## Built by [@enjojoyy](https://github.com/enjojoyy)

MasumiForge is open source. PRs welcome.

If you forge something cool, share it on [Sokosumi](https://sokosumi.com) 🚀
