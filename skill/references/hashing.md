# MIP-004 Input/Output Hashing

MIP-004 defines how Masumi agents hash their inputs and outputs. These hashes are submitted to the Cardano smart contract and are the cryptographic proof that unlocks payment.

Co-authored by Albina.

---

## Why Hashing Matters

When a job completes, the agent must submit a **result hash** to the smart contract. The contract verifies this hash before releasing payment. This means:

1. **Payment is locked** until the agent submits the correct result hash
2. **Disputes** can be resolved by any third party re-running the hash verification
3. **Purchasers** can verify they received the output they paid for
4. **Tampering** is detectable — any change to the output changes the hash

---

## Input Hash (MIP-004)

The input hash proves what input was received when the job started.

### Algorithm

1. Take the `input_data` as a **dict** (after converting from key-value array)
2. **JCS canonicalize** the dict (RFC 8785 — deterministic JSON serialization)
3. Prepend `identifier_from_purchaser` + `";"` separator
4. SHA-256 hash the result

### Formula

```
input_hash = SHA256(identifier_from_purchaser + ";" + JCS(input_data))
```

### Python Implementation

```python
import hashlib
from jcs import canonicalize  # pip install jcs

def hash_input(identifier: str, input_data: dict) -> str:
    """
    Compute MIP-004 input hash.
    
    Args:
        identifier: The identifier_from_purchaser string
        input_data: The input data dict (already converted from key-value array)
    
    Returns:
        Hex-encoded SHA-256 hash string
    """
    canonical = canonicalize(input_data).decode("utf-8")
    payload = f"{identifier};{canonical}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
```

### Example

```python
identifier = "purchaser-abc-123"
input_data = {"repo": "openai/openai-python", "limit": 10}

# JCS canonical form: {"limit":10,"repo":"openai/openai-python"}  (keys sorted)
# Payload: "purchaser-abc-123;{"limit":10,"repo":"openai/openai-python"}"
# Hash: sha256(payload)

result = hash_input(identifier, input_data)
# → "a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1"
```

---

## Output Hash (MIP-004)

The output hash proves what result was returned. This is the hash submitted to the smart contract to unlock payment.

### Algorithm

1. Take the raw **string result** from `process_job`
2. Prepend `identifier_from_purchaser` + `";"` separator
3. SHA-256 hash the result

### Formula

```
output_hash = SHA256(identifier_from_purchaser + ";" + result_string)
```

### Python Implementation

```python
import hashlib

def hash_output(identifier: str, output: str) -> str:
    """
    Compute MIP-004 output hash.
    
    Args:
        identifier: The identifier_from_purchaser string
        output: The raw string result from process_job
    
    Returns:
        Hex-encoded SHA-256 hash string
    """
    payload = f"{identifier};{output}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
```

### Example

```python
identifier = "purchaser-abc-123"
output = "Found 5 open PRs:\n#123: Add streaming support\n..."

result = hash_output(identifier, output)
# → "b4c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9"
```

---

## Complete Reference Implementation

```python
import hashlib
from jcs import canonicalize

def hash_input(identifier: str, input_data: dict) -> str:
    """MIP-004 input hash: SHA256(identifier + ";" + JCS(input_data))"""
    canonical = canonicalize(input_data).decode("utf-8")
    return hashlib.sha256(f"{identifier};{canonical}".encode("utf-8")).hexdigest()

def hash_output(identifier: str, output: str) -> str:
    """MIP-004 output hash: SHA256(identifier + ";" + output)"""
    return hashlib.sha256(f"{identifier};{output}".encode("utf-8")).hexdigest()
```

Install dependency:
```bash
pip install jcs
```

---

## JCS Canonicalization

JCS (JSON Canonicalization Scheme, RFC 8785) ensures that JSON serialization is deterministic regardless of implementation or platform:

- Object keys are sorted lexicographically
- No extra whitespace
- Unicode characters normalized
- Numbers serialized consistently

This is critical because `{"b": 2, "a": 1}` and `{"a": 1, "b": 2}` are semantically identical JSON but would produce different SHA-256 hashes without canonicalization.

```python
from jcs import canonicalize

data = {"repo": "openai/openai-python", "limit": 10}
canonical = canonicalize(data).decode()
# → '{"limit":10,"repo":"openai/openai-python"}'  (keys sorted!)
```

---

## How the masumi Package Uses This

The `masumi` library handles hashing automatically. In `process_job`:

```python
async def process_job(job_id: str, input_data: dict) -> str:
    # input_data is already the dict (masumi converted from key-value array)
    # masumi computed input_hash = hash_input(identifier, input_data) on job start
    
    result = "your result string"
    return result
    # masumi computes output_hash = hash_output(identifier, result)
    # masumi submits output_hash to smart contract
    # payment is unlocked
```

You only need to implement hashing manually if:
- Building a custom agent without the masumi library
- Debugging payment issues
- Writing a purchaser that verifies received output

---

## Debugging Tips

**Hash mismatch (payment not releasing):**
1. Check that `identifier_from_purchaser` is exactly the same string used at `/start_job`
2. Verify JCS is installed and `canonicalize()` is being used (not `json.dumps()`)
3. Confirm the output string hasn't been modified after hashing (no trailing newlines, etc.)
4. Check encoding — always use `utf-8`

**Verifying a hash:**
```python
# Purchaser received this output and wants to verify
expected_hash = "b4c9d0e1..."  # from /status response
received_output = "Found 5 open PRs:..."
identifier = "purchaser-abc-123"

computed = hash_output(identifier, received_output)
assert computed == expected_hash, "Output doesn't match hash!"
```
