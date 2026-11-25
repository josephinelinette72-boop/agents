/**
 * Every campaign passes two checks before a human sees it:
 *
 * 1. Fixed rules, no model: phrases that are never acceptable, the brand's own
 *    forbidden patterns and disclosure (when a brand pack is used), and channel
 *    length limits. Cheap and impossible to argue with.
 * 2. One separate Claude call that reads the whole campaign against the
 *    honesty rules in core/compliance.md (plus the brand's claim rules). It
 *    never sees the drafting conversation, so the drafter cannot talk it round.
 *    With a real ANTHROPIC_API_KEY this is an API call; without one it runs
 *    through Claude Code on your Claude plan.
 *
 * Passing both only puts the campaign in the human queue. Nothing publishes.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { claimRules, PROJECT_ROOT, type Brand, type Channel } from './brand.js';
import { claudeJson } from './claude.js';
import type { Asset } from './store.js';

export type Issue = { quote: string; rule: string; fix: string };
export type Verdict = { pass: boolean; issues: Issue[]; notes: string; checkedBy: string };

/** The campaign as the checkers see it (no id, dates or review state yet). */
export type CampaignDraft = {
  subject: string;
  name: string;
  goal: string;
  audience: string;
  keyMessage: string;
  strategy: string;
  timeline: { when: string; what: string }[];
  assets: Asset[];
  metrics: string[];
  budgetNotes?: string;
  sources?: string[];
};

export const LENGTH_LIMITS: Partial<Record<Channel, number>> = { x: 280, sms: 160 };

/** Never acceptable, for any subject. Case-insensitive. */
export const UNIVERSAL_PATTERNS = [
  'guaranteed (results|returns|income|profit|weight loss|cure)',
  'risk[- ]free',
  'get rich',
  'miracle (cure|product|pill)',
  'doctors hate',
  'cures? (cancer|diabetes|covid|anxiety|depression)',
];

function assetText(a: Asset): string {
  return [a.title, a.body].filter(Boolean).join('\n\n');
}

export function ruleCheck(campaign: CampaignDraft, brand?: Brand): Issue[] {
  const issues: Issue[] = [];
  const patterns = [...UNIVERSAL_PATTERNS, ...(brand?.forbiddenPatterns ?? [])];
  const pieces = [
    { label: 'strategy', text: [campaign.name, campaign.keyMessage, campaign.strategy].join('\n') },
    ...campaign.assets.map((a, i) => ({ label: `piece ${i + 1} (${a.channel})`, text: assetText(a), asset: a })),
  ];
  for (const piece of pieces) {
    for (const pattern of patterns) {
      const match = new RegExp(pattern, 'i').exec(piece.text);
      if (match) {
        issues.push({ quote: match[0], rule: `${piece.label}: forbidden phrase /${pattern}/`, fix: 'Remove the phrase and the claim behind it. Do not rephrase it.' });
      }
    }
    if (!('asset' in piece) || !piece.asset) continue;
    const disclosure = brand?.requiredDisclosure.trim();
    if (disclosure && !piece.text.toLowerCase().includes(disclosure.toLowerCase())) {
      issues.push({ quote: '(missing)', rule: `${piece.label}: required disclosure`, fix: `Include this exact text: "${disclosure}"` });
    }
    const limit = LENGTH_LIMITS[piece.asset.channel];
    if (limit && piece.asset.body.length > limit) {
      issues.push({ quote: `${piece.asset.body.length} characters`, rule: `${piece.label}: limit is ${limit} characters`, fix: 'Shorten it.' });
    }
  }
  return issues;
}

const GradeSchema = z.object({
  verdict: z.enum(['pass', 'fail']),
  issues: z.array(z.object({ quote: z.string(), rule: z.string(), fix: z.string() })),
  notes: z.string().describe('Style or strategy remarks for the human reviewer. Empty if none.'),
});
type Grade = z.infer<typeof GradeSchema>;

const COMPLIANCE_PROMPT = readFileSync(path.join(PROJECT_ROOT, 'core', 'compliance.md'), 'utf8');

