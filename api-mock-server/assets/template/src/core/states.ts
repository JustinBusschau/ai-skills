// Discovers the state values a client must be able to reach (in schemas that responses
// can contain): enum values of
// state-like fields (status, state, stage, step, phase, outcome, result, decision,
// verification) anywhere inside each schema in components.schemas, including
// properties merged in through allOf/oneOf/anyOf, nested objects, array items and
// tuples (prefixItems), and maps (additionalProperties, patternProperties).
// Each is labelled "Schema.path.to.field=value"; arrays add no segment, so
// "Order.lines.status=shipped" means some element of lines has status "shipped", and a
// map adds "*", so "Order.fulfilment.*.status=packed" means some entry of the map.
// Nested properties that $ref another component schema are not followed, because that
// schema is labelled in its own right; enums reached through $ref are.
import { type Contract, getPointer } from './contract.ts';

export const STATE_FIELD = /(status|state|stage|step|phase|outcome|result|decision|verification)$/i;

export interface StateValue {
  label: string;
  schema: string;
  path: string[];
  value: string;
}

export function stateValues(contract: Contract): StateValue[] {
  const doc = contract.doc;
  const deref = (node: any): any => {
    for (let i = 0; i < 10 && node && typeof node.$ref === 'string' && node.$ref.startsWith('#'); i++) node = getPointer(doc, node.$ref);
    return node;
  };
  // Every value the field can take: inline or referenced enums, const values, the union
  // of every oneOf/anyOf/allOf branch (oneOf of const is a common 3.1 idiom), and the
  // items of an array of enum values.
  const enumOf = (node: any, depth = 0): unknown[] | undefined => {
    node = deref(node);
    if (!node || typeof node !== 'object' || depth > 5) return undefined;
    const values = new Set<unknown>();
    if (Array.isArray(node.enum)) for (const v of node.enum) values.add(v);
    if (node.const !== undefined && typeof node.const !== 'object') values.add(node.const);
    for (const key of ['allOf', 'oneOf', 'anyOf']) {
      for (const sub of node[key] ?? []) for (const v of enumOf(sub, depth + 1) ?? []) values.add(v);
    }
    if (node.items && typeof node.items === 'object') for (const v of enumOf(node.items, depth + 1) ?? []) values.add(v);
    return values.size ? [...values] : undefined;
  };
  const out = new Map<string, StateValue>();
  const walk = (schemaName: string, node: any, path: string[], depth: number, top: boolean) => {
    if (!node || typeof node !== 'object' || depth > 6) return;
    // Follow a $ref only at the top of a component (its own allOf parts); nested
    // references to other components are labelled under their own name.
    if (typeof node.$ref === 'string') {
      if (!top) return;
      node = deref(node);
      if (!node) return;
    }
    for (const key of ['allOf', 'oneOf', 'anyOf']) for (const sub of node[key] ?? []) walk(schemaName, sub, path, depth + 1, top);
    if (node.items && typeof node.items === 'object') walk(schemaName, node.items, path, depth + 1, false);
    for (const sub of Array.isArray(node.prefixItems) ? node.prefixItems : []) walk(schemaName, sub, path, depth + 1, false);
    if (node.additionalProperties && typeof node.additionalProperties === 'object') walk(schemaName, node.additionalProperties, [...path, '*'], depth + 1, false);
    for (const sub of Object.values<any>(node.patternProperties ?? {})) walk(schemaName, sub, [...path, '*'], depth + 1, false);
    for (const [prop, def] of Object.entries<any>(node.properties ?? {})) {
      const values = STATE_FIELD.test(prop) ? enumOf(def) : undefined;
      if (values) {
        for (const v of values) {
          if (v === null) continue;
          const p = [...path, prop];
          const label = `${schemaName}.${p.join('.')}=${String(v)}`;
          out.set(label, { label, schema: schemaName, path: p, value: String(v) });
        }
      } else {
        walk(schemaName, def, [...path, prop], depth + 1, false);
      }
    }
  };
  // Only schemas a response can contain: a value that only ever appears in requests
  // (a decision the client sends) is chosen by the client, not reached through the mock.
  const inResponses = responseSchemas(contract);
  for (const [name, schema] of Object.entries<any>(doc.components?.schemas ?? {})) if (inResponses.has(name)) walk(name, schema, [], 0, true);
  return [...out.values()];
}

