/**
 * The marketing agent's tools. Web search and web fetch come from the model
 * platform (plan.ts) or Claude Code (the console), not from here.
 *
 *   read_brand_file      only when a brand pack was chosen for the run
 *   list_past_campaigns  what was made before, and why humans rejected things
 *   submit_campaign      honesty check, then the human approval queue
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { CHANNELS, listBrandFiles, readBrandFile, type Brand } from './brand.js';
import { checkCampaign, type CampaignDraft, type Grader } from './compliance.js';
import { DATA_DIR, history, newId, saveCampaign, type Campaign } from './store.js';

export type ToolOptions = {
  grader: Grader;
  /** The brand pack chosen for this run, if any. */
  brand?: Brand;
  dataDir?: string;
  onEvent?: (line: string) => void;
};

const AssetSchema = z.object({
  channel: z.enum(CHANNELS),
  title: z.string().optional().describe('Email subject, blog title, ad headline, video title'),
  body: z.string().min(1).describe('The full content exactly as it would be posted or sent. For video: the script.'),
  image_prompt: z.string().optional().describe('A description of the visual, for a designer or an image generator'),
  when: z.string().optional().describe('When it goes out, e.g. "Week 1, Monday"'),
});

export const CampaignInput = z.object({
  subject: z.string().describe('What is being marketed, in a few words'),
  name: z.string().describe('A short campaign name'),
  goal: z.string().describe('One measurable goal, e.g. "200 sign-ups in 4 weeks"'),
  audience: z.string().describe('Who it is for and what they care about'),
  key_message: z.string().describe('The one thing the audience should remember'),
  strategy: z.string().describe('Why this approach and these channels, in a short paragraph or bullet list'),
  timeline: z.array(z.object({ when: z.string(), what: z.string() })).min(1),
  assets: z.array(AssetSchema).min(1).max(15).describe('The ready-to-use content pieces'),
  metrics: z.array(z.string()).min(1).describe('How to tell whether it worked'),
  budget_notes: z.string().optional().describe('Free vs paid options, rough costs if known'),
  sources: z.array(z.string()).optional().describe('URLs that facts in the campaign rely on'),
});

export function toDraft(input: z.infer<typeof CampaignInput>): CampaignDraft {
  return {
    subject: input.subject,
    name: input.name,
    goal: input.goal,
    audience: input.audience,
    keyMessage: input.key_message,
    strategy: input.strategy,
    timeline: input.timeline,
    assets: input.assets.map((a) => ({ channel: a.channel, title: a.title, body: a.body, imagePrompt: a.image_prompt, when: a.when })),
    metrics: input.metrics,
    budgetNotes: input.budget_notes,
    sources: input.sources,
  };
}

export function makeMarketingTools(opts: ToolOptions) {
  const { grader, brand } = opts;
  const dataDir = opts.dataDir ?? DATA_DIR;
  const say = opts.onEvent ?? (() => {});
  const submitted: Campaign[] = [];

  const readBrand = brand
    ? betaZodTool({
        name: 'read_brand_file',
        description: `Read a file from the ${brand.name} brand pack chosen for this run. Call with no path to list the files.`,
        inputSchema: z.object({ path: z.string().optional().describe('e.g. "voice.md"') }),
        run: async ({ path: rel }) => (rel ? readBrandFile(brand, rel) : `Files: ${listBrandFiles(brand).join(', ')}`),
      })
    : undefined;

  const listPast = betaZodTool({
    name: 'list_past_campaigns',
    description: 'Recent campaigns, newest first, with their status and, for rejected ones, the human\'s reason. Use it to avoid repeats and learn what the human dislikes.',
    inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }),
    run: async ({ limit }) => {
      const rows = history(limit ?? 20, dataDir);
      return rows.length ? JSON.stringify(rows, null, 2) : 'No campaigns yet.';
    },
  });

  const submit = betaZodTool({
    name: 'submit_campaign',
    description:
      'Submit the finished campaign. It is checked automatically for honesty' +
      (brand ? ` and against the ${brand.name} brand rules (every piece must contain "${brand.requiredDisclosure}")` : '') +
      '. If the check fails you get the reasons: fix every one and submit again. If it passes, it waits for a human to approve it.',
    inputSchema: CampaignInput,
    run: async (input) => {
      const draft = toDraft(input);
      const verdict = await checkCampaign(grader, draft, brand);
      mkdirSync(dataDir, { recursive: true });
      appendFileSync(
        path.join(dataDir, 'check-log.jsonl'),
        `${JSON.stringify({ at: new Date().toISOString(), name: draft.name, subject: draft.subject, ...verdict })}\n`,
      );
      if (!verdict.pass) {
        say(`✗ honesty check failed: ${verdict.issues.map((i) => i.rule).join('; ')}`);
        return JSON.stringify({ accepted: false, issues: verdict.issues, instruction: 'Fix every issue, then submit the whole campaign again.' }, null, 2);
      }
      const campaign: Campaign = {
        ...draft,
        id: newId(),
        brand: brand?.id,
        createdAt: new Date().toISOString(),
        compliance: { notes: verdict.notes, checkedBy: verdict.checkedBy },
      };
      saveCampaign(campaign, 'pending', dataDir);
      submitted.push(campaign);
      say(`✓ queued campaign ${campaign.id}: ${campaign.name}`);
      return JSON.stringify({ accepted: true, id: campaign.id, reviewerNotes: verdict.notes || undefined });
    },
  });

  const tools = readBrand ? [readBrand, listPast, submit] : [listPast, submit];
  return { tools, submitted };
}

/** The task message for one run. Shared by plan.ts and the agent console. */
export function campaignTask(input: { subject: string; brief?: string; brand?: Brand; web: boolean; today?: string }): string {
  return [
    `Today: ${input.today ?? new Date().toISOString().slice(0, 10)}.`,
    `Build one marketing campaign for: ${input.subject}`,
    input.brief ? `Notes from the team: ${input.brief}` : '',
    input.brand ? `Brand pack for this run: ${input.brand.name}. Read it before planning; its rules apply.` : 'No brand pack: work from the subject, the notes, and research.',
    input.web ? '' : 'Web search is off this run: work from what you know and mark anything that needs checking.',
  ]
    .filter(Boolean)
    .join('\n');
}
