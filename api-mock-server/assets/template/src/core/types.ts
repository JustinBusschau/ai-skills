// Shared types for the mock runtime. Domain code (src/domain) implements these;
// core code (src/core) only depends on the shapes, never on a specific API.
import type { State } from '../domain/state.ts';

export interface MockResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** A request that has passed contract validation, with params and query coerced to their schema types. */
export interface MockRequest {
  operationId: string;
  method: string;
  /** The path as sent, including the base path and query string. */
  url: string;
  params: Record<string, any>;
  query: Record<string, any>;
  headers: Record<string, string | string[] | undefined>;
  cookies: Record<string, any>;
  body: any;
  /** Files from a multipart body, by field name. Their body field holds a short text marker. */
  files: Record<string, UploadedFile>;
}

export interface UploadedFile {
  filename: string;
  contentType: string;
  size: number;
}

export interface Principal {
  /** Identifier of the authenticated subject in State (a user, merchant, client, ...). */
  subjectId: string;
  /** Set when the subject was seeded from a persona. */
  personaId?: string;
  /** Credential that authenticated the request, so sign-out handlers can revoke it. */
  credential?: string;
}

export interface ScheduledTask {
  at: number; // virtual epoch ms
  label: string;
  run: (mc: MockContext) => void;
}

export interface ArmedScenario {
  operationId: string;
  scenarioId: string;
  remaining: number;
}

export interface RequestLogEntry {
  at: string;
  method: string;
  path: string;
  operationId?: string;
  status: number;
  scenario?: string;
  undocumented?: boolean;
}

export interface WebhookLogEntry {
  at: string;
  event: string;
  target?: string;
  delivered: boolean;
  status?: number;
  error?: string;
  contractProblems?: unknown[];
  payload: unknown;
}

export interface SessionClock {
  /** Set while the clock is frozen: virtual time stands still except for explicit advances. */
  frozenAt?: number;
  /** Offset from real time while the clock is live. */
  offsetMs: number;
}

export interface Session {
  id: string;
  state: State;
  createdAt: number;
  lastSeenAt: number;
  clock: SessionClock;
  scheduled: ScheduledTask[];
  armed: ArmedScenario[];
  requestLog: RequestLogEntry[];
  webhookTarget?: string;
  webhookLog: WebhookLogEntry[];
  /** Counts API requests, so each gets a reproducible request id (see MockContext.requestId). */
  requestSeq: number;
  /** Counts internal contexts (scheduled work, actions), kept apart from requestSeq. */
  internalSeq: number;
  /**
   * Virtual time (epoch ms) when the session was created. Seed data given relative to
   * "today" should anchor here, so it does not drift as the clock is advanced.
   */
  startedAt: number;
  /** Responses already given for an idempotency key, by "<operationId>:<key>". */
  idempotency: Record<string, { fingerprint: string; result: MockResult }>;
}

export interface MockContext {
  session: Session;
  state: State;
  principal?: Principal;
  /** Virtual "now" for this session. Use it instead of Date.now() everywhere in domain code. */
  now: () => Date;
  /** Schedule a state change at a virtual time; it runs on the first request (or clock advance) after that time. */
  schedule: (delayMs: number, label: string, run: (mc: MockContext) => void) => void;
  /** Queue a webhook for delivery to the session's registered target. */
  emitWebhook: (event: string, payload: unknown) => void;
  /** Build an error result in the contract's error envelope. */
  error: (status: number, code: string, message: string, details?: unknown) => MockResult;
  /** Scenario ids requested through X-Mock-Scenario or armed via /__mock/arm for this operation. */
  scenarios: Set<string>;
  /**
   * A UUID unique within the session and the same on every run of the same requests,
   * for correlation ids and similar. Also passed to domain.errorBody.
   */
  requestId: string;
  /** Origin the caller reached the mock at (or MOCK_PUBLIC_URL), for absolute links. */
  origin: string;
  /** Absolute URL of a simulated provider page (see Domain.providers) for this session. */
  providerUrl: (provider: string, ref: string) => string;
  /**
   * Absolute, signed URL that serves a file from Domain.files for this session until
   * `expiresAt` (virtual time), for contracts that hand out short-lived download links.
   */
  fileUrl: (ref: string, expiresAt: Date) => string;
}

export type MockHandler = (req: MockRequest, mc: MockContext) => MockResult | Promise<MockResult>;

export interface Persona {
  id: string;
  summary: string;
  /** How a client authenticates as this persona, in human-readable form for the catalogue. */
  credentials: Record<string, string>;
  /** Re-seed this persona's data every time it signs in, so a journey can be replayed without an explicit reset. */
  resetOnSignIn?: boolean;
}

export interface ScenarioRequest {
  method: string;
  /** Concrete path including the base path and path parameters, e.g. /v1/payments/pay_declined_001 */
  path: string;
  persona?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
  /**
   * How to encode body: application/json (default), application/x-www-form-urlencoded, or
   * multipart/form-data. In multipart, an object value is sent as a JSON part and
   * { $file: { filename, contentType, content } } as a file part.
   */
  contentType?: 'application/json' | 'application/x-www-form-urlencoded' | 'multipart/form-data';
  /** For setup steps: the status the step must return (default: any 2xx or 3xx). */
  expectStatus?: number;
}

export type ScenarioTrigger =
  | 'default' // the normal response for an ordinary valid request
  | 'persona' // reached by authenticating as a specific persona
  | 'input' // reached by sending a documented magic value
  | 'state' // reached after earlier calls or a clock advance (see setup)
  | 'header'; // reached only through X-Mock-Scenario or /__mock/arm

