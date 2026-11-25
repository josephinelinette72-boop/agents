/**
 * The marketing tools as an MCP server, for runs through Claude Code on a
 * Claude plan. MARKETING_BRAND optionally picks a brand pack for the run;
 * without it the agent can build a campaign for anything.
 *
 * stdout carries the MCP protocol: log to stderr only.
 */
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { loadBrand, PROJECT_ROOT } from './brand.js';
import { defaultGrader } from './compliance.js';
import { makeMarketingTools } from './tools.js';

dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });

type Tool = {
  name: string;
  description: string;
  input_schema: { type: 'object'; [key: string]: unknown };
  parse: (input: unknown) => unknown;
  run: (input: never) => Promise<unknown> | unknown;
};

const brandId = process.env.MARKETING_BRAND?.trim();
const brand = brandId ? loadBrand(brandId) : undefined;
const { tools } = makeMarketingTools({ brand, grader: defaultGrader(), onEvent: (line) => console.error(line) });
const list = tools as unknown as Tool[];

const server = new Server({ name: 'marketing', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: list.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const tool = list.find((t) => t.name === request.params.name);
    if (!tool) throw new Error(`No tool named ${request.params.name}`);
    const result = await tool.run(tool.parse(request.params.arguments ?? {}) as never);
    return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