/** Names of component schemas reachable, through $refs, from any operation's responses. */
export function responseSchemas(contract: Contract): Set<string> {
  const names = new Set<string>();
  const seen = new Set<unknown>();
  const visit = (node: any) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (typeof node.$ref === 'string' && node.$ref.startsWith('#')) {
      const m = /^#\/components\/schemas\/([^/]+)$/.exec(node.$ref);
      if (m) names.add(m[1]!.replace(/~1/g, '/').replace(/~0/g, '~'));
      visit(getPointer(contract.doc, node.$ref));
    }
    for (const v of Object.values(node)) visit(v);
  };
  for (const op of contract.operations) for (const ptr of Object.values(op.responses)) visit(getPointer(contract.doc, ptr));
  return names;
}

/** Parse "Schema.path.to.field=value". */
export function parseLabel(label: string): { schema: string; path: string[]; value: string } | undefined {
  const m = /^([^.=]+)\.([^=]+)=(.*)$/.exec(label);
  return m ? { schema: m[1]!, path: m[2]!.split('.'), value: m[3]! } : undefined;
}

/** Values found at `path` inside `value`, descending through arrays at any step. */
export function valuesAt(value: unknown, path: string[]): unknown[] {
  if (Array.isArray(value)) return value.flatMap((v) => valuesAt(v, path));
  if (!path.length) return [value];
  if (!value || typeof value !== 'object') return [];
  const obj = value as Record<string, unknown>;
  if (path[0] === '*') return Object.values(obj).flatMap((v) => valuesAt(v, path.slice(1)));
  return valuesAt(obj[path[0]!], path.slice(1));
}

/**
 * Property names a schema declares (merging allOf/oneOf/anyOf), or undefined when it
 * accepts properties it does not name, in which case key checks cannot be applied.
 */
export function declaredProperties(contract: Contract, schemaName: string): Set<string> | undefined {
  const names = new Set<string>();
  let open = false;
  const visit = (node: any, depth: number) => {
    for (let i = 0; i < 10 && node && typeof node.$ref === 'string' && node.$ref.startsWith('#'); i++) node = getPointer(contract.doc, node.$ref);
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (node.additionalProperties !== undefined && node.additionalProperties !== false) open = true;
    if (node.patternProperties) open = true;
    for (const name of Object.keys(node.properties ?? {})) names.add(name);
    for (const key of ['allOf', 'oneOf', 'anyOf']) for (const sub of node[key] ?? []) visit(sub, depth + 1);
  };
  visit(contract.doc.components?.schemas?.[schemaName], 0);
  return open || names.size === 0 ? undefined : names;
}

/**
 * True when some object inside `body` is an instance of the label's schema and has the
 * labelled value at the labelled path. "Instance" means it validates against the schema
 * and, where the schema lists its properties exhaustively (the usual case: no
 * additionalProperties), carries no property the schema does not declare. So a
 * KycApplication with status "pending" cannot satisfy "Payment.status=pending" unless
 * the two schemas are indistinguishable; looseSchemas() reports where that is possible.
 */
export function bodyProves(contract: Contract, body: unknown, label: string): boolean {
  const parsed = parseLabel(label);
  if (!parsed) return false;
  const declared = declaredProperties(contract, parsed.schema);
  const visit = (node: unknown): boolean => {
    if (Array.isArray(node)) return node.some(visit);
    if (!node || typeof node !== 'object') return false;
    const hit = valuesAt(node, parsed.path).some((v) => v !== null && typeof v !== 'object' && String(v) === parsed.value);
    const keysFit = !declared || Object.keys(node).every((k) => declared.has(k));
    if (hit && keysFit && contract.matchesSchema(parsed.schema, node)) return true;
    return Object.values(node).some(visit);
  };
  return visit(body);
}

/**
 * Schemas whose proofs are weak: they declare no required properties, or accept
 * properties they do not name, so another resource could validate as them.
 */
export function looseSchemas(contract: Contract, names: Iterable<string>): string[] {
  const out: string[] = [];
  for (const name of new Set(names)) {
    const schema = contract.doc.components?.schemas?.[name];
    if (!schema) continue;
    const required = new Set<string>();
    const collect = (node: any, depth: number) => {
      for (let i = 0; i < 10 && node && typeof node.$ref === 'string' && node.$ref.startsWith('#'); i++) node = getPointer(contract.doc, node.$ref);
      if (!node || typeof node !== 'object' || depth > 6) return;
      for (const r of node.required ?? []) required.add(r);
      for (const sub of node.allOf ?? []) collect(sub, depth + 1);
    };
    collect(schema, 0);
    if (!required.size || !declaredProperties(contract, name)) out.push(name);
  }
  return out;
}