export interface Scenario {
  /** Stable id, conventionally <operationId>.<outcome>, e.g. createPayment.card_declined */
  id: string;
  operationId: string;
  status: number;
  /** Required for 4xx and 5xx: the error code clients branch on, as domain.errorCodeOf reads it. */
  errorCode?: string;
  summary: string;
  trigger: ScenarioTrigger;
  /** Plain instruction for a client developer: what to send to get this outcome. */
  how: string;
  /**
   * State labels this scenario demonstrates, as "Schema.field=value". The test suite
   * checks that the response body really contains field === value somewhere.
   */
  covers?: string[];
  /** Required when trigger is "header": the forced response. Runs after auth and request validation. */
  respond?: (mc: MockContext, req: MockRequest) => MockResult;
  /** Calls to make first (in the same fresh session) to reach the state under test. */
  setup?: ScenarioRequest[];
  /** Advance the session clock by this many seconds after setup and before the request. */
  advanceClockSeconds?: number;
  /** Executable example used by the test suite to prove the scenario is reachable. */
  request: ScenarioRequest;
}

export interface Domain {
  name: string;
  createState: () => State;
  personas: Persona[];
  scenarios: Scenario[];
  handlers: Record<string, MockHandler>;
  /**
   * Identify the caller from credentials. Return undefined for anonymous, invalid, or
   * expired credentials; `now` is the session's virtual time, for token expiry.
   */
  resolvePrincipal: (headers: Record<string, string | string[] | undefined>, state: State, now: Date) => Principal | undefined;
  /** Headers that authenticate as a persona; used by the test suite and shown in the catalogue. */
  authHeadersFor: (personaId: string) => Record<string, string>;
  /** Persona the generated checks authenticate as (defaults to the first persona). */
  checkPersona?: string;
  /**
   * Error body in the contract's error envelope. `code` is either a domain code or one of
   * the runtime's own (validation_failed, unauthenticated, not_found, method_not_allowed,
   * internal_error, service_unavailable, rate_limited, mock_*); map them onto the
   * contract's codes. meta.requestId suits a correlation id.
   */
  errorBody: (status: number, code: string, message: string, details?: unknown, meta?: { requestId: string }) => unknown;
  /** Read the error code back out of an error body; the tests use it to check scenarios' errorCode. */
  errorCodeOf: (body: unknown) => string | undefined;
  /** Optional: content type for error responses, e.g. application/problem+json. Defaults to JSON. */
  errorContentType?: string;
  /** Status the contract uses for request validation failures (400 or 422 usually). */
  validationErrorStatus: number;
  /** Optional: restore one persona's seeded data inside a session without touching anything else. */
  resetPersona?: (state: State, personaId: string) => boolean;
  /** Optional: events a client developer can fire on demand through POST /__mock/webhooks/trigger. */
  webhookTriggers?: Record<string, (mc: MockContext, input: Record<string, unknown>) => unknown>;
  /**
   * Optional: where each event's payload schema lives, for events whose name is not a
   * key of the spec's 3.1 `webhooks` section: an operationId (3.0 specs that document
   * webhooks as paths) or a `webhooks` key.
   */
  webhookContracts?: Record<string, string>;
  /**
   * Optional: off-app events a tester can trigger through POST /__mock/actions/<name>
   * (an underwriting decision, a back-office completion), so states the client cannot
   * cause itself are still reachable on demand.
   */
  actions?: Record<string, BackOfficeAction>;
  /**
   * Optional: simulated third-party pages (identity checks, card checkouts, signing) that
   * the client opens in a WebView. Served at /__mock/providers/<name>/<ref> without a
   * token, behind a per-session signed URL from mc.providerUrl().
   */
  providers?: Record<string, ProviderPage>;
  /**
   * Optional: file content for links made with mc.fileUrl(), served at
   * /__mock/files/<ref> without a token (the URL is signed and expires).
   */
  files?: (mc: MockContext, ref: string) => { filename: string; contentType: string; content: string | Buffer } | undefined;
  /** Optional: headers to sign a webhook delivery with, if the contract documents a signature scheme. */
  signWebhook?: (rawBody: string) => Record<string, string>;
  /**
   * Optional: response headers the domain sets beyond those the spec documents (such as
   * X-Mock-Provider-Url), so browser apps are allowed to read them through CORS.
   */
  exposeHeaders?: string[];
  /** Optional: operationIds that document inbound webhooks rather than client-callable endpoints. */
  webhookOperations?: string[];
  /**
   * Optional: documented outcomes that are deliberately not simulated, keyed
   * "<operationId>.<response key>" or "webhook.<event>", with the reason. The coverage check reports them.
   */
  coverageExemptions?: Record<string, string>;
}

export interface BackOfficeAction {
  summary: string;
  /** Plain description of the JSON body the action takes, if any. */
  input?: string;
  /** Change state; return what the caller should see. Throw an Error with a message to refuse. */
  run: (mc: MockContext, input: Record<string, unknown>) => unknown;
}

export interface ProviderPage {
  title: string;
  /** What the page shows for this reference, or undefined when the reference is unknown. */
  describe: (mc: MockContext, ref: string) => { summary: string; outcomes: { id: string; label: string }[] } | undefined;
  /** Apply the chosen outcome and say where the browser goes next (usually the client's returnUrl). */
  complete: (mc: MockContext, ref: string, outcome: string) => { redirectTo?: string; message?: string };
}
