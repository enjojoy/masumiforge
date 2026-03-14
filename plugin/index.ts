/**
 * MasumiForge Plugin
 * Registers 3 tools for working with Masumi Network agents from OpenClaw.
 */

export default function (api: any) {
  // ─── masumi_forge ──────────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "masumi_forge",
      description:
        "Scaffold a new Masumi agent from a natural language description. " +
        "Generates agent.py, .env template, requirements.txt, and a README. " +
        "Supports basic, crewai, langgraph, and autogen frameworks.",
      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "Natural language description of what the agent should do",
          },
          outputDir: {
            type: "string",
            description: "Output directory for scaffolded agent (default: ./agent)",
          },
          framework: {
            type: "string",
            enum: ["crewai", "langgraph", "autogen", "basic"],
            description: "Agent framework to use (default: basic)",
          },
        },
        required: ["description"],
      },
      async execute(_id: string, params: any) {
        const { forge } = await import("./tools/forge.js");
        return forge(params, api.config);
      },
    },
    { optional: true }
  );

  // ─── masumi_list_agents ───────────────────────────────────────────────────
  api.registerTool(
    {
      name: "masumi_list_agents",
      description:
        "List available agents on the Masumi/Sokosumi marketplace. " +
        "Can filter by capability name. Returns agent names, identifiers, descriptions, and prices.",
      parameters: {
        type: "object",
        properties: {
          capability: {
            type: "string",
            description: "Filter by capability name (e.g. 'github-pr-summarizer')",
          },
          limit: {
            type: "number",
            description: "Max results to return (default 10)",
          },
        },
      },
      async execute(_id: string, params: any) {
        const { listAgents } = await import("./tools/list-agents.js");
        return listAgents(params, api.config);
      },
    },
    { optional: true }
  );

  // ─── masumi_hire_agent ────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "masumi_hire_agent",
      description:
        "Hire a Masumi agent — start a job, handle payment, poll for the result, and return it. " +
        "Requires agentIdentifier (from the registry) and inputData matching the agent's schema.",
      parameters: {
        type: "object",
        properties: {
          agentIdentifier: {
            type: "string",
            description: "Agent identifier from the Masumi registry",
          },
          inputData: {
            type: "object",
            description: "Input data for the agent job (key-value dict)",
          },
        },
        required: ["agentIdentifier", "inputData"],
      },
      async execute(_id: string, params: any) {
        const { hireAgent } = await import("./tools/hire-agent.js");
        return hireAgent(params, api.config);
      },
    },
    { optional: true }
  );
}
