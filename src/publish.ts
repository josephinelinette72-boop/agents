/**
 * Export approved campaigns to outbox/ as one Markdown file each: the plan
 * plus every piece of content, ready to copy into each channel.
 *
 * No channel APIs are connected. When one is (X, LinkedIn, an email service),
 * it goes in `send` below; the approval flow stays the same.
 *
 *   npm run publish
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT_ROOT } from './brand.js';
import { listCampaigns, saveCampaign, type Campaign } from './store.js';
import { bold, dim, green } from './ui.js';

const OUTBOX = path.join(PROJECT_ROOT, 'outbox');

export function campaignMarkdown(c: Campaign): string {
  return [
    `# ${c.name}`,
    `*${c.subject}*`,
    '',
    `**Goal:** ${c.goal}  `,
    `**Audience:** ${c.audience}  `,
    `**Key message:** ${c.keyMessage}`,
    '',
    '## Strategy',
    c.strategy,
    '',
    '## Timeline',
    ...c.timeline.map((t) => `- **${t.when}:** ${t.what}`),
    '',
    '## Content',
    ...c.assets.flatMap((a, i) => [
      '',
      `### ${i + 1}. ${a.channel.toUpperCase()}${a.when ? ` · ${a.when}` : ''}`,
      a.title ? `**${a.title}**\n` : '',
      a.body,
      a.imagePrompt ? `\n*Image:* ${a.imagePrompt}` : '',
    ]),
    '',
    '## How to measure it',
    ...c.metrics.map((m) => `- ${m}`),
    c.budgetNotes ? `\n## Budget\n${c.budgetNotes}` : '',
    c.sources?.length ? `\n## Sources\n${c.sources.map((s) => `- ${s}`).join('\n')}` : '',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

async function send(c: Campaign): Promise<string> {
  mkdirSync(OUTBOX, { recursive: true });
  const file = path.join(OUTBOX, `${c.id}.md`);
  writeFileSync(file, `${campaignMarkdown(c)}\n`);
  return file;
}

/** Export every approved campaign not yet exported. Used by this command and the console. */
export async function publishApproved(): Promise<Campaign[]> {
  const done: Campaign[] = [];
  for (const c of listCampaigns('approved').filter((x) => !x.publishedAt)) {
    const file = await send(c);
    const updated = { ...c, publishedAt: new Date().toISOString(), outboxFile: file };
    saveCampaign(updated, 'approved');
    done.push(updated);
  }
  return done;
}

async function main() {
  const done = await publishApproved();
  if (done.length === 0) {
    console.log('Nothing new to export. Approve campaigns with: npm run review');
    return;
  }
  for (const c of done) console.log(green(`✓ ${c.name}`) + dim(` → ${path.relative(process.cwd(), c.outboxFile!)}`));
  console.log(bold(`\n${done.length} campaign(s) in the outbox.`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
