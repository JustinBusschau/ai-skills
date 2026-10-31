// Outbound webhook delivery. The target URL is registered per session through
// POST /__mock/webhooks/target and must be on MOCK_WEBHOOK_ALLOWED_HOSTS ("host" or
// "host:port"). When the mock is bound beyond loopback, the allow-list is empty
// unless set explicitly, so a shared instance cannot be used to send requests into
// the network it runs on. Redirects are never followed.
//
// Payloads are validated against the contract (a 3.1 `webhooks` entry with the event's
// name, or domain.webhookContracts). In strict mode an invalid payload is recorded
// and not delivered.
import { config } from './config.ts';
import type { Contract } from './contract.ts';
import { pushBounded } from './util.ts';
import type { Domain, Session, WebhookLogEntry } from './types.ts';

export function isAllowedWebhookTarget(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (u.username || u.password) return false;
    return config.webhookAllowedHosts.includes(u.host) || config.webhookAllowedHosts.includes(u.hostname);
  } catch {
    return false;
  }
}

export function webhookSchemaFor(domain: Domain, contract: Contract, event: string): string | undefined {
  return contract.webhookSchemaPointer(domain.webhookContracts?.[event] ?? event);
}

export async function deliverWebhook(domain: Domain, contract: Contract, session: Session, event: string, payload: unknown) {
  const entry: WebhookLogEntry = { at: new Date().toISOString(), event, target: session.webhookTarget, delivered: false, payload };
  pushBounded(session.webhookLog, entry);
  const schema = webhookSchemaFor(domain, contract, event);
  if (schema && config.responseValidation !== 'off') {
    const problems = contract.validateWebhook(schema, payload);
    if (problems.length) {
      entry.contractProblems = problems;
      if (config.responseValidation === 'strict') {
        entry.error = 'Payload violates the contract; not delivered.';
        return;
      }
    }
  } else if (!schema) {
    entry.contractProblems = [{ where: 'webhook', message: `No payload schema found for event "${event}"; payload is unchecked.` }];
  }
  if (!session.webhookTarget) {
    entry.error = 'No webhook target registered for this session; event recorded only.';
    return;
  }
  if (!isAllowedWebhookTarget(session.webhookTarget)) {
    entry.error = 'Target is no longer on MOCK_WEBHOOK_ALLOWED_HOSTS; not delivered.';
    return;
  }
  const raw = JSON.stringify(payload);
  try {
    const res = await fetch(session.webhookTarget, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(domain.signWebhook?.(raw) ?? {}) },
      body: raw,
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    entry.status = res.status;
    entry.delivered = res.ok;
    if (res.status >= 300 && res.status < 400) entry.error = 'Target redirected; redirects are not followed.';
  } catch (err) {
    entry.error = err instanceof Error ? err.message : String(err);
  }
}
