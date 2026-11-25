/**
 * Brand packs: one folder per app under brands/. Adding an app means adding
 * a folder (copy brands/_template), not code.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BRANDS_DIR = path.join(PROJECT_ROOT, 'brands');

export const CHANNELS = [
  'x', 'linkedin', 'instagram', 'tiktok', 'facebook', 'youtube', 'email', 'blog', 'sms', 'ad', 'poster', 'other',
] as const;
export type Channel = (typeof CHANNELS)[number];

const BrandSchema = z.object({
  name: z.string().min(1),
  summary: z.string().min(1),
  url: z.string().optional(),
  channels: z.array(z.enum(CHANNELS)).min(1),
  /** Regulated brands (securities, finance, health) need human sign-off on everything. */
  regulated: z.boolean().default(false),
  /** Text every draft must contain, verbatim. Empty for none. */
  requiredDisclosure: z.string().default(''),
  /** Case-insensitive regular expressions that fail a draft outright. */
  forbiddenPatterns: z.array(z.string()).default([]),
});

export type Brand = z.infer<typeof BrandSchema> & { id: string; dir: string };

const BRAND_FILES = ['positioning.md', 'audience.md', 'voice.md', 'claims-allowed.md', 'claims-forbidden.md'];

export function listBrands(brandsDir = BRANDS_DIR): string[] {
  return readdirSync(brandsDir)
    .filter((name) => !name.startsWith('_') && !name.startsWith('.'))
    .filter((name) => existsSync(path.join(brandsDir, name, 'brand.json')))
    .sort();
}

export function loadBrand(id: string, brandsDir = BRANDS_DIR): Brand {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`Brand ids are lowercase words with dashes, got "${id}".`);
  const dir = path.join(brandsDir, id);
  const file = path.join(dir, 'brand.json');
  if (!existsSync(file)) {
    const known = listBrands(brandsDir);
    throw new Error(`No brand "${id}". Known brands: ${known.join(', ') || 'none'}. Copy brands/_template to add one.`);
  }
  const parsed = BrandSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.success) throw new Error(`brands/${id}/brand.json is invalid: ${parsed.error.message}`);
  for (const pattern of parsed.data.forbiddenPatterns) {
    try {
      new RegExp(pattern, 'i');
    } catch {
      throw new Error(`brands/${id}/brand.json: forbiddenPatterns has an invalid regular expression: ${pattern}`);
    }
  }
  for (const f of BRAND_FILES) {
    if (!existsSync(path.join(dir, f))) throw new Error(`brands/${id}/${f} is missing. Copy it from brands/_template.`);
  }
  return { ...parsed.data, id, dir };
}

/** Every readable file in the pack, relative to its folder. */
export function listBrandFiles(brand: Brand): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(path.join(brand.dir, rel))) {
      const r = path.join(rel, name);
      if (statSync(path.join(brand.dir, r)).isDirectory()) walk(r);
      else if (/\.(md|json|txt)$/.test(name)) out.push(r);
    }
  };
  walk('');
  return out.sort();
}

/** Read one pack file. Paths are confined to the brand folder. */
export function readBrandFile(brand: Brand, rel: string): string {
  const full = path.resolve(brand.dir, rel);
  if (!full.startsWith(brand.dir + path.sep)) throw new Error(`"${rel}" is outside the brand pack.`);
  if (!/\.(md|json|txt)$/.test(full)) throw new Error('Only .md, .json and .txt files can be read.');
  if (!existsSync(full)) throw new Error(`No file "${rel}". Files: ${listBrandFiles(brand).join(', ')}`);
  return readFileSync(full, 'utf8');
}

/** The claim rules, as the compliance checker sees them. */
export function claimRules(brand: Brand): string {
  return [
    `Brand: ${brand.name}. ${brand.summary}`,
    brand.requiredDisclosure ? `Required disclosure in every draft: "${brand.requiredDisclosure}"` : '',
    '## claims-allowed.md',
    readBrandFile(brand, 'claims-allowed.md'),
    '## claims-forbidden.md',
    readBrandFile(brand, 'claims-forbidden.md'),
  ]
    .filter(Boolean)
    .join('\n\n');
}
