/** `npm run brands`: the optional brand packs, checked, plus the campaign queue counts. */
import { listBrands, loadBrand } from './brand.js';
import { listCampaigns, STATUSES } from './store.js';
import { bold, dim, red } from './ui.js';

console.log(bold('Campaigns: ') + STATUSES.map((s) => `${s} ${listCampaigns(s).length}`).join(' · '));
console.log(bold('\nBrand packs') + dim(' (optional: pass --brand <id> to apply one)'));
for (const id of listBrands()) {
  try {
    const b = loadBrand(id);
    console.log(`  ${bold(id)}  ${b.name}${b.regulated ? ' (regulated)' : ''}`);
  } catch (error) {
    console.log(`  ${bold(id)}  ${red(error instanceof Error ? error.message : String(error))}`);
  }
}
