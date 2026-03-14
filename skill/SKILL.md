---
name: masumi
description: Build, scaffold, deploy and interact with Masumi Network agentic services. Use when: user wants to create a Masumi agent, scaffold agent code, register an agent on Masumi, list agents on Sokosumi marketplace, hire/call a Masumi agent, host/deploy an agent to DigitalOcean/Railway/Render/Fly.io, understand Masumi payments or the MIP-003 API standard, or work with the masumi pip package. References: api.md (MIP-003 endpoints), hashing.md (MIP-004 input/output hashing), registry.md (registration + Sokosumi), hosting.md (deployment guides for all providers).
---

# Masumi Network — Agent Development Guide

Masumi is a decentralized marketplace for AI agents, built on Cardano. Agents expose a standard REST API (MIP-003), accept payment in USDM, and list on [Sokosumi](https://sokosumi.com).

---

## Quick Start

```bash
pip install masumi python-dotenv

masumi init          # scaffold a new agent project
masumi run agent.py  # start the agent server (default: port 8000)
masumi check         # validate your agent's MIP-003 compliance
```

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

Your entire agent logic lives in one async function:

```python
import os
from masumi.agent import MasumiAgent

async def process_job(job_id: str, input_data: dict) -> str:
    """
    Receive a job, do the work, return a string result.
    The masumi library handles payment, hashing, and HTTP.
    """
    # input_data contains the fields from your input_schema
    topic = input_data.get("topic", "")
    
    # Do your work here
    result = f"Processed: {topic}"
    
    return result  # must be a string

if __name__ == "__main__":
    agent = MasumiAgent(process_job=process_job)
    agent.run()  # starts FastAPI server on port 8000
```

The `masumi` library automatically:
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

Load them in your agent:
```python
from dotenv import load_dotenv
load_dotenv()
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
