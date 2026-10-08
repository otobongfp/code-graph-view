import type { ParsedCallable, ParsedParam } from './tsSignature';

export interface SignatureChange {
  /** 'breaking' when existing callers may no longer fit; 'compatible' when the only change is extra optional parameters. */
  change: 'breaking' | 'compatible';
  before: string;
  after: string;
  breakdown?: string[];
}

const squash = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const isOptional = (p: ParsedParam) => p.optional || p.defaultValue !== undefined || p.rest;
/** What a caller has to get right for this parameter; names do not matter to callers. */
const shape = (p: ParsedParam) => `${p.rest ? '...' : ''}${squash(p.type)}`;

export function formatCallable(c: ParsedCallable): string {
  const params = c.params
    .map((p) => `${p.rest ? '...' : ''}${p.name}${p.optional ? '?' : ''}${p.type ? `: ${squash(p.type)}` : ''}`)
    .join(', ');
  return `(${params})${c.returnType ? `: ${squash(c.returnType)}` : ''}`;
}

/** Compares two versions of a method's signature; undefined when callers see no difference. */
export function compareCallables(before: ParsedCallable, after: ParsedCallable): SignatureChange | undefined {
  const sameReturn = !before.returnType || !after.returnType || squash(before.returnType) === squash(after.returnType);
  const sameParams =
    before.params.length === after.params.length &&
    before.params.every((p, i) => shape(p) === shape(after.params[i]) && isOptional(p) === isOptional(after.params[i]));
  if (sameParams && sameReturn) return undefined;

  const keeps =
    before.params.length <= after.params.length &&
    before.params.every((p, i) => shape(p) === shape(after.params[i]) && (!isOptional(p) || isOptional(after.params[i]))) &&
    after.params.slice(before.params.length).every(isOptional);

  const breakdown: string[] = [];
  if (!sameReturn) {
    breakdown.push(`Return type changed from '${squash(before.returnType) || 'void'}' to '${squash(after.returnType) || 'void'}'`);
  }

  const minLen = Math.min(before.params.length, after.params.length);
  for (let i = 0; i < minLen; i++) {
    const bp = before.params[i];
    const ap = after.params[i];
    if (shape(bp) !== shape(ap)) {
      breakdown.push(`Parameter '${ap.name}' type changed from '${bp.type || 'any'}' to '${ap.type || 'any'}'`);
    }
    if (isOptional(bp) && !isOptional(ap)) {
      breakdown.push(`Parameter '${ap.name}' became required (was optional)`);
    } else if (!isOptional(bp) && isOptional(ap)) {
      breakdown.push(`Parameter '${ap.name}' became optional`);
    }
  }

  if (before.params.length > after.params.length) {
    const removedNames = before.params.slice(after.params.length).map((p) => `'${p.name}'`).join(', ');
    breakdown.push(`Removed parameter(s): ${removedNames}`);
  } else if (after.params.length > before.params.length) {
    for (let i = before.params.length; i < after.params.length; i++) {
      const ap = after.params[i];
      if (isOptional(ap)) {
        breakdown.push(`Added optional parameter '${ap.name}'${ap.defaultValue ? ` with default (${ap.defaultValue})` : ''}`);
      } else {
        breakdown.push(`Added required parameter '${ap.name}'`);
      }
    }
  }

  return {
    change: keeps && sameReturn ? 'compatible' : 'breaking',
    before: formatCallable(before),
    after: formatCallable(after),
    breakdown: breakdown.length ? breakdown : undefined,
  };
}
