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

    // Java
    const j1 = parseGenericCallable('public int sum(int a, int b) {', 'sum', 'java')!;
    const j2 = parseGenericCallable('public int sum(int a, int b, int c = 0) {', 'sum', 'java')!;
    assert.strictEqual(compareCallables(j1, j2)!.change, 'compatible');

    // Dart
    const d1 = parseGenericCallable('Future<User> fetch(String id) async {', 'fetch', 'dart')!;
    const d2 = parseGenericCallable('Future<User> fetch(String id, {bool cache = true}) async {', 'fetch', 'dart')!;
    assert.strictEqual(compareCallables(d1, d2)!.change, 'compatible');

    // Swift
    const sw1 = parseGenericCallable('func run(timeout: Int) -> Bool {', 'run', 'swift')!;
    const sw2 = parseGenericCallable('func run(timeout: Int, retries: Int = 3) -> Bool {', 'run', 'swift')!;
    assert.strictEqual(compareCallables(sw1, sw2)!.change, 'compatible');
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

  it('finds declarations across all 15 supported languages', () => {
    assert.deepStrictEqual(declaredNames('def a():\n    pass\nasync def b(x):\n    pass', 'x.py').sort(), ['a', 'b']);
    assert.deepStrictEqual(declaredNames('func Run() {}\nfunc (s *S) Stop() {}', 'x.go').sort(), ['Run', 'Stop']);
    assert.deepStrictEqual(declaredNames('pub fn one() {}\nfn two() {}', 'x.rs').sort(), ['one', 'two']);
    assert.deepStrictEqual(declaredNames('public int calc(int a) {\n}\nvoid run() {\n}', 'App.java').sort(), ['calc', 'run']);
    assert.deepStrictEqual(declaredNames('public async Task<User> FindAsync(string id) {\n}\nint Count() => 0;', 'Service.cs').sort(), ['Count', 'FindAsync']);
    assert.deepStrictEqual(declaredNames('int process_data(int len) {\n}\nvoid init();', 'module.cpp').sort(), ['init', 'process_data']);
    assert.deepStrictEqual(declaredNames('function handleRequest($req) {\n}\npublic function close() {}', 'handler.php').sort(), ['close', 'handleRequest']);
    assert.deepStrictEqual(declaredNames('fun start() {\n}\nsuspend fun loadData(id: String) = id', 'Main.kt').sort(), ['loadData', 'start']);
    assert.deepStrictEqual(declaredNames('Future<void> init() async {}\nvoid render() {}', 'main.dart').sort(), ['init', 'render']);
    assert.deepStrictEqual(declaredNames('def save\nend\ndef self.find(id)\nend', 'model.rb').sort(), ['find', 'save']);
    assert.deepStrictEqual(declaredNames('func perform() {}\nstatic func create() -> App {}', 'view.swift').sort(), ['create', 'perform']);
    assert.deepStrictEqual(declaredNames('def calculate(x: Int): Int = x\ndef reset(): Unit = ()', 'app.scala').sort(), ['calculate', 'reset']);
    assert.deepStrictEqual(declaredNames('pub fn alloc() void {}\nfn free() void {}', 'mem.zig').sort(), ['alloc', 'free']);
    assert.deepStrictEqual(declaredNames('function init()\nend\nlocal function setup()\nend', 'script.lua').sort(), ['init', 'setup']);
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