export function renderForReview(c: CampaignDraft): string {
  return [
    `Subject: ${c.subject}`,
    `Campaign: ${c.name}`,
    `Goal: ${c.goal}`,
    `Audience: ${c.audience}`,
    `Key message: ${c.keyMessage}`,
    `Strategy:\n${c.strategy}`,
    `Timeline:\n${c.timeline.map((t) => `- ${t.when}: ${t.what}`).join('\n')}`,
    `Metrics: ${c.metrics.join('; ')}`,
    c.budgetNotes ? `Budget notes: ${c.budgetNotes}` : '',
    c.sources?.length ? `Sources the drafter relied on: ${c.sources.join(', ')}` : 'Sources: none given',
    ...c.assets.map((a, i) => `--- Piece ${i + 1} (${a.channel}${a.when ? `, ${a.when}` : ''}) ---\n${assetText(a)}${a.imagePrompt ? `\n[image: ${a.imagePrompt}]` : ''}`),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function gradePrompt(c: CampaignDraft, brand?: Brand): string {
  return `${brand ? `<brand_rules>\n${claimRules(brand)}\n</brand_rules>\n\n` : ''}<campaign>\n${renderForReview(c)}\n</campaign>`;
}

function toVerdict(grade: Grade | null, checkedBy: string): Verdict {
  if (!grade) {
    return {
      pass: false,
      issues: [{ quote: '(whole campaign)', rule: 'the honesty check could not complete', fix: 'Make the claims more conservative and submit again.' }],
      notes: '',
      checkedBy,
    };
  }
  return { pass: grade.verdict === 'pass' && grade.issues.length === 0, issues: grade.issues, notes: grade.notes, checkedBy };
}

/** The reviewer through Claude Code, with no tools, on your Claude plan. */
export async function claudeCodeCheck(c: CampaignDraft, brand?: Brand): Promise<Verdict> {
  try {
    const grade = await claudeJson<Grade>({ systemPrompt: COMPLIANCE_PROMPT, prompt: gradePrompt(c, brand), schema: z.toJSONSchema(GradeSchema) });
    return toVerdict(GradeSchema.safeParse(grade).data ?? null, 'claude-code');
  } catch (error) {
    return toVerdict(null, `claude-code (${error instanceof Error ? error.message : String(error)})`);
  }
}

export async function apiCheck(client: Anthropic, c: CampaignDraft, brand: Brand | undefined, model: string): Promise<Verdict> {
  const response = await client.beta.messages.parse({
    model,
    max_tokens: 6000,
    output_config: { effort: 'medium', format: betaZodOutputFormat(GradeSchema) },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: COMPLIANCE_PROMPT,
    messages: [{ role: 'user', content: gradePrompt(c, brand) }],
  });
  return toVerdict(response.stop_reason === 'refusal' ? null : response.parsed_output, model);
}

export type Grader = (c: CampaignDraft, brand?: Brand) => Promise<Verdict>;

/** True only for something shaped like an Anthropic API key (they start with sk-ant-). */
export function looksLikeAnthropicKey(value: string | undefined): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(value?.trim() ?? '');
}

/** API reviewer when a real key is set (falling back to Claude Code if it is rejected), Claude Code otherwise. */
export function defaultGrader(env: NodeJS.ProcessEnv = process.env): Grader {
  if (!looksLikeAnthropicKey(env.ANTHROPIC_API_KEY)) return claudeCodeCheck;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY!.trim() });
  const model = env.MARKETING_MODEL?.trim() || 'claude-opus-5-5';
  return async (c, brand) => {
    try {
      return await apiCheck(client, c, brand, model);
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return claudeCodeCheck(c, brand);
      throw error;
    }
  };
}

/** Fixed rules first (free, final), then the reviewer. */
export async function checkCampaign(grader: Grader, c: CampaignDraft, brand?: Brand): Promise<Verdict> {
  const fixed = ruleCheck(c, brand);
  if (fixed.length > 0) return { pass: false, issues: fixed, notes: '', checkedBy: 'rules' };
  return grader(c, brand);
}
