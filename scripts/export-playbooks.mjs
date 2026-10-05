// Export every written playbook, with per-sale economics and asymmetry, to PLAYBOOKS.md.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { feeTable, productEconomics, asymmetry } from '../src/core/economics.js';
import { matchPlaybooks } from '../src/core/playbook.js';
import { assess } from '../src/core/scoring.js';
import { mergeDuplicates } from '../src/data/store.js';

const root = new URL('..', import.meta.url).pathname;
const read = async (p) => JSON.parse(await readFile(`${root}${p}`, 'utf8'));
const fees = await read('research/live/config/fees.json').then((f) => f.data || f).catch(() => null);
const table = feeTable(fees, {});
// Sources, later ones winning: the seed set, a downloaded live snapshot (ArtifactData out_dir
// layout: <dir>/<collection>/<id>.json) and freshly filed docs (<collection>__<id>.json).
// Usage: node scripts/export-playbooks.mjs [snapshotDir ...]
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ['research/live/snap1', 'research/seed/inbox'];
const state = { candidates: new Map(), evidence: new Map(), playbooks: new Map() };
const put = (col, d) => d && state[col] && state[col].set(d.id || d.candidateId, d);
const flat = async (dir) => {
  for (const f of await readdir(`${root}${dir}`).catch(() => [])) {
    const [col] = f.split('__');
    if (f.endsWith('.json') && state[col]) put(col, await read(`${dir}/${f}`));
  }
};
await flat('research/seed/docs');
await flat('research/seed/playbooks');
for (const dir of dirs) {
  await flat(dir);
  for (const col of Object.keys(state)) for (const f of await readdir(`${root}${dir}/${col}`).catch(() => [])) put(col, await read(`${dir}/${col}/${f}`).then((d) => d.data || d));
}
const { candidates: cands, evidenceBy } = mergeDuplicates([...state.candidates.values()], (() => {
  const m = new Map();
  for (const e of state.evidence.values()) {
    if (!m.has(e.candidateId)) m.set(e.candidateId, []);
    m.get(e.candidateId).push(e);
  }
  return m;
})());
const docs = new Map([...state.playbooks.values()].map((d) => [d.candidateId || d.id, d]));
const now = Date.parse('2026-10-05T12:00:00Z');
const LABEL = { test_now: 'Test now', prepare: 'Prepare', watch: 'Watch', pass: 'Pass' };
const money = (n) => (Number.isFinite(n) ? `$${n.toFixed(2)}` : 'unknown');
const rows = [];
const sections = [];
for (const c of cands) {
  const gated = assess(c, evidenceBy.get(c.id) || [], {}, now).gate.action;
  if (!c.products?.length) continue;
  const matched = matchPlaybooks(c, docs.get(c.id));
  matched.forEach((m, i) => {
    const p = c.products[i];
    const pb = m.playbook;
    const econ = productEconomics(p, pb, table);
    const asym = asymmetry({ product: p, candidate: c, econ, playbook: pb, now });
    rows.push({ c, p, pb, econ, asym, action: gated });
  });
}
rows.sort((a, b) => b.asym.score - a.asym.score);
let md = `# Trendjack make-and-sell playbooks\n\nGenerated ${new Date().toISOString().slice(0, 10)} from the research and playbooks in this repository. The same content, with copy buttons and an editable price, is in the dashboard under each product.\n\nPlaybooks are guidance, not evidence. Prices and POD costs are estimates unless the dashboard marks them verified; fees use \`config/fees\` (verified ${fees?.checkedAt?.slice(0, 10) || 'not yet'}) where available. Per-sale arithmetic only, never a sales forecast.\n\n## All bets, most asymmetric first\n\n| Product | Trend | Action | Price | Kept per sale | Cash at risk | Break-even | Asymmetry |\n|---|---|---|---|---|---|---|---|\n`;
for (const r of rows) {
  md += `| ${r.pb.productName || r.p.theme.slice(0, 50)} | ${r.c.name} | ${LABEL[r.action]} | ${money(r.econ.price)} | ${money(r.econ.primary?.net)} (${r.econ.primary?.label || '-'}) | ${money(r.econ.cashAtRisk)} | ${r.econ.breakEven ?? '-'} | ${r.asym.label} (${r.asym.score}) |\n`;
}
md += `\nAction is the trend's recommendation after the dashboard's evidence gates. Asymmetry rates the shape of the bet, not whether the trend has proven demand: check both.\n`;
for (const r of rows) {
  const { pb } = r;
  md += `\n---\n\n## ${pb.productName || r.p.theme}\n\n**Trend:** ${r.c.name} (${LABEL[r.action]}) · **Format:** ${r.p.format} (${r.p.fulfillment === 'pod' ? 'print on demand' : 'digital'}) · **Asymmetry:** ${r.asym.label} (${r.asym.score}/100)\n\n`;
  md += `**Buyer:** ${r.p.buyer}\n\n`;
  md += `### Super prompt\n\n\`\`\`text\n${pb.superPrompt}\n\`\`\`\n\n`;
  pb.imagePrompts.forEach((ip, i) => (md += `**Image prompt ${i + 1} (${ip.purpose}; ${ip.tool}):**\n\n\`\`\`text\n${ip.prompt}\n\`\`\`\n\n`));
  if (pb.assembly.length) md += `### Build and export\n\n${pb.assembly.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n`;
  if (pb.listingPrompt) md += `### Listing copy prompt\n\n\`\`\`text\n${pb.listingPrompt}\n\`\`\`\n\n`;
  md += `### Where to list\n\n${pb.platforms.map((p) => `- **${p.name}** (${p.role}): ${p.why}`).join('\n')}\n\n`;
  if (pb.marketing.positioning) md += `**Positioning:** ${pb.marketing.positioning}\n\n`;
  if (pb.marketing.launchPlan.length) md += `### Launch plan\n\n${pb.marketing.launchPlan.map((s) => `- **${s.day}:** ${s.action}`).join('\n')}\n\n`;
  if (pb.marketing.channels.length) md += `### Marketing channels\n\n| Channel | What to do | How often |\n|---|---|---|\n${pb.marketing.channels.map((c) => `| ${c.channel} | ${c.tactic.replace(/\|/g, '/')} | ${c.cadence} |`).join('\n')}\n\n`;
  if (pb.marketing.keywords.length) md += `**Search phrases to test (suggestions, not measured volumes):** ${pb.marketing.keywords.join(', ')}\n\n`;
  if (pb.marketing.hooks.length) md += `**Hooks:**\n${pb.marketing.hooks.map((h) => `- ${h}`).join('\n')}\n\n`;
  md += `### Profit per sale\n\nSuggested price ${money(pb.pricing.recommended)} (range ${money(pb.pricing.low)}–${money(pb.pricing.high)}, ${pb.pricing.basis}). ${pb.pricing.rationale}\n\n| Channel | Price | Fees | Product + shipping | You keep | Margin |\n|---|---|---|---|---|---|\n`;
  md += r.econ.rows.map((x) => `| ${x.label} | ${money(x.price)} | ${money(x.fees)} | ${x.unknownCost ? 'unknown' : money(x.cost)} | **${money(x.net)}** | ${x.marginPct == null ? '-' : x.marginPct + '%'} |`).join('\n');
  md += `\n\nProduct cost basis: ${r.econ.cost.basis}. Cash at risk ${money(r.econ.cashAtRisk)}; break-even ${r.econ.breakEven ?? 'not computable'} sale(s).\n\n`;
  md += `### Asymmetry\n\n- **Risk:** ${money(r.asym.downside.cash)} and about ${r.asym.downside.hours} hours; answer in about ${r.asym.downside.killDays} days.\n`;
  if (pb.asymmetry.downside) md += `- **What you risk:** ${pb.asymmetry.downside}\n`;
  if (pb.asymmetry.upside) md += `- **What stays open:** ${pb.asymmetry.upside}\n`;
  if (pb.asymmetry.badBetIf) md += `- **Bad bet if:** ${pb.asymmetry.badBetIf}\n`;
  if (pb.extensions.length) md += `\n**Ways to extend:** ${pb.extensions.join('; ')}\n`;
  if (pb.risks.length) md += `\n**Risks:** ${pb.risks.join('; ')}\n`;
  md += `\n**Validation test:** ${r.p.validationTest}\n\n**Continue if:** ${r.p.continueIf} · **Change direction if:** ${r.p.pivotIf} · **Stop if:** ${r.p.stopIf}\n`;
}
await writeFile(`${root}PLAYBOOKS.md`, md);
console.log(`PLAYBOOKS.md: ${rows.length} playbooks, ${(md.length / 1024).toFixed(0)} KiB`);
for (const r of rows) console.log(`${r.asym.score} ${r.asym.label.padEnd(20)} ${money(r.econ.primary?.net).padStart(7)} BE ${String(r.econ.breakEven ?? '-').padStart(2)} | ${(r.pb.productName || '').slice(0, 55)} [${r.action}]`);
