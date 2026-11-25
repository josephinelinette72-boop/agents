/**
 * The human approval queue for campaigns.
 *
 *   npm run review
 *
 * For each pending campaign: [a]pprove, [r]eject with a reason (the agent
 * reads reasons on its next run), [s]kip, or [q]uit.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { listCampaigns, moveCampaign, type Campaign } from './store.js';
import { bold, cyan, dim, green, red } from './ui.js';

export function describe(c: Campaign): string {
  return [
    bold(`${c.name}`) + dim(`  (${c.subject})`),
    `Goal: ${c.goal}`,
    `Audience: ${c.audience}`,
    `Key message: ${c.keyMessage}`,
    `\n${c.strategy}`,
    `\nTimeline:\n${c.timeline.map((t) => `  ${t.when}: ${t.what}`).join('\n')}`,
    ...c.assets.map((a, i) => `\n${cyan(`[${i + 1}] ${a.channel.toUpperCase()}${a.when ? ` · ${a.when}` : ''}`)}\n${a.title ? bold(a.title) + '\n' : ''}${a.body}${a.imagePrompt ? dim(`\n(image: ${a.imagePrompt})`) : ''}`),
    `\nMetrics: ${c.metrics.join('; ')}`,
    c.budgetNotes ? `Budget: ${c.budgetNotes}` : '',
    c.compliance.notes ? cyan(`Reviewer notes: ${c.compliance.notes}`) : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function main() {
  const queue = listCampaigns('pending').reverse();
  if (queue.length === 0) {
    console.log('No campaigns waiting. Create one with: npm run plan -- "what to market"');
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const [i, c] of queue.entries()) {
      console.log(`\n${dim(`──── ${i + 1}/${queue.length} · ${c.id} ────`)}\n${describe(c)}\n`);
      const answer = (await rl.question('[a]pprove  [r]eject  [s]kip  [q]uit > ')).trim().toLowerCase();
      const at = new Date().toISOString();
      if (answer === 'q') break;
      if (answer === 'a') {
        moveCampaign(c, 'pending', 'approved', { review: { decision: 'approved', at } });
        console.log(green('Approved. Export it with: npm run publish'));
      } else if (answer === 'r') {
        const reason = (await rl.question('Reason (the agent learns from this): ')).trim();
        moveCampaign(c, 'pending', 'rejected', { review: { decision: 'rejected', reason: reason || 'no reason given', at } });
        console.log(red('Rejected.'));
      } else {
        console.log(dim('Skipped.'));
      }
    }
  } finally {
    rl.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
