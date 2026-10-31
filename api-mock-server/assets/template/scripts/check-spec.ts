// Fails when spec/openapi.yaml is not a valid OpenAPI 3.0 or 3.1 document. The mock
// still starts with an invalid spec (it warns), but validation results against an
// invalid contract cannot be trusted, so verify treats this as a failure.
import { Contract } from '../src/core/contract.ts';
import { config } from '../src/core/config.ts';

const contract = await Contract.load(config.specPath, config.basePath);
console.log(`OpenAPI ${contract.version}, ${contract.operations.length} operations, base path "${config.basePath || '/'}".`);
if (contract.documentProblems.length) {
  console.log(`\n${contract.documentProblems.length} problem(s):\n${contract.documentProblems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('The spec is a valid OpenAPI document.');
