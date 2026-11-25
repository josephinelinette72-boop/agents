/**
 * Campaigns waiting for a human, as plain JSON files you can read by hand.
 *
 *   data/campaigns/pending/<id>.json    passed the honesty check, waiting for you
 *   data/campaigns/approved/<id>.json   approved (and exported to outbox/ when you publish)
 *   data/campaigns/rejected/<id>.json   rejected, with your reason (the agent reads these)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { PROJECT_ROOT, type Channel } from './brand.js';

export const DATA_DIR = path.join(PROJECT_ROOT, 'data', 'campaigns');

export const STATUSES = ['pending', 'approved', 'rejected'] as const;
export type Status = (typeof STATUSES)[number];

export type Asset = {
  channel: Channel;
  title?: string;
  body: string;
  imagePrompt?: string;
  when?: string;
};

export type Campaign = {
  id: string;
  subject: string;
  brand?: string;
  createdAt: string;
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
  compliance: { notes: string; checkedBy: string };
  review?: { decision: 'approved' | 'rejected'; reason?: string; at: string };
  publishedAt?: string;
  outboxFile?: string;
};

export function newId(): string {
  return `${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString('hex')}`;
}

function fileFor(id: string, status: Status, dataDir: string): string {
  if (!/^[\w-]+$/.test(id)) throw new Error(`Bad campaign id: ${id}`);
  return path.join(dataDir, status, `${id}.json`);
}

export function saveCampaign(c: Campaign, status: Status = 'pending', dataDir = DATA_DIR): string {
  const file = fileFor(c.id, status, dataDir);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(c, null, 2)}\n`);
  return file;
}

/** Newest first. */
export function listCampaigns(status: Status, dataDir = DATA_DIR): Campaign[] {
  const dir = path.join(dataDir, status);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Campaign)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function findCampaign(id: string, dataDir = DATA_DIR): { campaign: Campaign; status: Status } | undefined {
  for (const status of STATUSES) {
    const file = fileFor(id, status, dataDir);
    if (existsSync(file)) return { campaign: JSON.parse(readFileSync(file, 'utf8')) as Campaign, status };
  }
  return undefined;
}

/** Move between folders, merging changes. The new copy is written before the old one is removed. */
export function moveCampaign(c: Campaign, from: Status, to: Status, patch: Partial<Campaign> = {}, dataDir = DATA_DIR): Campaign {
  const updated = { ...c, ...patch };
  const dest = saveCampaign(updated, to, dataDir);
  const src = fileFor(c.id, from, dataDir);
  if (src !== dest && existsSync(src)) unlinkSync(src);
  return updated;
}

/** Short history for the agent: what was made, and why humans rejected things. */
export function history(limit = 20, dataDir = DATA_DIR) {
  return STATUSES.flatMap((status) => listCampaigns(status, dataDir).map((c) => ({ status, c })))
    .sort((a, b) => b.c.createdAt.localeCompare(a.c.createdAt))
    .slice(0, limit)
    .map(({ status, c }) => ({
      status,
      subject: c.subject,
      name: c.name,
      keyMessage: c.keyMessage,
      channels: [...new Set(c.assets.map((a) => a.channel))],
      createdAt: c.createdAt,
      rejectionReason: status === 'rejected' ? c.review?.reason : undefined,
    }));
}
