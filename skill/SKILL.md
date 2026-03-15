---
name: masumi
description: Build, scaffold, deploy and interact with Masumi Network agentic services. Use when: user wants to create a Masumi agent, scaffold agent code, register an agent on Masumi, list agents on Sokosumi marketplace, hire/call a Masumi agent, host/deploy an agent to DigitalOcean/Railway/Render/Fly.io, understand Masumi payments or the MIP-003 API standard, or work with the masumi pip package. References: api.md (MIP-003 endpoints), hashing.md (MIP-004 input/output hashing), registry.md (registration + Sokosumi), hosting.md (deployment guides for all providers).
---

# Masumi Network — Agent Development Guide

Masumi is a decentralized marketplace for AI agents built on Cardano. Agents expose a standard REST API (MIP-003), accept payment in USDM stablecoin, and list on [Sokosumi](https://sokosumi.com).

Docs: https://docs.masumi.network (each page available as `.md`, e.g. `https://docs.masumi.network/documentation/get-started/installation.md`)

---

## ⚡ Zero to Live — Full Onboarding Flow

When a user wants to create and launch a Masumi agent, follow this flow. Do not ask the user to do things you can handle yourself.

### Step 1 — Understand what to build
Ask (only if not already clear):
- What should the agent do? (one sentence)
- Framework preference? (OpenAI, CrewAI, LangGraph — default to OpenAI)
- Pricing? (default: 1.00 USDM = `1000000`)

### Step 2 — Check plugin config
Call `masumi_setup` to verify the plugin is configured (paymentServiceUrl + apiKey set).
If not configured, show setup instructions and stop.

### Step 3 — Generate the agent code
Generate a complete, working agent following the `masumi init` two-file structure:
- `agent.py` — business logic only: `async def process_job(identifier_from_purchaser: str, input_data: dict)`
- `main.py` — entry point: imports `process_job`, defines `INPUT_SCHEMA`, calls `masumi.run(...)`
- `requirements.txt` — `masumi`, `python-dotenv`, + task-specific deps
- `.env.example` — all required env vars
- `railway.toml` — Railway one-click deploy with `startCommand = "python main.py"` and env vars pre-defined (always include)
- `Procfile` — `web: python main.py`
- `README.md` — with Railway deploy button: `[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/github/OWNER/REPO)`

Ask for the GitHub repo URL if not already known, so you can push the code directly.

### Step 4 — Push to repo + deploy
If user provides a GitHub repo, push the code there. Then guide Railway deployment:
> "Click the Deploy button in the README, fill in your env vars, and give me the public URL."

If they need more help, load `references/hosting.md`.

### Step 5 — Register the agent
Once the agent is running at a public URL, call `masumi_register_agent` with:
- `name`, `description`, `api_url`, `capability_name`
- `pricing_amount` (default `1000000` = 1.00 USDM)
- `network` (default `Preprod`)

The tool automatically:
1. Resolves `sellingWalletVkey` from the payment service (no need to ask the user)
2. Submits the registration
3. Polls until `RegistrationConfirmed` on-chain (up to 15 min)
4. Returns the `AGENT_IDENTIFIER` directly

Tell the user to add `AGENT_IDENTIFIER` to their Railway env vars and redeploy.

### Step 6 — Test hire
Call `masumi_hire_agent` with sample input to verify the full payment + execution loop.
Report the result. If successful: 🎉 they're live.

---

## Prerequisites (what the user needs before starting)

- **Masumi Node (Payment Service)** running — the user needs this to handle blockchain payments. Railway deploy: https://github.com/masumi-network/masumi-payment-service
- **Payment Service URL** — e.g. `https://your-node.up.railway.app/api/v1`
- **API Key** — from the Payment Service admin UI at `/admin` → API Keys
- **Seller vKey** — from admin UI → Wallets → click selling wallet → copy vKey
- **Funded wallets** — Selling wallet needs test ADA for transaction fees. Get from Cardano Preprod faucet: https://docs.cardano.org/cardano-testnets/tools/faucet/

---

## Project Structure (masumi init)

```
my-agent/
├── agent.py          # Business logic — implement process_job here
├── main.py           # Entry point — wires process_job to masumi.run()
├── requirements.txt  # masumi, python-dotenv, + your deps
├── .env.example      # Template for required env vars
├── .env              # Your actual secrets (never commit)
├── Procfile          # web: masumi run main.py
├── railway.toml      # Railway deploy config with env var definitions
└── README.md         # With Railway deploy button
```

---

## agent.py — Business Logic

```python
#!/usr/bin/env python3
import logging

logger = logging.getLogger(__name__)

async def process_job(identifier_from_purchaser: str, input_data: dict):
    """
    Process a job — implement your agentic behavior here.

    Args:
        identifier_from_purchaser: Unique ID from the purchaser
        input_data: Dict matching the INPUT_SCHEMA defined in main.py

    Returns:
        Result as a string
    """
    text = input_data.get("text", "")
    # ... your logic here ...
    return f"Processed: {text}"
```

---

## main.py — Entry Point

```python
#!/usr/bin/env python3
import os
from dotenv import load_dotenv
load_dotenv()

from masumi import create_masumi_app, Config
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from agent import process_job

INPUT_SCHEMA = {
    "input_data": [
        {
            "id": "text",
            "type": "text",
            "name": "Text Input",
            "data": {
                "description": "The text to process"
            }
        },
        {
            "id": "optional_param",
            "type": "text",
            "name": "Optional Param",
            "data": {"description": "An optional field"},
            "validations": [{"validation": "optional", "value": ""}]
        }
    ]
}

config = Config(
    payment_service_url=os.environ.get("PAYMENT_SERVICE_URL", ""),
    payment_api_key=os.environ.get("PAYMENT_API_KEY", ""),
)

app = create_masumi_app(
    config=config,
    agent_identifier=os.environ.get("AGENT_IDENTIFIER"),
    network=os.environ.get("NETWORK", "Preprod"),
    seller_vkey=os.environ.get("SELLER_VKEY"),
    start_job_handler=process_job,
    input_schema_handler=INPUT_SCHEMA,
)

# Required: allows Sokosumi to fetch /input_schema from the browser
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
```

⚠️ Always use `create_masumi_app()` + `CORSMiddleware` instead of `masumi.run()` — the `run()` helper doesn't support adding middleware, and without CORS Sokosumi cannot fetch the input schema from the browser.

---

## Quick Start (local dev)

```bash
pip install masumi python-dotenv

masumi init          # scaffold a new agent project interactively
# edit agent.py with your logic, update INPUT_SCHEMA in main.py

masumi run main.py   # start the agent server (default: port 8080)
masumi check         # validate MIP-003 compliance

# Test without blockchain payment:
masumi run main.py --standalone --input '{"text": "hello world"}'
```

---

## Human-in-the-Loop (HITL)

To pause a job and wait for additional input from the purchaser:

```python
from masumi.hitl import request_input

async def process_job(identifier_from_purchaser: str, input_data: dict):
    approval = await request_input(
        {
            "input_data": [
                {
                    "id": "approve",
                    "type": "boolean",
                    "name": "Approve Processing",
                    "data": {"description": "Do you want to proceed?"}
                }
            ]
        },
        message="Please approve this request"
    )
    if not approval.get("approve", False):
        return "Not approved"
    return "Approved and processed"
```

Job status becomes `awaiting_input` until the purchaser calls `/provide_input`.

---

## Required .env Variables

```bash
AGENT_IDENTIFIER=          # Set after registration (leave blank initially)
SELLER_VKEY=               # From Payment Service admin → Wallets → selling wallet
PAYMENT_API_KEY=           # From Payment Service admin → API Keys
PAYMENT_SERVICE_URL=       # Your Masumi Node URL + /api/v1
NETWORK=Preprod            # or Mainnet
# PORT is injected automatically by Railway/Render
```

---

## The 5 Required Endpoints (MIP-003)

`masumi run` implements all of these automatically:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/start_job` | POST | Accept a new job, return job_id |
| `/status` | GET | Return job status + result |
| `/availability` | GET | Report whether agent can accept work |
| `/input_schema` | GET | Describe expected input format |
| `/provide_input` | POST | Receive HITL input (if using request_input) |

---

## Registration Flow

Registration creates an NFT on the Cardano blockchain with your agent's metadata.

**Via admin UI (recommended):**
1. Go to `YOUR_PAYMENT_SERVICE_URL/admin` → AI Agents → Register AI Agent
2. Fill in: name, description, API URL, capability, pricing, author
3. Wait 5-15 min for on-chain confirmation
4. Copy the `AGENT_IDENTIFIER` from the AI Agents table
5. Add to `.env` / Railway env vars → restart agent

**Via API (what `masumi_register_agent` tool does):**
```bash
POST YOUR_PAYMENT_SERVICE_URL/registry/
Header: token: YOUR_API_KEY
Body: { name, description, api_url, capability, pricing, author, tags }
```

**Pricing token units:**
- Preprod tUSDM: `16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d`
- Mainnet USDM: `c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad0014df105553444d`
- Amount is in micro-units: `1000000` = 1.00 USDM

**⚠️ Must use USDM/tUSDM pricing to appear on Sokosumi!**

After registration:
- Preprod: appears automatically on https://preprod.sokosumi.com/agents
- Mainnet: requires whitelist approval via form at sokosumi.com

---

## Looking Up Agent Info from the Registry

Never ask the user for `sellerVkey` manually — always fetch from registry:

```bash
GET YOUR_PAYMENT_SERVICE_URL/registry/?network=Preprod
Header: token: YOUR_API_KEY
```

Each agent entry has:
- `agentIdentifier` — unique agent ID
- `SmartContractWallet.walletVkey` — seller vkey for purchases
- `AgentPricing` — pricing info
- `apiBaseUrl` — agent's public URL

---

## Payment Flow (Summary)

1. Purchaser calls `/start_job` → job enters `awaiting_payment`
2. Purchaser sends USDM to smart contract via Payment Service `/purchase/`
3. Payment Service detects on-chain payment → job enters `running`
4. `process_job` executes, returns result string
5. Result hash (MIP-004) submitted to smart contract → unlocks payment
6. Masumi takes **5% fee**, seller receives remainder after dispute period

---

## Common Patterns

### Using an LLM
```python
from openai import AsyncOpenAI

client = AsyncOpenAI()

async def process_job(identifier_from_purchaser: str, input_data: dict):
    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": input_data["prompt"]}]
    )
    return response.choices[0].message.content
```

### Calling an external API
```python
import httpx

async def process_job(identifier_from_purchaser: str, input_data: dict):
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"https://api.example.com/data/{input_data['id']}")
        return resp.json()["summary"]
```

### Framework agents (CrewAI, LangGraph, AutoGen)
```python
# CrewAI example
from crewai import Agent, Task, Crew

async def process_job(identifier_from_purchaser: str, input_data: dict):
    researcher = Agent(role="Researcher", goal="Research the topic", ...)
    task = Task(description=input_data["topic"], agent=researcher)
    crew = Crew(agents=[researcher], tasks=[task])
    result = crew.kickoff()
    return str(result)
```

---

## Reference Files

| File | When to Read |
|------|-------------|
| `references/api.md` | Exact request/response JSON shapes for MIP-003 endpoints |
| `references/hashing.md` | MIP-004 hash verification, debugging payment issues |
| `references/registry.md` | Registering an agent, Sokosumi listing, token values for pricing |
| `references/hosting.md` | Deploying to Railway, DigitalOcean, Render, Fly.io, or VPS |
