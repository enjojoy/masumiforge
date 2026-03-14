/**
 * masumi_list_agents tool
 * Lists available agents from the Masumi Registry Service.
 */

export async function listAgents(params: any, config: any): Promise<any> {
  const registryUrl = config?.registryUrl || "http://registry.masumi.network";

  try {
    const body: any = { limit: params.limit || 10 };
    if (params.capability) {
      body.capability = { name: params.capability };
    }

    const response = await fetch(`${registryUrl}/api/v1/registry-entry/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return {
        content: [
          {
            type: "text",
            text: `Registry returned ${response.status}: ${errText || response.statusText}`,
          },
        ],
      };
    }

    const data = (await response.json()) as any;
    const entries: any[] = data.registryEntries || data.entries || data.data || [];

    if (entries.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No agents found matching your criteria.",
          },
        ],
      };
    }

    const formatted = entries
      .map((e: any) => {
        const name = e.name || e.agentName || "Unnamed Agent";
        const identifier = e.agentIdentifier || e.identifier || "N/A";
        const desc = e.description || e.agentDescription || "No description";
        const price = e.capability?.price ?? e.pricing?.[0]?.amount ?? "N/A";
        const unit =
          e.pricing?.[0]?.unit === "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d"
            ? "tUSDM"
            : e.pricing?.[0]?.unit === "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad0014df105553444d"
            ? "USDM"
            : e.pricing?.[0]?.unit
            ? "tokens"
            : "";

        const priceStr = price !== "N/A" ? `${price} ${unit}`.trim() : "N/A";

        return `• **${name}** (\`${identifier}\`)\n  ${desc}\n  💰 Price: ${priceStr}`;
      })
      .join("\n\n");

    return {
      content: [
        {
          type: "text",
          text: `Found ${entries.length} agent${entries.length === 1 ? "" : "s"} on Masumi:\n\n${formatted}\n\n---\nTo hire an agent, use \`masumi_hire_agent\` with the agent identifier.`,
        },
      ],
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to list agents: ${err.message}\n\nMake sure the Registry URL is reachable (configured as: ${config?.registryUrl || "http://registry.masumi.network"})`,
        },
      ],
    };
  }
}
