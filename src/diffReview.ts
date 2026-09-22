import type { GraphData } from './types';

export type RiskLevel = 'high' | 'medium' | 'low';

export interface MethodReview {
  id: string;
  level: RiskLevel;
  /** Higher means look at it sooner. */
  score: number;
  /** Methods that call this one directly. */
  callers: number;
  /** Direct callers that this change did not touch, so nothing checked they still work. */
  notUpdated: number;
  /** Files those untouched callers live in. */
  files: number;
  /** Test files that reach this method through the calls found. Zero means none was found, not that none exists. */
  tests: number;
  /** How its signature changed, when that could be worked out. */
  signature?: 'breaking' | 'compatible';
}

export interface DiffReview {
  /** Every changed method, riskiest first. */
  methods: MethodReview[];
  byId: Map<string, MethodReview>;
  risky: number;
  /** Distinct untouched methods that call something this change modified. */
  notUpdated: number;
  /** Modified methods with no test found reaching them. */
  untested: number;
  /** Methods whose signature changed. */
  signatureChanges: number;
  /** Removed methods something still appears to call. */
  removed: number;
}

/**
 * How far a change reaches beyond itself. A new method cannot break an existing caller, so it is never risky;
 * a modified one is riskier the more untouched callers it has, and the more files they are spread over.
 */
export function reviewDiff(data: GraphData): DiffReview | null {
  const diff = data.diff;
  if (!diff) return null;
  const fileOf = new Map<string, string>();
  for (const f of data.files) for (const sym of f.symbols) fileOf.set(sym.id, f.id);

  const callersOf = new Map<string, Set<string>>();
  for (const e of data.edges) {
    if (e.source === e.target || !diff.changes[e.target]) continue;
    (callersOf.get(e.target) ?? callersOf.set(e.target, new Set()).get(e.target)!).add(e.source);
  }

  // Tests reach a method directly or through anything that calls it, as far up as the graph goes.
  const testsReaching = (id: string): number => {
    const seen = new Set([id]);
    const files = new Set<string>();
    const queue = [id];
    while (queue.length > 0) {
      const at = queue.pop()!;
      (diff.testedBy?.[at] ?? []).forEach((t) => files.add(t));
      for (const c of callersAll.get(at) ?? []) {
        if (!seen.has(c)) {
          seen.add(c);
          queue.push(c);
        }
      }
    }
    return files.size;
  };
  const callersAll = new Map<string, string[]>();
  for (const e of data.edges) (callersAll.get(e.target) ?? callersAll.set(e.target, []).get(e.target)!).push(e.source);

  const untouched = new Set<string>();
  const methods: MethodReview[] = Object.keys(diff.changes)
    .filter((id) => fileOf.has(id))
    .map((id) => {
      const callers = [...(callersOf.get(id) ?? [])];
      const outside = diff.changes[id].kind === 'added' ? [] : callers.filter((c) => !diff.changes[c]);
      outside.forEach((c) => untouched.add(c));
      const files = new Set(outside.map((c) => fileOf.get(c) ?? c)).size;
      const signature = diff.signatures?.[id]?.change;
      const tests = testsReaching(id);
      const isNew = diff.changes[id].kind === 'added';
      const level: RiskLevel = isNew
        ? 'low'
        : outside.length >= 5 || files >= 3 || (signature === 'breaking' && outside.length >= 1) || (outside.length >= 3 && tests === 0)
          ? 'high'
          : outside.length >= 1 || signature === 'breaking'
            ? 'medium'
            : 'low';
      const score = outside.length * 3 + files * 2 + callers.length + (signature === 'breaking' ? 5 : 0) + (!isNew && tests === 0 && outside.length > 0 ? 2 : 0);
      return { id, level, score, callers: callers.length, notUpdated: outside.length, files, tests, signature };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  return {
    methods,
    byId: new Map(methods.map((m) => [m.id, m])),
    risky: methods.filter((m) => m.level !== 'low').length,
    notUpdated: untouched.size,
    untested: methods.filter((m) => diff.changes[m.id].kind !== 'added' && m.tests === 0).length,
    signatureChanges: methods.filter((m) => m.signature).length,
    removed: diff.removed ?? 0,
  };
}
