import type { MockHandler } from '../../core/types.ts';

// Keyed by operationId. Operations without a handler fall back to the spec's examples.
export const handlers: Record<string, MockHandler> = {};
