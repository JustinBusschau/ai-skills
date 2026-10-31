// Fails when the contract documents an outcome that no executed check can reach.
//   1. Every documented response (exact, range such as 4XX) of every operation must
//      be produced by a registered scenario, a generated check (401, validation), or
//      a built-in fault whose body and headers satisfy that documented response.
//   2. Every state value found by src/core/states.ts (enum values of state-like fields
//      anywhere inside each components schema, including allOf and nested objects)
//      must appear in a scenario's "covers"; the test suite checks that the scenario's
//      response really contains an object of that schema with that value.
//   3. Every operation must have a handler reached by at least one non-header scenario.
//   4. Every webhook the spec documents needs a trigger, and every trigger needs a
//      payload schema to be validated against.
// Anything else needs an entry in domain.coverageExemptions, which is reported.
import { config } from '../src/core/config.ts';
import { generatedChecks } from '../src/core/checks.ts';
import { Contract } from '../src/core/contract.ts';
import { looseSchemas, parseLabel, stateValues } from '../src/core/states.ts';
import { FAULT_STATUSES } from '../src/core/scenarios.ts';
import { webhookSchemaFor } from '../src/core/webhooks.ts';
import { domain } from '../src/domain/index.ts';

const contract = await Contract.load(config.specPath, config.basePath);
const checks = generatedChecks(contract, domain);
const exemptions = domain.coverageExemptions ?? {};
const ok: string[] = [];
const notes: string[] = [];
const gaps: string[] = [];
const row = (tag: string, key: string, text: string) => `  ${tag.padEnd(5)} ${key.padEnd(48)} ${text}`;
const errorHeaders = { 'retry-after': '30', ...(domain.errorContentType ? { 'content-type': domain.errorContentType } : {}) };

for (const op of contract.operations) {
  if (domain.webhookOperations?.includes(op.operationId)) continue;
  // Every operation needs a handler and at least one scenario that reaches it. A scenario
  // forced by header answers from respond() and never touches the handler, so it does
  // not count here.
  if (!domain.handlers[op.operationId]) {
    if (exemptions[op.operationId]) ok.push(row('skip', op.operationId, exemptions[op.operationId]!));
    else gaps.push(row('GAP', op.operationId, 'no handler: clients would get spec examples, not simulated behaviour'));
  } else if (!domain.scenarios.some((s) => s.operationId === op.operationId && s.trigger !== 'header')) {
    if (exemptions[op.operationId]) ok.push(row('skip', op.operationId, exemptions[op.operationId]!));
    else gaps.push(row('GAP', op.operationId, 'no scenario reaches its handler (header-forced scenarios do not count)'));
  }
  for (const key of Object.keys(op.responses)) {
    if (key === 'default') continue;
    const label = `${op.operationId}.${key}`;
    const inKey = (status: number) => contract.responseKey(op, status) === key;
    const scenarios = domain.scenarios.filter((s) => s.operationId === op.operationId && inKey(s.status)).map((s) => s.id);
    const derived = checks.filter((c) => c.operationId === op.operationId && inKey(c.status)).map((c) => c.reason);
    const faults = Object.entries(FAULT_STATUSES)
      // Only an exact status: a 429 fault must not stand in for a whole 4XX range.
      .filter(([, st]) => key === String(st) && !contract.validateResponse(op, st, domain.errorBody(st, 'mock_fault', 'Simulated.'), errorHeaders).length)
      .map(([id]) => id);
    if (scenarios.length) ok.push(row('ok', label, scenarios.join(', ')));
    else if (derived.length) ok.push(row('auto', label, `generated check: ${derived.join('; ')}`));
    else if (faults.length) ok.push(row('auto', label, `built-in ${faults.join(', ')}`));
    else if (exemptions[label]) ok.push(row('skip', label, exemptions[label]));
    else gaps.push(row('GAP', label, 'no scenario, generated check or compatible built-in fault produces this response'));
  }
}
for (const name of looseSchemas(contract, [...new Set(domain.scenarios.flatMap((s) => s.covers ?? []))].map((l) => parseLabel(l)?.schema ?? ''))) {
  notes.push(row('note', name, 'has no required properties or allows undeclared ones, so another resource could prove its covers labels; check those scenarios by hand'));
}
for (const c of checks.filter((x) => !x.documented)) {
  notes.push(row('note', `${c.operationId}.${c.status}`, `sent when ${c.reason}, but not documented; record in ASSUMPTIONS.md`));
}

const labels = new Set(domain.scenarios.flatMap((s) => s.covers ?? []));
const states: string[] = [];
for (const { label } of stateValues(contract)) {
  if (labels.has(label)) states.push(row('ok', label, ''));
  else if (exemptions[label]) states.push(row('skip', label, exemptions[label]!));
  else gaps.push(row('GAP', label, `no scenario declares covers: ["${label}"]`));
}

const hooks: string[] = [];
const triggers = Object.keys(domain.webhookTriggers ?? {});
const mapped = new Set(triggers.map((t) => domain.webhookContracts?.[t] ?? t));
for (const name of contract.webhookNames()) {
  if (mapped.has(name)) hooks.push(row('ok', `webhook.${name}`, 'trigger available'));
  else if (exemptions[`webhook.${name}`]) hooks.push(row('skip', `webhook.${name}`, exemptions[`webhook.${name}`]!));
  else gaps.push(row('GAP', `webhook.${name}`, 'documented webhook has no entry in domain.webhookTriggers'));
}
for (const t of triggers) {
  if (webhookSchemaFor(domain, contract, t)) hooks.push(row('ok', `webhook.${t}`, 'payload validated against the contract'));
  else if (exemptions[`webhook.${t}`]) hooks.push(row('skip', `webhook.${t}`, exemptions[`webhook.${t}`]!));
  else gaps.push(row('GAP', `webhook.${t}`, 'no payload schema; map it in domain.webhookContracts or exempt it'));
}

console.log(`Coverage for ${domain.name} (OpenAPI ${contract.version})\n`);
console.log(ok.sort().join('\n'));
if (states.length) console.log(`\nState values\n${states.join('\n')}`);
if (hooks.length) console.log(`\nWebhooks\n${hooks.join('\n')}`);
if (notes.length) console.log(`\nNotes\n${notes.join('\n')}`);
const skipped = [...ok, ...states, ...hooks].filter((r) => r.trimStart().startsWith('skip')).length;
if (gaps.length) {
  console.log(`\n${gaps.length} gap(s):\n${gaps.join('\n')}`);
  process.exit(1);
}
console.log(`\nEvery documented response, state value and webhook is reachable${skipped ? `, apart from ${skipped} exemption(s) listed above` : ''}.`);
console.log('Reachability is proven by npm test, which executes every scenario and generated check.');
