/**
 * masumi_hire_agent tool
 * Hires a Masumi agent: looks up payment info, starts a job, polls for result.
 */

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 10;

/** Sleep helper */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Convert a plain object to the key-value array format Masumi expects.
 */
function toKVArray(obj: Record<string, any>): Array<{ key: string; value: string }> {
  return Object.entries(obj).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
}

/**
 * Look up agent payment information and API URL from the Masumi registry.
 */
async function getAgentInfo(
  registryUrl: string,
  agentIdentifier: string
): Promise<{ apiUrl: string; amounts: any[]; sellerVKey?: string } | null> {
  try {
    const response = await fetch(
      `${registryUrl}/api/v1/registry-entry/${agentIdentifier}`,
      { method: "GET", headers: { "Content-Type": "application/json" } }
    );

    if (!response.ok) return null;

    const data = (await response.json()) as any;
    const entry = data.registryEntry || data.entry || data;

    return {
      apiUrl: entry.apiUrl || entry.api_url || entry.serviceUrl || "",
      amounts: entry.pricing || entry.amounts || [],
      sellerVKey: entry.sellerVKey || entry.seller_vkey,
    };
  } catch {
    return null;
  }
}

/**
 * Trigger payment via the Masumi Payment Service (if configured).
 */
async function triggerPayment(
  paymentServiceUrl: string,
  apiKey: string,
  jobId: string,
  agentIdentifier: string,
  blockchainIdentifier: string,
  amounts: any[]
): Promise<string | null> {
  try {
    const response = await fetch(`${paymentServiceUrl}/purchase/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        agentIdentifier,
        jobId,
        blockchainIdentifier,
        amounts,
      }),
    });

    const data = (await response.json()) as any;
    return data.purchaseId || data.transactionId || null;
  } catch {
    return null;
  }
}

export async function hireAgent(params: any, config: any): Promise<any> {
  const { agentIdentifier, inputData } = params;
  const registryUrl = config?.registryUrl || "http://registry.masumi.network";
  const paymentServiceUrl = config?.paymentServiceUrl;
  const apiKey = config?.apiKey;

  const lines: string[] = [];

  // ── Step 1: Look up agent info ──────────────────────────────────────────
  lines.push(`🔍 Looking up agent \`${agentIdentifier}\`...`);

  const agentInfo = await getAgentInfo(registryUrl, agentIdentifier);

  let agentApiUrl: string;
  let agentAmounts: any[] = [];

  if (!agentInfo || !agentInfo.apiUrl) {
    lines.push(
      `⚠️  Could not resolve agent API URL from registry. ` +
        `Attempting to use agentIdentifier as URL fallback...`
    );
    // Fallback: maybe the identifier IS the URL
    agentApiUrl = agentIdentifier.startsWith("http") ? agentIdentifier : "";

    if (!agentApiUrl) {
      return {
        content: [
          {
            type: "text",
            text:
              lines.join("\n") +
              "\n\n❌ Could not find agent. Make sure the identifier is correct and the registry is reachable.",
          },
        ],
      };
    }
  } else {
    agentApiUrl = agentInfo.apiUrl;
    agentAmounts = agentInfo.amounts;
    lines.push(`✅ Found agent at: ${agentApiUrl}`);
    if (agentAmounts.length > 0) {
      const p = agentAmounts[0];
      lines.push(`   Price: ${p.amount} ${p.unit}`);
    }
  }

  // ── Step 2: Start the job ──────────────────────────────────────────────
  lines.push(`\n🚀 Starting job...`);

  const purchaserId = `openclaw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const inputKV = toKVArray(inputData);

  let jobId: string;
  let blockchainIdentifier: string | undefined;
  let startJobAmounts: any[] = agentAmounts;

  try {
    const startResponse = await fetch(`${agentApiUrl}/start_job`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier_from_purchaser: purchaserId,
        input_data: inputKV,
      }),
    });

    const startData = (await startResponse.json()) as any;

    if (!startResponse.ok || startData.status === "error") {
      return {
        content: [
          {
            type: "text",
            text:
              lines.join("\n") +
              `\n\n❌ Failed to start job: ${startData.message || startResponse.statusText}`,
          },
        ],
      };
    }

    jobId = startData.job_id;
    blockchainIdentifier = startData.blockchainIdentifier;
    if (startData.amounts) startJobAmounts = startData.amounts;

    lines.push(`✅ Job started: \`${jobId}\``);
    if (blockchainIdentifier) {
      lines.push(`   Payment address: \`${blockchainIdentifier}\``);
    }
    if (startJobAmounts.length > 0) {
      const a = startJobAmounts[0];
      lines.push(`   Amount due: ${a.amount} (unit: ${a.unit?.slice(0, 16)}...)`);
    }
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: lines.join("\n") + `\n\n❌ Network error starting job: ${err.message}`,
        },
      ],
    };
  }

  // ── Step 3: Trigger payment if configured ─────────────────────────────
  if (paymentServiceUrl && apiKey && blockchainIdentifier) {
    lines.push(`\n💳 Triggering payment via Payment Service...`);
    const purchaseId = await triggerPayment(
      paymentServiceUrl,
      apiKey,
      jobId,
      agentIdentifier,
      blockchainIdentifier,
      startJobAmounts
    );
    if (purchaseId) {
      lines.push(`✅ Payment initiated: \`${purchaseId}\``);
    } else {
      lines.push(
        `⚠️  Payment trigger failed or returned no ID. ` +
          `You may need to send payment manually to: \`${blockchainIdentifier}\``
      );
    }
  } else {
    lines.push(
      `\n⚠️  Payment Service not configured. To pay automatically, set paymentServiceUrl and apiKey in plugin settings.`
    );
    if (blockchainIdentifier) {
      lines.push(`   Manual payment address: \`${blockchainIdentifier}\``);
    }
  }

  // ── Step 4: Poll for result ────────────────────────────────────────────
  lines.push(`\n⏳ Polling for result (up to ${MAX_POLLS} attempts)...`);

  let lastStatus = "";
  let result: string | null = null;

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);

    try {
      const statusResponse = await fetch(
        `${agentApiUrl}/status?job_id=${encodeURIComponent(jobId)}`,
        { method: "GET" }
      );

      const statusData = (await statusResponse.json()) as any;
      const status: string = statusData.status || "unknown";

      if (status !== lastStatus) {
        lines.push(`   [${i + 1}/${MAX_POLLS}] Status: ${status}`);
        lastStatus = status;
      }

      if (status === "completed") {
        result = statusData.result || "No result content";
        lines.push(`\n✅ Job completed!`);
        lines.push(`\n**Result:**\n${result}`);
        if (statusData.result_hash) {
          lines.push(`\n*Result hash (MIP-004): \`${statusData.result_hash}\`*`);
        }
        break;
      }

      if (status === "failed") {
        lines.push(
          `\n❌ Job failed: ${statusData.result || statusData.message || "Unknown error"}`
        );
        break;
      }

      if (status === "awaiting_input") {
        const prompt = statusData.input_request?.prompt || "Additional input required";
        lines.push(
          `\n🛑 Job paused — agent requires additional input:\n  "${prompt}"\n` +
            `  Use POST /provide_input on the agent to resume.`
        );
        break;
      }

      if (status === "awaiting_payment") {
        lines.push(`   Waiting for payment confirmation on-chain...`);
      }
    } catch (err: any) {
      lines.push(`   [${i + 1}/${MAX_POLLS}] Poll error: ${err.message}`);
    }
  }

  if (!result && lastStatus !== "failed" && lastStatus !== "awaiting_input") {
    lines.push(
      `\n⏱️  Polling timed out after ${MAX_POLLS} attempts. Job is still running.` +
        `\nCheck status manually:\n  \`GET ${agentApiUrl}/status?job_id=${jobId}\``
    );
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}
