import type { PluginApi } from "openclaw";

export default function (api: PluginApi) {

  // ── List Agents ────────────────────────────────────────────────────────────
  api.registerTool({
    name: "masumi_list_agents",
    description: "List available AI agents on the Masumi/Sokosumi marketplace. Use when the user wants to browse, discover, or find Masumi agents by capability or tag.",
    parameters: {
      type: "object",
      properties: {
        capability: {
          type: "string",
          description: "Filter by capability name (optional)"
        },
        limit: {
          type: "number",
          description: "Max results to return (default: 10)"
        },
        network: {
          type: "string",
          enum: ["Preprod", "Mainnet"],
          description: "Network to query (default: Preprod)"
        }
      }
    },
    async execute(_id: string, params: any) {
      const cfg = api.config as any;
      const paymentServiceUrl = cfg?.paymentServiceUrl || "https://payment.masumi.network/api/v1";
      const apiKey = cfg?.apiKey || "";
      const network = params.network || cfg?.network || "Preprod";
      const limit = params.limit || 10;

      try {
        const registryUrl = paymentServiceUrl.replace("/api/v1", "") + "/api/v1/registry/";
        const url = new URL(registryUrl);
        url.searchParams.set("network", network);
        if (params.capability) url.searchParams.set("capability", params.capability);
        url.searchParams.set("limit", String(limit));

        const resp = await fetch(url.toString(), {
          headers: { token: apiKey }
        });

        const data = await resp.json() as any;

        if (data.status !== "success") {
          return { content: [{ type: "text", text: `Registry error: ${data.error?.message || "unknown"}` }] };
        }

        const agents = data.data?.Assets || [];
        if (agents.length === 0) {
          return { content: [{ type: "text", text: "No agents found." }] };
        }

        const lines = agents.map((a: any) => {
          const price = a.AgentPricing?.Pricing?.[0];
          const priceStr = price ? `${(parseInt(price.amount) / 1_000_000).toFixed(2)} USDM` : "N/A";
          return `• **${a.name}** [${a.state}]\n  ${a.description?.slice(0, 100)}...\n  Price: ${priceStr} | ID: \`${a.agentIdentifier || "pending"}\``;
        });

        return {
          content: [{
            type: "text",
            text: `Found ${agents.length} agents on Masumi (${network}):\n\n${lines.join("\n\n")}`
          }]
        };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Failed to list agents: ${err.message}` }] };
      }
    }
  }, { optional: true });


  // ── Hire Agent ─────────────────────────────────────────────────────────────
  api.registerTool({
    name: "masumi_hire_agent",
    description: "Hire a Masumi agent: start a job, handle blockchain payment, poll for result, and return the output. Use when the user wants to call/run/hire a specific Masumi agent by identifier.",
    parameters: {
      type: "object",
      properties: {
        agentIdentifier: {
          type: "string",
          description: "The agent's identifier from the Masumi registry"
        },
        agentApiUrl: {
          type: "string",
          description: "The agent's API base URL (e.g. https://my-agent.example.com)"
        },
        inputData: {
          type: "object",
          description: "Input data as key-value pairs matching the agent's input schema"
        },
        network: {
          type: "string",
          enum: ["Preprod", "Mainnet"],
          description: "Network to use (default: Preprod)"
        }
      },
      required: ["agentIdentifier", "agentApiUrl", "inputData"]
    },
    async execute(_id: string, params: any) {
      const cfg = api.config as any;
      const paymentServiceUrl = cfg?.paymentServiceUrl;
      const apiKey = cfg?.apiKey;
      const network = params.network || cfg?.network || "Preprod";

      if (!paymentServiceUrl || !apiKey) {
        return {
          content: [{
            type: "text",
            text: "❌ Masumi plugin not configured. Set paymentServiceUrl and apiKey in plugin settings."
          }]
        };
      }

      const purchaserId = generateHexId(26);

      try {
        // Auto-lookup sellerVkey from registry if not provided
        let sellerVkey = params.sellerVkey;
        if (!sellerVkey) {
          const registryUrl = paymentServiceUrl.replace("/api/v1", "") + "/api/v1/registry/";
          const regResp = await fetch(`${registryUrl}?network=${network}`, {
            headers: { token: apiKey }
          });
          const regData = await regResp.json() as any;
          const agent = (regData.data?.Assets || []).find((a: any) => a.agentIdentifier === params.agentIdentifier);
          if (!agent) {
            return { content: [{ type: "text", text: `❌ Agent ${params.agentIdentifier} not found in registry.` }] };
          }
          sellerVkey = agent.SmartContractWallet?.walletVkey;
          if (!sellerVkey) {
            return { content: [{ type: "text", text: `❌ Could not find seller vkey for agent in registry.` }] };
          }
        }
        // Step 1: Start job on the agent
        const inputDataArray = Object.entries(params.inputData).map(([key, value]) => ({
          id: key,
          value: String(value)
        }));

        const startResp = await fetch(`${params.agentApiUrl}/start_job`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            identifier_from_purchaser: purchaserId,
            input_data: inputDataArray
          })
        });

        const startData = await startResp.json() as any;

        if (!startData.job_id && !startData.data?.job_id) {
          return {
            content: [{
              type: "text",
              text: `❌ Failed to start job: ${JSON.stringify(startData)}`
            }]
          };
        }

        const jobId = startData.job_id || startData.data?.job_id;
        const blockchainIdentifier = startData.blockchainIdentifier || startData.data?.blockchainIdentifier;
        const amounts = startData.amounts || startData.data?.amounts || [];
        const submitResultTime = startData.submitResultTime || startData.data?.submitResultTime;
        const unlockTime = startData.unlockTime || startData.data?.unlockTime;
        const externalDisputeUnlockTime = startData.externalDisputeUnlockTime || startData.data?.externalDisputeUnlockTime;
        const payByTime = startData.payByTime || startData.data?.payByTime || Math.floor(Date.now() / 1000) + 600;

        // Step 2: Create purchase via Masumi Payment Service
        const purchaseResp = await fetch(`${paymentServiceUrl}/purchase/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            token: apiKey
          },
          body: JSON.stringify({
            network,
            blockchainIdentifier,
            sellerVkey,
            agentIdentifier: params.agentIdentifier,
            identifierFromPurchaser: purchaserId,
            payByTime,
            submitResultTime,
            unlockTime,
            externalDisputeUnlockTime,
            amounts,
            inputData: inputDataArray
          })
        });

        const purchaseData = await purchaseResp.json() as any;

        if (purchaseData.status !== "success") {
          return {
            content: [{
              type: "text",
              text: `❌ Payment failed: ${purchaseData.error?.message || JSON.stringify(purchaseData)}\n\nJob ID: ${jobId} was started but not paid.`
            }]
          };
        }

        // Step 3: Poll for result (up to 20 attempts, 10s apart = ~3 min)
        let result = null;
        for (let i = 0; i < 20; i++) {
          await sleep(10000);

          const statusResp = await fetch(`${params.agentApiUrl}/status?job_id=${jobId}`);
          const statusData = await statusResp.json() as any;
          const status = statusData.status || statusData.data?.status;
          const jobResult = statusData.result || statusData.data?.result;

          if (status === "completed" && jobResult) {
            result = jobResult;
            break;
          }

          if (status === "failed") {
            return {
              content: [{
                type: "text",
                text: `❌ Job failed: ${jobResult || "unknown error"}`
              }]
            };
          }

          if (status === "awaiting_input") {
            return {
              content: [{
                type: "text",
                text: `⏸ Agent is waiting for additional input. Job ID: ${jobId}\nStatus: ${JSON.stringify(statusData)}`
              }]
            };
          }
        }

        if (!result) {
          return {
            content: [{
              type: "text",
              text: `⏳ Job still running after 3 minutes. Job ID: \`${jobId}\` — check status manually at ${params.agentApiUrl}/status?job_id=${jobId}`
            }]
          };
        }

        return {
          content: [{
            type: "text",
            text: `✅ Job completed!\n\nJob ID: \`${jobId}\`\n\n---\n\n${result}`
          }]
        };

      } catch (err: any) {
        return {
          content: [{
            type: "text",
            text: `❌ Error: ${err.message}`
          }]
        };
      }
    }
  }, { optional: true });

}

// ── Helpers ────────────────────────────────────────────────────────────────
function generateHexId(length: number): string {
  const chars = "0123456789abcdef";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
