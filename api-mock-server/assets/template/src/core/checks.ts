// Checks the runtime can derive from the contract alone. They are run by the test
// suite and counted by the coverage report, so "covered" always means "executed":
//   - every secured operation, called without credentials, must return 401;
//   - every operation with a required body or required query/header parameter,
//     called without it, must return the domain's validation status.
// Operations with no required input get no validation check: the coverage report
// then shows their documented validation status as a gap to be covered by a scenario.
import { config } from './config.ts';
import type { Contract } from './contract.ts';
import type { Domain, ScenarioRequest } from './types.ts';

export interface GeneratedCheck {
  id: string;
  operationId: string;
  status: number;
  reason: string;
  /** False when the operation does not document this status; the mock sends it anyway. */
  documented: boolean;
  request: ScenarioRequest;
}

export const PLACEHOLDER_PATH_PARAM = 'mock-check';

export function generatedChecks(contract: Contract, domain: Domain): GeneratedCheck[] {
  const persona = domain.checkPersona ?? domain.personas[0]?.id;
  const checks: GeneratedCheck[] = [];
  for (const op of contract.operations) {
    if (domain.webhookOperations?.includes(op.operationId)) continue;
    const path = config.basePath + op.path.replace(/\{[^}]+\}/g, PLACEHOLDER_PATH_PARAM);
    const add = (status: number, reason: string, request: ScenarioRequest) =>
      checks.push({
        id: `${op.operationId}.${status === 401 ? 'unauthenticated' : 'invalid_request'}`,
        operationId: op.operationId,
        status,
        reason,
        documented: !!contract.responseKey(op, status),
        request,
      });
    if (op.secured) add(401, 'called without credentials', { method: op.method, path });
    if (op.secured && !persona) continue;
    const auth = op.secured ? { persona } : {};
    if (op.requestBody?.required) {
      add(domain.validationErrorStatus, 'called without its required body', { method: op.method, path, ...auth });
    } else {
      const p = op.parameters.find((x) => x.required && (x.in === 'query' || x.in === 'header'));
      if (p) add(domain.validationErrorStatus, `called without required ${p.in} parameter ${p.name}`, { method: op.method, path, ...auth });
    }
  }
  return checks;
}
