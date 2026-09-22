import * as assert from 'assert';
import { declaredNames } from '../src/declarations';
import { parsePullRequestRef } from '../src/pullRequest';
import { compareCallables } from '../src/signatureDiff';
import { parseCallable } from '../src/tsSignature';

const sig = (text: string, name: string) => parseCallable(text, name)!;

describe('Feature: Signature changes', () => {
  it('ignores a body change and a parameter rename', () => {
    assert.strictEqual(compareCallables(sig('function f(a: string) {', 'f'), sig('function f(b: string) {', 'f')), undefined);
  });

  it('calls a removed, retyped or reordered parameter breaking', () => {
    assert.strictEqual(compareCallables(sig('function f(a: string, b: number) {', 'f'), sig('function f(a: string) {', 'f'))!.change, 'breaking');
    assert.strictEqual(compareCallables(sig('function f(a: string) {', 'f'), sig('function f(a: number) {', 'f'))!.change, 'breaking');
    assert.strictEqual(compareCallables(sig('function f(a: string, b: number) {', 'f'), sig('function f(b: number, a: string) {', 'f'))!.change, 'breaking');
  });

  it('calls a new required parameter or a changed return type breaking, a new optional one compatible', () => {
    assert.strictEqual(compareCallables(sig('function f(a: string) {', 'f'), sig('function f(a: string, b: number) {', 'f'))!.change, 'breaking');
    assert.strictEqual(compareCallables(sig('function f(a: string): void {', 'f'), sig('function f(a: string): number {', 'f'))!.change, 'breaking');
    const ext = compareCallables(sig('function f(a: string) {', 'f'), sig('function f(a: string, b?: number) {', 'f'))!;
    assert.strictEqual(ext.change, 'compatible');
    assert.strictEqual(ext.after, '(a: string, b?: number)');
    assert.strictEqual(compareCallables(sig('function f(a: string) {', 'f'), sig('function f(a: string, b = 1) {', 'f'))!.change, 'compatible');
  });

  it('compares Go, Rust and Python callable signatures', () => {
    const { parseGenericCallable } = require('../src/tsSignature');
    // Python
    const py1 = parseGenericCallable('def process(items, timeout=10):', 'process', 'python')!;
    const py2 = parseGenericCallable('def process(items, timeout=10, retries=3):', 'process', 'python')!;
    const py3 = parseGenericCallable('def process(items, count):', 'process', 'python')!;
    assert.strictEqual(compareCallables(py1, py2)!.change, 'compatible');
    assert.strictEqual(compareCallables(py1, py3)!.change, 'breaking');

    // Go
    const go1 = parseGenericCallable('func Compute(a, b int) int {', 'Compute', 'go')!;
    const go2 = parseGenericCallable('func Compute(a, b int, extra ...int) int {', 'Compute', 'go')!;
    const go3 = parseGenericCallable('func Compute(a, b int) (int, error) {', 'Compute', 'go')!;
    assert.strictEqual(compareCallables(go1, go2)!.change, 'compatible');
    assert.strictEqual(compareCallables(go1, go3)!.change, 'breaking');

    // Rust
    const rs1 = parseGenericCallable('pub fn handle(&self, id: u32) -> bool {', 'handle', 'rust')!;
    const rs2 = parseGenericCallable('pub fn handle(&self, id: u32, force: bool) -> bool {', 'handle', 'rust')!;
    assert.strictEqual(compareCallables(rs1, rs2)!.change, 'breaking');
  });
});

describe('Feature: Declared names', () => {
  it('finds functions, arrow functions and class methods in TypeScript', () => {
    const text = [
      'export async function load(id: string) {',
      '  if (id) {',
      '  }',
      '}',
      'const save = async (x: number): Promise<void> => {};',
      'class A {',
      '  private static build(n: number): A {',
      '    for (const i of []) {',
      '    }',
      '  }',
      '}',
    ].join('\n');
    assert.deepStrictEqual(declaredNames(text, 'a.ts').sort(), ['build', 'load', 'save']);
  });

  it('finds Python, Go and Rust declarations', () => {
    assert.deepStrictEqual(declaredNames('def a():\n    pass\nasync def b(x):\n    pass', 'x.py'), ['a', 'b']);
    assert.deepStrictEqual(declaredNames('func Run() {}\nfunc (s *S) Stop() {}', 'x.go'), ['Run', 'Stop']);
    assert.deepStrictEqual(declaredNames('pub fn one() {}\nfn two() {}', 'x.rs'), ['one', 'two']);
  });
});

describe('Feature: Pull request references', () => {
  it('reads a number or a pull request link', () => {
    assert.strictEqual(parsePullRequestRef('123'), 123);
    assert.strictEqual(parsePullRequestRef(' #45 '), 45);
    assert.strictEqual(parsePullRequestRef('https://github.com/o/r/pull/678'), 678);
    assert.strictEqual(parsePullRequestRef('https://github.com/o/r/pull/678/files'), 678);
    assert.strictEqual(parsePullRequestRef('main'), undefined);
    assert.strictEqual(parsePullRequestRef('12; rm -rf'), undefined);
  });
});
