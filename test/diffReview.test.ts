import * as assert from 'assert';
import { reviewDiff } from '../src/diffReview';
import type { GraphData } from '../src/types';

const sym = (id: string) => ({ id, name: id, kind: 'function' as const, line: 0, character: 0 });

function graph(changes: Record<string, 'added' | 'modified'>, edges: Array<[string, string]>, files: Record<string, string[]>): GraphData {
  return {
    rootFile: '/w',
    rootFileId: 'diff:x',
    rootLabel: 'x',
    roots: Object.keys(changes),
    maxDepth: 3,
    truncated: false,
    fetchMs: 0,
    files: Object.entries(files).map(([id, syms]) => ({ id, label: id, file: `/w/${id}`, symbols: syms.map(sym) })),
    edges: edges.map(([source, target]) => ({ id: `${source}>${target}`, source, target })),
    diff: {
      source: 'x',
      title: 'x',
      summary: '',
      changes: Object.fromEntries(Object.entries(changes).map(([id, kind]) => [id, { kind, lines: 1 }])),
      other: [],
      approximate: false,
    },
  } as unknown as GraphData;
}

describe('Feature: Diff review risk', () => {
  it('is null outside the changes view', () => {
    const g = graph({}, [], {});
    delete (g as { diff?: unknown }).diff;
    assert.strictEqual(reviewDiff(g), null);
  });

  it('counts callers the change did not touch, and the files they sit in', () => {
    const g = graph(
      { a: 'modified', c: 'modified' },
      [['x1', 'a'], ['x2', 'a'], ['c', 'a'], ['a', 'a']],
      { f1: ['a', 'c'], f2: ['x1'], f3: ['x2'] }
    );
    const r = reviewDiff(g)!;
    const a = r.byId.get('a')!;
    assert.strictEqual(a.callers, 3, 'recursion is not a caller');
    assert.strictEqual(a.notUpdated, 2, 'c changed too, so it is not "not updated"');
    assert.strictEqual(a.files, 2);
    assert.strictEqual(a.level, 'medium');
    assert.strictEqual(r.notUpdated, 2);
  });

  it('is high when many callers or many files depend on it, low when nothing does', () => {
    const many = graph(
      { a: 'modified', b: 'modified' },
      [['x1', 'a'], ['x2', 'a'], ['x3', 'a']],
      { f1: ['a', 'b'], f2: ['x1'], f3: ['x2'], f4: ['x3'] }
    );
    const r = reviewDiff(many)!;
    assert.strictEqual(r.byId.get('a')!.level, 'high', 'three files');
    assert.strictEqual(r.byId.get('b')!.level, 'low');
    assert.strictEqual(r.risky, 1);
    assert.deepStrictEqual(r.methods.map((m) => m.id), ['a', 'b'], 'riskiest first');
  });

  it('never calls a new method risky', () => {
    const g = graph({ n: 'added' }, [['x', 'n']], { f1: ['n'], f2: ['x'] });
    assert.strictEqual(reviewDiff(g)!.byId.get('n')!.level, 'low');
  });

  it('counts tests that reach a method directly or through a caller, and never treats their absence as proof', () => {
    const g = graph({ a: 'modified', b: 'modified' }, [['x', 'a']], { f1: ['a', 'b'], f2: ['x'] });
    g.diff!.testedBy = { x: ['t/x.test.ts'] };
    const r = reviewDiff(g)!;
    assert.strictEqual(r.byId.get('a')!.tests, 1, 'the test calls x, which calls a');
    assert.strictEqual(r.byId.get('b')!.tests, 0);
    assert.strictEqual(r.untested, 1);
  });

  it('a breaking signature change with an untouched caller is high risk; a compatible one is not', () => {
    const g = graph({ a: 'modified', b: 'modified' }, [['x', 'a'], ['y', 'b']], { f1: ['a', 'b'], f2: ['x', 'y'] });
    g.diff!.signatures = {
      a: { change: 'breaking', before: '(a: string)', after: '(a: number)' },
      b: { change: 'compatible', before: '(a: string)', after: '(a: string, b?: number)' },
    };
    const r = reviewDiff(g)!;
    assert.strictEqual(r.byId.get('a')!.level, 'high');
    assert.strictEqual(r.byId.get('b')!.level, 'medium', 'it still has an untouched caller');
    assert.strictEqual(r.signatureChanges, 2);
  });
});
