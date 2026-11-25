/**
 * Everything that does not need a model: brand packs, the fixed honesty
 * rules, the campaign queue, and the submit tool's rule gate.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { listBrands, loadBrand, readBrandFile } from '../src/brand.js';
import { looksLikeAnthropicKey, ruleCheck, type CampaignDraft } from '../src/compliance.js';
import { campaignMarkdown } from '../src/publish.js';
import { findCampaign, history, listCampaigns, moveCampaign, newId, saveCampaign, type Campaign } from '../src/store.js';
import { campaignTask, makeMarketingTools } from '../src/tools.js';

const DISCLOSURE = 'Test network only. Not an offer to sell securities.';

function draft(over: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    subject: 'a weekend pottery class',
    name: 'Mud Club',
    goal: '30 sign-ups in 3 weeks',
    audience: 'Adults nearby who want a screen-free hobby',
    keyMessage: 'Make something real with your hands this weekend',
    strategy: 'Instagram and a local poster.',
    timeline: [{ when: 'Week 1', what: 'Announce' }],
    assets: [{ channel: 'x', body: 'Two hours, one lump of clay, one mug you made yourself. Saturdays at 10.' }],
    metrics: ['sign-ups'],
    ...over,
  };
}

const submitInput = {
  subject: 'x',
  name: 'n',
  goal: 'g',
  audience: 'a',
  key_message: 'k',
  strategy: 's',
  timeline: [{ when: 'now', what: 'post' }],
  metrics: ['m'],
};

test('brand packs are optional extras; the template stays hidden', () => {
  assert.ok(listBrands().includes('property-share'));
  assert.ok(!listBrands().includes('_template'));
  const brand = loadBrand('property-share');
  assert.match(readBrandFile(brand, 'claims-forbidden.md'), /NOT reviewed by a lawyer/);
  assert.throws(() => readBrandFile(brand, '../../.env'), /outside the brand pack|Only/);
});

test('universal rules catch guarantees for any subject', () => {
  assert.deepEqual(ruleCheck(draft()), []);
  const bad = ruleCheck(draft({ assets: [{ channel: 'instagram', body: 'Guaranteed results or your money back! Risk-free.' }] }));
  assert.ok(bad.some((i) => i.quote.toLowerCase().includes('guaranteed results')));
  assert.ok(bad.some((i) => i.quote.toLowerCase() === 'risk-free'));
  const long = ruleCheck(draft({ assets: [{ channel: 'sms', body: 'a'.repeat(170) }] }));
  assert.ok(long.some((i) => i.rule.includes('160')));
});

test('a brand pack adds its own patterns and disclosure', () => {
  const brand = loadBrand('property-share');
  const missing = ruleCheck(draft({ assets: [{ channel: 'x', body: 'How rent gets split on-chain.' }] }), brand);
  assert.ok(missing.some((i) => i.rule.includes('required disclosure')));
  const yieldy = ruleCheck(draft({ assets: [{ channel: 'linkedin', body: `Earn 8% APY. ${DISCLOSURE}` }] }), brand);
  assert.ok(yieldy.some((i) => i.rule.includes('forbidden phrase')));
});

test('campaigns move through the queue and rejections reach history', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'mkt-'));
  const c: Campaign = { ...draft(), id: newId(), createdAt: new Date().toISOString(), compliance: { notes: '', checkedBy: 'test' } };
  saveCampaign(c, 'pending', dataDir);
  assert.equal(listCampaigns('pending', dataDir).length, 1);
  moveCampaign(c, 'pending', 'rejected', { review: { decision: 'rejected', reason: 'too cheesy', at: 'now' } }, dataDir);
  assert.equal(listCampaigns('pending', dataDir).length, 0);
  assert.equal(findCampaign(c.id, dataDir)?.status, 'rejected');
  assert.equal(history(10, dataDir)[0]?.rejectionReason, 'too cheesy');
  assert.match(campaignMarkdown(c), /# Mud Club[\s\S]*### 1\. X/);
});

test('submit_campaign stops a rule violation before any model is called', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'mkt-'));
  const grader = async () => assert.fail('the model reviewer should not run when a fixed rule fails');
  const { tools } = makeMarketingTools({ grader, dataDir });
  assert.deepEqual(tools.map((t) => t.name), ['list_past_campaigns', 'submit_campaign']);
  const submit = tools.find((t) => t.name === 'submit_campaign')!;
  const result = JSON.parse(
    (await submit.run({ ...submitInput, assets: [{ channel: 'x', body: 'Get rich with this one weird trick' }] } as never)) as string,
  );
  assert.equal(result.accepted, false);
  assert.equal(listCampaigns('pending', dataDir).length, 0);
});

test('submit_campaign queues a campaign the reviewer passes', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'mkt-'));
  const grader = async () => ({ pass: true, issues: [], notes: 'fine', checkedBy: 'test' });
  const { tools } = makeMarketingTools({ grader, dataDir });
  const submit = tools.find((t) => t.name === 'submit_campaign')!;
  const result = JSON.parse((await submit.run({ ...submitInput, assets: [{ channel: 'email', title: 'Hi', body: 'Hello' }] } as never)) as string);
  assert.equal(result.accepted, true);
  assert.equal(listCampaigns('pending', dataDir)[0]?.assets[0]?.title, 'Hi');
});

test('the task names the subject, and the brand pack only when chosen', () => {
  assert.match(campaignTask({ subject: 'a bake sale', web: false }), /bake sale[\s\S]*No brand pack[\s\S]*Web search is off/);
  assert.match(campaignTask({ subject: 'x', web: true, brand: loadBrand('property-share') }), /Brand pack for this run: PropertyShare/);
});

test('only an sk-ant- key selects the API reviewer', () => {
  assert.equal(looksLikeAnthropicKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz'), true);
  assert.equal(looksLikeAnthropicKey('AQ.Ab8Rsomethingelse-from-another-service-000000000'), false);
  assert.equal(looksLikeAnthropicKey(undefined), false);
});
