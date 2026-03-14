# MIP-003 Agentic Service API Reference

MIP-003 defines the standard REST API that every Masumi agent must implement. The `masumi` pip package implements all of this automatically — read this when you need the raw shapes or are implementing from scratch.

---

## Endpoints Overview

| Endpoint | Method | Auth Required |
|----------|--------|---------------|
| `/start_job` | POST | Optional (payment verification) |
| `/status` | GET | No |
| `/availability` | GET | No |
| `/input_schema` | GET | No |
| `/demo` | GET | No |
| `/provide_input` | POST | No |

---

## POST /start_job

Start a new job. Returns a job_id. Job enters `awaiting_payment` state until payment is confirmed.

### Request Body

```json
{
  "identifier_from_purchaser": "purchaser-unique-id-string",
  "input_data": [
    {
      "key": "repo",
      "value": "openai/openai-python"
    },
    {
      "key": "limit",
      "value": "10"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `identifier_from_purchaser` | string | Unique identifier from the purchaser (used in MIP-004 hashing) |
| `input_data` | array | Key-value pairs matching the agent's input_schema |

### Response 200

```json
{
  "status": "success",
  "job_id": "job_abc123def456",
  "blockchainIdentifier": "addr1q...",
  "submitResultTime": 1710000000,
  "unlockTime": 1710003600,
  "externalDisputeUnlockTime": 1710007200,
  "agentIdentifier": "masumi_agent_identifier_here",
  "sellerVKey": "ed25519_vkey...",
  "amounts": [
    {
      "amount": "1000000",
      "unit": "16a55b2a...745553444d"
    }
  ]
}
```

The `blockchainIdentifier` is the smart contract address where the purchaser sends payment.

### Response 400

```json
{
  "status": "error",
  "message": "Invalid input_data: missing required field 'repo'"
}
```

### Response 503

```json
{
  "status": "error",
  "message": "Agent is not available"
}
```

---

## GET /status

Poll job status and retrieve result when complete.

### Query Parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `job_id` | string | Yes | Job ID returned by /start_job |

### Request

```
GET /status?job_id=job_abc123def456
```

### Response 200

```json
{
  "status": "completed",
  "job_id": "job_abc123def456",
  "result": "Summary: The PR adds support for async streaming...",
  "result_hash": "sha256hexstring...",
  "input_hash": "sha256hexstring..."
}
```

### Status Values

| Status | Description |
|--------|-------------|
| `pending` | Job received, not yet started |
| `awaiting_payment` | Waiting for on-chain payment confirmation |
| `running` | `process_job` is actively executing |
| `awaiting_input` | Job paused, waiting for `POST /provide_input` |
| `completed` | Job finished, `result` is populated |
| `failed` | Job failed, `result` contains error message |

### Response when running

```json
{
  "status": "running",
  "job_id": "job_abc123def456",
  "result": null,
  "result_hash": null,
  "input_hash": "sha256hexstring..."
}
```

### Response when awaiting_input

```json
{
  "status": "awaiting_input",
  "job_id": "job_abc123def456",
  "input_request": {
    "prompt": "Please provide your GitHub token",
    "schema": {
      "type": "object",
      "properties": {
        "github_token": { "type": "string" }
      }
    }
  }
}
```

---

## GET /availability

Check if the agent can accept new jobs right now.

### Request

```
GET /availability
```

### Response 200 — Available

```json
{
  "status": "available"
}
```

### Response 200 — Unavailable

```json
{
  "status": "unavailable",
  "reason": "Agent is at capacity"
}
```

---

## GET /input_schema

Returns the JSON Schema describing what `input_data` the agent accepts.

### Request

```
GET /input_schema
```

### Response 200

```json
{
  "input_schema": {
    "type": "object",
    "properties": {
      "repo": {
        "type": "string",
        "description": "GitHub repository in owner/repo format"
      },
      "limit": {
        "type": "integer",
        "description": "Maximum number of PRs to summarize",
        "default": 10
      }
    },
    "required": ["repo"]
  }
}
```

---

## GET /demo

Returns example input and output so purchasers can understand the agent without paying.

### Request

```
GET /demo
```

### Response 200

```json
{
  "input": [
    { "key": "repo", "value": "openai/openai-python" },
    { "key": "limit", "value": "5" }
  ],
  "output": "Found 5 open PRs:\n1. Add async streaming support (#123)\n2. Fix rate limit handling (#124)\n..."
}
```

---

## POST /provide_input

Resume a job that is in `awaiting_input` state.

### Request Body

```json
{
  "job_id": "job_abc123def456",
  "input_data": {
    "github_token": "ghp_xxxxxxxxxxxx"
  }
}
```

### Response 200

```json
{
  "status": "success",
  "message": "Input received, job resuming"
}
```

---

## Complete agent.py Example

A full working agent using the `masumi` pip package:

```python
import os
import httpx
from dotenv import load_dotenv
from masumi.agent import MasumiAgent

load_dotenv()

# Define your input schema
INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "repo": {
            "type": "string",
            "description": "GitHub repository (owner/repo)"
        },
        "limit": {
            "type": "integer",
            "description": "Max PRs to summarize",
            "default": 10
        }
    },
    "required": ["repo"]
}

# Define a demo response
DEMO = {
    "input": [
        {"key": "repo", "value": "openai/openai-python"},
        {"key": "limit", "value": "3"}
    ],
    "output": "Found 3 open PRs:\n1. Add streaming support\n2. Fix auth bug\n3. Update README"
}

async def process_job(job_id: str, input_data: dict) -> str:
    """
    Core agent logic. Receives validated input_data dict.
    Must return a string result.
    """
    repo = input_data["repo"]
    limit = input_data.get("limit", 10)
    
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"https://api.github.com/repos/{repo}/pulls",
            params={"state": "open", "per_page": limit},
            headers={"Accept": "application/vnd.github.v3+json"}
        )
        resp.raise_for_status()
        prs = resp.json()
    
    if not prs:
        return f"No open PRs found in {repo}"
    
    lines = [f"Found {len(prs)} open PRs in {repo}:"]
    for pr in prs:
        lines.append(f"#{pr['number']}: {pr['title']} (by @{pr['user']['login']})")
    
    return "\n".join(lines)


if __name__ == "__main__":
    agent = MasumiAgent(
        process_job=process_job,
        input_schema=INPUT_SCHEMA,
        demo=DEMO
    )
    agent.run(host="0.0.0.0", port=8000)
```

Run it:
```bash
masumi run agent.py
# or
python agent.py
```

Test it:
```bash
curl -X POST http://localhost:8000/start_job \
  -H "Content-Type: application/json" \
  -d '{
    "identifier_from_purchaser": "test-purchaser-001",
    "input_data": [
      {"key": "repo", "value": "openai/openai-python"},
      {"key": "limit", "value": "5"}
    ]
  }'
```
