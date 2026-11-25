/**
 * Build a campaign through the Anthropic API (needs ANTHROPIC_API_KEY).
 * Without a key, use the agent console instead, which runs the same agent
 * through Claude Code on a Claude plan.
 *
 *   npm run plan -- "a weekend pottery class in Leeds"
 *   npm run plan -- "our new budgeting app" --brief "launch is March 3, free tier"
 *   npm run plan -- "PropertyShare" --brand property-share
 *   npm run plan -- "a school bake sale" --no-web
 *
 * Campaigns that pass the honesty check land in data/campaigns/pending/.
 * Review them with `npm run review`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { listBrands, loadBrand, PROJECT_ROOT } from './brand.js';
import { defaultGrader } from './compliance.js';
import { campaignTask, makeMarketingTools } from './tools.js';
import { bold, clip, cyan, dim, green, parseArgs, yellow } from './ui.js';

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const MODEL = process.env.MARKETING_MODEL?.trim() || 'claude-opus-5-5';
const EFFORT = (process.env.MARKETING_EFFORT?.trim() || 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max';
// The instructions live in .claude/agents/marketing-agent.md so Claude Code and
// this API runner share them. Keep the role part; drop the Claude-Code-only tail.
const SYSTEM = readFileSync(path.join(PROJECT_ROOT, '.claude', 'agents', 'marketing-agent.md'), 'utf8')
  .replace(/^---\n[\s\S]*?\n---\n/, '')
  .split('<!-- claude-code-only')[0]!
  .trim();

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const subject = positional.join(' ').trim();
  if (!subject) {
    console.log(`Usage: npm run plan -- "what to market" [--brief "..."] [--brand id] [--no-web]\nBrand packs: ${listBrands().join(', ') || 'none'}`);
    process.exitCode = 1;
    return;
  }
  const brand = flags.brand ? loadBrand(flags.brand) : undefined;
  const key = process.env.ANTHROPIC_API_KEY?.trim() ?? '';
  if (!key.startsWith('sk-ant-')) {
    console.log(
      key
        ? 'ANTHROPIC_API_KEY in .env is not an Anthropic API key (those start with sk-ant-). Remove that line.'
        : 'This command needs an Anthropic API key.',
    );
    console.log('On a Claude plan, use the Agent Console instead: cd ~/agent-console && npm start, then open http://localhost:4747');
    process.exitCode = 1;
    return;
  }
  const useWeb = flags['no-web'] !== 'true';

  console.log(bold(`Marketing agent · ${subject} · ${MODEL} · effort ${EFFORT}`));
  console.log(dim(`Brand pack: ${brand?.name ?? 'none'} · web research: ${useWeb ? 'on' : 'off'}`));
  console.log();

  const client = new Anthropic();
  const { tools, submitted } = makeMarketingTools({
    brand,
    grader: defaultGrader(),
    onEvent: (line) => console.log(line.startsWith('✓') ? green(`  ${line}`) : yellow(`  ${line}`)),
  });

  const task = campaignTask({ subject, brief: flags.brief, brand, web: useWeb });

  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort: EFFORT },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    cache_control: { type: 'ephemeral' },
    system: SYSTEM,
    tools: useWeb ? [...tools, { type: 'web_search_20260209', name: 'web_search', max_uses: 5 }] : tools,
    max_iterations: 40,
    messages: [{ role: 'user', content: task }],
  });

  let input = 0;
  let output = 0;
  let last: Anthropic.Beta.BetaMessage | undefined;
  for await (const message of runner) {
    last = message;
    input += message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
    output += message.usage.output_tokens;
    for (const block of message.content) {
      if (block.type === 'thinking' && block.thinking) console.log(dim(`  thinking: ${clip(block.thinking, 400)}`));
      if (block.type === 'text' && block.text.trim()) console.log(`\n${block.text.trim()}\n`);
      if (block.type === 'tool_use') console.log(cyan(`→ ${block.name}`) + dim(` ${clip(JSON.stringify(block.input), 160)}`));
      if (block.type === 'server_tool_use') console.log(cyan(`→ ${block.name}`) + dim(` ${clip(JSON.stringify(block.input), 160)}`));
    }
  }

  if (last?.stop_reason === 'refusal') console.log(yellow('The model declined this request.'));
  console.log(bold(`\n${submitted.length} campaign(s) waiting for review.`) + ' Next: npm run review');
  console.log(dim(`~${input.toLocaleString()} input / ${output.toLocaleString()} output tokens.`));
}

main().catch((error: unknown) => {
  if (error instanceof Anthropic.AuthenticationError) {
    console.error('Anthropic rejected the API key. Put ANTHROPIC_API_KEY in ~/marketing-agent/.env.');
  } else if (error instanceof Anthropic.APIError) {
    console.error(`Anthropic API error ${error.status}: ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});
