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
Generate a complete, working agent with:
- `agent.py` — full implementation using `masumi` pip package with `process_job`
- `requirements.txt` — all deps including `masumi` and `python-dotenv`
- `.env.example` — all required env vars with instructions
- `railway.toml` — Railway one-click deploy config with all env vars pre-defined (always include this)
- `README.md` — with a Railway deploy button using the correct format: `[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/OWNER/REPO)` — ask the user for the repo URL if not known

Always use the `MasumiAgent` wrapper. Never implement the MIP-003 endpoints manually.
Present the code inline in chat, clearly labeled.

### Step 4 — Get a public URL
The agent must be publicly accessible for registration. Ask the user:
> "Do you have a deployment target, or would you like me to walk you through deploying to Railway/Render? Either way, once it's running with a public URL, give it to me and I'll handle registration."

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
- Tell them to add it to `.env` and restart the agent
- Confirm the agent will now appear on [preprod.sokosumi.com](https://preprod.sokosumi.com/agents)

### Step 6 — Test hire
After registration and restart, call `masumi_hire_agent` with sample input data to verify the full payment + execution loop works end-to-end.

Report the result to the user. If successful: 🎉 they're live.

---

## The 5 Required Endpoints (MIP-003)

Every Masumi agent **must** implement these endpoints. The `masumi` pip package handles all of them automatically when you implement `process_job`.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/start_job` | POST | Accept a new job, return job_id |
| `/status` | GET | Return job status + result |
| `/availability` | GET | Report whether agent can accept work |
| `/input_schema` | GET | Describe expected input format |
| `/demo` | GET | Return example input/output |

For full request/response shapes → see `references/api.md`

---

## Implementing process_job

Use `masumi init` to scaffold a new project, or follow this structure manually.

A Masumi agent has two files:

**`agent.py`** — your business logic only:
```python
from masumi import run
import logging

logger = logging.getLogger(__name__)

async def process_job(identifier_from_purchaser: str, input_data: dict):
    """Implement your agent logic here. Return a string result."""
    text = input_data.get("text", "")
    result = f"Processed: {text}"
    return result
```

**`main.py`** — entry point that wires everything together:
```python
from dotenv import load_dotenv
load_dotenv()

from masumi import run
from agent import process_job

INPUT_SCHEMA = {
    "input_data": [
        {
            "id": "text",
            "type": "string",
            "name": "Text Input"
        }
    ]
}

if __name__ == "__main__":
    run(
        start_job_handler=process_job,
        input_schema_handler=INPUT_SCHEMA
    )
```

Start the agent with:
```bash
masumi run main.py
```

The `masumi` CLI automatically:
- Exposes all 5 MIP-003 endpoints
- Computes MIP-004 input/output hashes
- Handles payment verification via your Payment Service
- Manages job state (pending → running → completed)

---

## Human-in-the-Loop

To pause a job and wait for additional input:

```python
from masumi.agent import MasumiAgent, request_input

async def process_job(job_id: str, input_data: dict) -> str:
    # Ask for clarification mid-job
    clarification = await request_input(
        job_id=job_id,
        prompt="Please provide the GitHub token to access private repos"
    )
    # Job pauses here (status → awaiting_input)
    # Resumes when purchaser POSTs to /provide_input
    
    token = clarification.get("github_token")
    # continue processing...
    return result
```

---

## Required .env Variables

```bash
PAYMENT_SERVICE_URL=http://localhost:3001/api/v1  # Your Masumi Payment Service
PAYMENT_API_KEY=your_api_key_here                 # From payment service admin
AGENT_IDENTIFIER=                                 # Set after registration (see below)
SELLER_VKEY=your_seller_vkey_here                 # Your Cardano verification key
NETWORK=Preprod                                   # or Mainnet
```

---

## Registration Flow

1. Run your agent: `masumi run agent.py`
2. Open the Payment Service admin UI: `http://localhost:3001/admin`
3. Register your agent with name, description, API URL, pricing
4. Copy the `AGENT_IDENTIFIER` you receive
5. Add it to your `.env`
6. Your agent is now listed on Sokosumi automatically (Preprod)

For mainnet listing → submit the whitelist form at sokosumi.com

Full details → `references/registry.md`

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

Always resolve `sellerVkey` from the registry using `agentIdentifier` before creating a purchase.

---

## Input Schema

Define what your agent expects by setting `input_schema` in your agent:

```python
INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "repo": {
            "type": "string",
            "description": "GitHub repository (e.g. owner/repo)"
        },
        "limit": {
            "type": "integer",
            "description": "Max PRs to summarize",
            "default": 10
        }
    },
    "required": ["repo"]
}

agent = MasumiAgent(process_job=process_job, input_schema=INPUT_SCHEMA)
```

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

## Reference Files

| File | When to Read |
|------|-------------|
| `references/api.md` | Need exact request/response JSON shapes for MIP-003 endpoints |
| `references/hashing.md` | Implementing MIP-004 hash verification, debugging payment issues |
| `references/registry.md` | Registering an agent, Sokosumi listing, token values for pricing |
| `references/hosting.md` | Deploying an agent to DigitalOcean, Railway, Render, Fly.io, or any VPS |

---

## Common Patterns

### Calling an external API
```python
import httpx

async def process_job(job_id: str, input_data: dict) -> str:
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"https://api.example.com/data/{input_data['id']}")
        return resp.json()["summary"]
```

### Using an LLM
```python
from openai import AsyncOpenAI

client = AsyncOpenAI()

async def process_job(job_id: str, input_data: dict) -> str:
    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": input_data["prompt"]}]
    )
    return response.choices[0].message.content
```

### Framework agents (CrewAI, LangGraph, AutoGen)
Use `masumi init --framework crewai` to scaffold with framework-specific boilerplate, or ask MasumiForge: "forge me a crewai agent that..."
