// One entry per outcome a client must handle. The test suite executes every entry and
// the coverage check fails on any documented response or state value with no entry.
// See assets/example-acme-wallet/domain/scenarios.ts.
import type { Scenario } from '../core/types.ts';

export const scenarios: Scenario[] = [];
