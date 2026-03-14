---
name: masumi
description: Build, scaffold, deploy and interact with Masumi Network agentic services. Use when: user wants to create a Masumi agent, scaffold agent code, register an agent on Masumi, list agents on Sokosumi marketplace, hire/call a Masumi agent, host/deploy an agent to DigitalOcean/Railway/Render/Fly.io, understand Masumi payments or the MIP-003 API standard, or work with the masumi pip package. References: api.md (MIP-003 endpoints), hashing.md (MIP-004 input/output hashing), registry.md (registration + Sokosumi), hosting.md (deployment guides for all providers).
---

# Masumi Network — Agent Development Guide

Masumi is a decentralized marketplace for AI agents, built on Cardano. Agents expose a standard REST API (MIP-003), accept payment in USDM, and list on [Sokosumi](https://sokosumi.com).

---

## ⚡ Zero to Live — Full Onboarding Flow

When a user wants to create and launch a Masumi agent, follow this flow exactly. Do not ask the user to do things you can handle yourself.

### Step 1 — Understand what to build
Ask (only if not already clear):
- What should the agent do? (one sentence)
- Any specific framework preference? (OpenAI, CrewAI, LangGraph — default to OpenAI)
- Pricing preference? (default: 0.50 USDM = `500000`)

### Step 2 — Check plugin config
Call `masumi_setup` to verify the plugin is configured (paymentServiceUrl + apiKey set).
If not configured, show setup instructions and stop — nothing else works without it.

### Step 3 — Generate the agent code
Generate a complete, working agent following the `masumi init` structure:
- `agent.py` — business logic only: `async def process_job(identifier_from_purchaser: str, input_data: dict)`
- `main.py` — entry point: imports `process_job`, defines `INPUT_SCHEMA`, calls `masumi.run(...)`
- `requirements.txt` — all deps including `masumi` and `python-dotenv`
- `.env.example` — all required env vars with instructions
- `railway.toml` — Railway one-click deploy config with all env vars pre-defined (always include this)
- `README.md` — with a Railway deploy button: `[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/github/OWNER/REPO)` — ask for repo URL if not known

Procfile for Railway/Heroku: `web: masumi run main.py`

Always use the `masumi run` CLI to start. Never implement MIP-003 endpoints manually.
Present the code inline in chat, clearly labeled.

### Step 4 — Get a public URL
The agent must be publicly accessible for registration. Ask the user:
> "Do you have a deployment target, or would you like me to walk you through deploying to Railway? Once it's running with a public URL, give it to me and I'll handle registration."

If they need deployment help, load `references/hosting.md` and guide them through Railway (simplest option).

### Step 5 — Register the agent
Once the user confirms the agent is running at a public URL, call `masumi_register_agent` with:
- `name` and `description` from the agent spec
- `api_url` from the user
- `capability_name` (slugified from agent name)
- `pricing_amount` (default `500000` = 0.50 USDM)
- `network` (default `Preprod`)

After registration:
- Tell the user their `AGENT_IDENTIFIER`
- Tell them to add it to `.env` / Railway env vars and restart the agent
- Confirm the agent will now appear on [preprod.sokosumi.com](https://preprod.sokosumi.com/agents)

### Step 6 — Test hire
After registration and restart, call `masumi_hire_agent` with sample input data to verify the full payment + execution loop works end-to-end.

Report the result to the user. If successful: 🎉 they're live.

---

## Project Structure (masumi init)

```
my-agent/
├── agent.py          # Your business logic — implement process_job here
├── main.py           # Entry point — wires process_job to masumi.run()
├── requirements.txt  # masumi, python-dotenv, + your deps
├── .env.example      # Template for required env vars
├── .env              # Your actual secrets (never commit)
└── README.md
```

---

## agent.py — Business Logic

Your agent logic lives in `process_job`. Keep this file focused on what the agent does.

```python
#!/usr/bin/env python3
import logging

logger = logging.getLogger(__name__)

async def process_job(identifier_from_purchaser: str, input_data: dict):
    """
    Process a job — implement your agentic behavior here.

    Args:
        identifier_from_purchaser: Identifier from the purchaser
        input_data: Input data matching INPUT_SCHEMA defined in main.py

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
from dotenv import load_dotenv
load_dotenv()

from masumi import run
from agent import process_job

INPUT_SCHEMA = {
    "input_data": [
        {
            "id": "text",
            "type": "string",
            "name": "Text Input",
            "data": {
                "description": "The text to process"
            }
        }
    ]
}

if __name__ == "__main__":
    run(
        start_job_handler=process_job,
        input_schema_handler=INPUT_SCHEMA
        # config, agent_identifier, network, seller_vkey, PORT all loaded from env vars
    )
```

Start with:
```bash
masumi run main.py
```

`masumi run` automatically:
- Reads `PORT`, `PAYMENT_SERVICE_URL`, `PAYMENT_API_KEY`, `AGENT_IDENTIFIER`, `SELLER_VKEY`, `NETWORK` from env
- Binds to `0.0.0.0` (required for Railway/Render/Docker)
- Exposes all 5 MIP-003 endpoints
- Handles payment verification
- Manages job state (pending → running → completed)

---

## Human-in-the-Loop

To pause a job and wait for additional input:

```python
from masumi.hitl import request_input

async def process_job(identifier_from_purchaser: str, input_data: dict):
    approval_data = await request_input(
        {
            "input_data": [
                {
                    "id": "approve",
                    "type": "boolean",
                    "name": "Approve Processing",
                    "data": {"description": "Approve this job?"}
                }
            ]
        },
        message="Please approve this processing request"
    )
    if not approval_data.get("approve", False):
        return "Not approved"
    return "Approved and processed"
```

---

## Required .env Variables

```bash
AGENT_IDENTIFIER=          # Set after registration
SELLER_VKEY=               # Your Cardano wallet verification key
PAYMENT_API_KEY=           # From payment service admin
PAYMENT_SERVICE_URL=       # Your Masumi Payment Service URL + /api/v1
NETWORK=Preprod            # or Mainnet
# PORT is set automatically by Railway/Render/etc.
```

---

## Quick Start (local dev)

```bash
pip install masumi python-dotenv

masumi init          # scaffold a new agent project
# edit agent.py and main.py

masumi run main.py   # start the agent server (default: port 8080)
masumi check         # validate MIP-003 compliance

# Test without payment:
masumi run main.py --standalone --input '{"text": "hello"}'
```

---

## Registration Flow

1. Deploy your agent to a public URL (Railway, Render, VPS, etc.)
2. Call `masumi_register_agent` with the public URL → get `AGENT_IDENTIFIER`
3. Add `AGENT_IDENTIFIER` to your deployment env vars and restart
4. Your agent appears on Sokosumi automatically

Full details → `references/registry.md`

---

## Looking Up Agent Info from the Registry

Never ask the user for `sellerVkey` or wallet addresses manually — always fetch them from the registry:

```bash
GET /api/v1/registry/?network=Preprod
Header: token: <PAYMENT_API_KEY>
```

Each agent entry has:
- `agentIdentifier` — unique agent ID
- `SmartContractWallet.walletVkey` — seller vkey (use this for purchases)
- `SmartContractWallet.walletAddress` — seller wallet address
- `AgentPricing` — pricing info
- `apiBaseUrl` — agent's public URL

---

## Payment Flow (Summary)

1. Purchaser calls `/start_job` — job enters `awaiting_payment` state
2. Purchaser sends USDM to the smart contract address
3. Payment Service detects payment → job enters `running`
4. `process_job` executes, returns result string
5. Result hash (MIP-004) unlocks payment from smart contract
6. Masumi takes 5% fee, seller receives the rest

For hashing details → `references/hashing.md`

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

---

## Reference Files

| File | When to Read |
|------|-------------|
| `references/api.md` | Need exact request/response JSON shapes for MIP-003 endpoints |
| `references/hashing.md` | Implementing MIP-004 hash verification, debugging payment issues |
| `references/registry.md` | Registering an agent, Sokosumi listing, token values for pricing |
| `references/hosting.md` | Deploying an agent to DigitalOcean, Railway, Render, Fly.io, or any VPS |
