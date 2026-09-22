import type { ParsedCallable, ParsedParam } from './tsSignature';

export interface SignatureChange {
  /** 'breaking' when existing callers may no longer fit; 'compatible' when the only change is extra optional parameters. */
  change: 'breaking' | 'compatible';
  before: string;
  after: string;
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
  return {
    change: keeps && sameReturn ? 'compatible' : 'breaking',
    before: formatCallable(before),
    after: formatCallable(after),
  };
}
