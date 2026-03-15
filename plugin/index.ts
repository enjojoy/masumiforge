const SETUP_MESSAGE = `⚙️ **Masumi plugin needs configuration.**

To use Masumi tools, configure the plugin in OpenClaw:

**Option 1 — CLI:**
\`\`\`
openclaw plugins config masumi
\`\`\`

**Option 2 — Settings UI:**
Go to Settings → Plugins → MasumiForge

**Required fields:**
- \`paymentServiceUrl\` — Your Masumi Payment Service URL (e.g. \`https://your-service.up.railway.app/api/v1\`)
- \`apiKey\` — Payment Service API key (from your admin dashboard)

**Optional:**
- \`network\` — \`Preprod\` (default) or \`Mainnet\`

Once configured, try again!`;

function isConfigured(cfg: any): boolean {
  return !!(cfg?.paymentServiceUrl && cfg?.apiKey);
}

export default function (api: any) {

  // ── Register Agent ─────────────────────────────────────────────────────────
  api.registerTool({
    name: "masumi_register_agent",
    description: "Register a new agent on the Masumi Network via the Payment Service API. Use after the agent is deployed and running at a public URL. Returns the agentIdentifier to add to .env.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Human-readable agent name (shown on Sokosumi)"
        },
        description: {
          type: "string",
          description: "What the agent does — one or two sentences"
        },
        api_url: {
          type: "string",
          description: "Public URL where the agent is running (e.g. https://my-agent.up.railway.app)"
        },
        capability_name: {
          type: "string",
          description: "Unique capability slug (e.g. 'ad-copy-forge')"
        },
        capability_version: {
          type: "string",
          description: "Semver version (default: 1.0.0)"
        },
        pricing_amount: {
          type: "number",
          description: "Price in USDM micro-units (default: 500000 = 0.50 USDM)"
        },
        author_name: {
          type: "string",
          description: "Author name or organization"
        },
        author_contact: {
          type: "string",
          description: "Author email or URL (optional)"
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for marketplace discoverability (optional)"
        },
        network: {
          type: "string",
          enum: ["Preprod", "Mainnet"],
          description: "Network to register on (default: Preprod)"
        }
      },
      required: ["name", "description", "api_url", "capability_name"]
    },
    async execute(_id: string, params: any) {
      const cfg = (api.pluginConfig ?? api.config?.plugins?.entries?.masumi?.config ?? {}) as any;

      if (!isConfigured(cfg)) {
        return { content: [{ type: "text", text: SETUP_MESSAGE }] };
      }

      const paymentServiceUrl = cfg.paymentServiceUrl;
      const apiKey = cfg.apiKey;
      const network = params.network || cfg?.network || "Preprod";

      // Token unit for tUSDM (Preprod) or USDM (Mainnet)
      const tokenUnit = network === "Mainnet"
        ? "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad0014df105553444d"
        : "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d";

      // Auto-resolve sellingWalletVkey from payment source if not provided
      let sellingWalletVkey = params.selling_wallet_vkey;
      if (!sellingWalletVkey) {
        try {
          const srcResp = await fetch(`${paymentServiceUrl}/payment-source/`, {
            headers: { token: apiKey }
          });
          const srcData = await srcResp.json() as any;
          const sources = srcData?.data?.PaymentSources || [];
          const preprodSource = sources.find((s: any) => s.network === network);
          sellingWalletVkey = preprodSource?.SellingWallets?.[0]?.walletVkey;
          if (!sellingWalletVkey) {
            return { content: [{ type: "text", text: `❌ Could not find a selling wallet for network "${network}". Please check your Payment Service has a ${network} wallet configured.` }] };
          }
        } catch (err: any) {
          return { content: [{ type: "text", text: `❌ Failed to fetch payment source: ${err.message}` }] };
        }
      }

      const body: any = {
        network,
        name: params.name,
        description: params.description,
        apiBaseUrl: params.api_url,
        sellingWalletVkey,
        Tags: params.tags?.length ? params.tags : ["agent"],
        ExampleOutputs: [{
          name: "Demo Output",
          url: `${params.api_url}/demo`,
          mimeType: "text/plain"
        }],
        Capability: {
          name: params.capability_name,
          version: params.capability_version || "1.0.0"
        },
        AgentPricing: {
          pricingType: "Fixed",
          Pricing: [{
            unit: tokenUnit,
            amount: String(params.pricing_amount ?? 1000000)
          }]
        },
        Author: {
          name: params.author_name || "MasumiForge"
        }
      };

      if (params.author_contact) body.Author.contactEmail = params.author_contact;

      try {
        const resp = await fetch(`${paymentServiceUrl}/registry/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            token: apiKey
          },
          body: JSON.stringify(body)
        });

        const data = await resp.json() as any;

        if (data.status !== "success") {
          return {
            content: [{
              type: "text",
              text: `❌ Registration failed: ${data.error?.message || JSON.stringify(data)}`
            }]
          };
        }

        const registrationId = data.data?.id;
        const agentName = data.data?.name;

        // Poll for agentIdentifier — confirmation takes 5-15 min on Preprod
        // Poll up to 30 times, 30s apart = up to 15 minutes
        let agentIdentifier: string | null = null;
        for (let i = 0; i < 30; i++) {
          await sleep(30000);
          try {
            const checkResp = await fetch(`${paymentServiceUrl}/registry/?network=${network}`, {
              headers: { token: apiKey }
            });
            const checkData = await checkResp.json() as any;
            const agents = checkData?.data?.Assets || [];
            const match = agents.find((a: any) =>
              a.id === registrationId ||
              (a.name === agentName && a.state === "RegistrationConfirmed")
            );
            if (match?.agentIdentifier) {
              agentIdentifier = match.agentIdentifier;
              break;
            }
          } catch {
            // continue polling
          }
        }

        if (agentIdentifier) {
          return {
            content: [{
              type: "text",
              text: `✅ Agent registered and confirmed on Masumi (${network})!\n\n**AGENT_IDENTIFIER:**\n\`\`\`\n${agentIdentifier}\n\`\`\`\n\nAdd this to your Railway env vars (or \`.env\`) and redeploy:\n\`AGENT_IDENTIFIER=${agentIdentifier}\`\n\nView on Sokosumi: https://${network === "Mainnet" ? "" : "preprod."}sokosumi.com/agents`
            }]
          };
        } else {
          return {
            content: [{
              type: "text",
              text: `⏳ Registration submitted but on-chain confirmation is taking longer than expected.\n\nCheck your Payment Service admin UI → AI Agents for the \`AGENT_IDENTIFIER\` once it shows \`RegistrationConfirmed\`.\n\nAgent name: **${agentName}** | Network: ${network}`
            }]
          };
        }
      } catch (err: any) {
        return {
          content: [{
            type: "text",
            text: `❌ Registration error: ${err.message}`
          }]
        };
      }
    }
  });


  // ── Setup ──────────────────────────────────────────────────────────────────
  api.registerTool({
    name: "masumi_setup",
    description: "Show Masumi plugin setup instructions. Use when the user asks how to configure Masumi, set up the payment service, or when other Masumi tools report missing configuration.",
    parameters: {
      type: "object",
      properties: {}
    },
    async execute(_id: string, _params: any) {
      const cfg = (api.pluginConfig ?? api.config?.plugins?.entries?.masumi?.config ?? {}) as any;
      if (isConfigured(cfg)) {
        return {
          content: [{
            type: "text",
            text: `✅ Masumi is already configured!\n\n- **Payment Service:** ${cfg.paymentServiceUrl}\n- **Network:** ${cfg.network || "Preprod"}\n- **API Key:** set ✓`
          }]
        };
      }
      return { content: [{ type: "text", text: SETUP_MESSAGE }] };
    }
  });


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
      const cfg = (api.pluginConfig ?? api.config?.plugins?.entries?.masumi?.config ?? {}) as any;

      if (!isConfigured(cfg)) {
        return { content: [{ type: "text", text: SETUP_MESSAGE }] };
      }

      const paymentServiceUrl = cfg.paymentServiceUrl;
      const apiKey = cfg.apiKey;
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
  });


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
      const cfg = (api.pluginConfig ?? api.config?.plugins?.entries?.masumi?.config ?? {}) as any;

      if (!isConfigured(cfg)) {
        return { content: [{ type: "text", text: SETUP_MESSAGE }] };
      }

      const paymentServiceUrl = cfg.paymentServiceUrl;
      const apiKey = cfg.apiKey;
      const network = params.network || cfg?.network || "Preprod";

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
        // Send input_data as a flat dict (key: value) as expected by masumi agents
        const inputDataDict: Record<string, string> = {};
        Object.entries(params.inputData).forEach(([key, value]) => {
          inputDataDict[key] = String(value);
        });

        const startResp = await fetch(`${params.agentApiUrl}/start_job`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            identifier_from_purchaser: purchaserId,
            input_data: inputDataDict
          })
        });

        const startData = await startResp.json() as any;

        if (!startData.job_id && !startData.data?.job_id && !startData.id) {
          return {
            content: [{
              type: "text",
              text: `❌ Failed to start job: ${JSON.stringify(startData)}`
            }]
          };
        }

        const jobId = startData.job_id || startData.data?.job_id || startData.id;
        const blockchainIdentifier = startData.blockchainIdentifier || startData.data?.blockchainIdentifier;
        const amounts = startData.amounts || startData.data?.amounts || [];
        const inputHash = startData.input_hash || startData.data?.input_hash;
        const submitResultTime = String(startData.submitResultTime || startData.data?.submitResultTime || "");
        const unlockTime = String(startData.unlockTime || startData.data?.unlockTime || "");
        const externalDisputeUnlockTime = String(startData.externalDisputeUnlockTime || startData.data?.externalDisputeUnlockTime || "");
        const payByTime = String(startData.payByTime || startData.data?.payByTime || (Date.now() + 600000));

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
            inputHash,
            inputData: inputDataDict
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
  });

}

// ── Helpers ────────────────────────────────────────────────────────────────
function generateHexId(length: number): string {
  const chars = "0123456789abcdef";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
