import * as assert from 'assert';
import { isDependencyPath, isTestFile, looksCallable } from '../src/pathFilters';

describe('Feature: Test and dependency file detection', () => {
  it('recognises test files in every supported language', () => {
    for (const p of [
      'src/a.test.ts', 'src/a.spec.tsx', 'web/x.test.mjs', 'pkg/server_test.go', 'tests/test_api.py', 'app/api_test.py',
      'src/test/java/com/x/Helper.java', 'TestRouter.java', 'RouterTest.java', 'RouterTests.java', 'RouterIT.java',
      'App.Tests/ParserTests.cs', 'ParserTest.cs', 'lib/parser_test.cpp', 'lib/parser_unittest.cc', 'UserTest.php',
      'UserTest.kt', 'user_test.dart', 'spec/user_spec.rb', 'test/test_user.rb', 'UserTests.swift', 'UserSpec.scala',
      'math_test.zig', 'util_spec.lua', 'src/__tests__/helpers.ts',
    ]) {
      assert.ok(isTestFile(p), `${p} is a test`);
    }
  });

  it('does not take ordinary files whose names merely contain "test" for tests', () => {
    for (const p of [
      'src/latest_prices.py', 'src/greatest_hits.py', 'src/LatestPrice.java', 'src/Contest.cs', 'src/Latest.swift',
      'src/attestation/Attest.kt', 'app/contest_rules.rb', 'src/testing/Router.java', 'src/protest.ts', 'Attestation.php',
      'src/testUtils.ts', 'docs/test-plan/notes.py',
    ]) {
      assert.ok(!isTestFile(p), `${p} is not a test`);
    }
  });

  it('treats dependency and build folders the same for relative and absolute paths', () => {
    for (const p of ['node_modules/x/index.js', '/w/node_modules/x/index.js', 'dist/a.js', 'out/extension.js', '.next/s.js', 'vendor/a.go', 'target/debug/a.rs', 'bin/Debug/a.cs']) {
      assert.ok(isDependencyPath(p), `${p} is a dependency`);
    }
    for (const p of ['src/index.ts', 'src/outbox/a.ts', 'src/distance.ts', 'builder/a.ts']) {
      assert.ok(!isDependencyPath(p), `${p} is source`);
    }
  });

  it('tells function-valued fields from data fields', () => {
    for (const d of [
      'handleClick = () => {', 'onSave = async (e: Event): Promise<void> => {', 'map = <T>(x: T) => x;', 'next = x => x + 1;',
      'run = function () {', 'square = lambda x: x * x', 'get total() {', 'static set name(v) {', 'private get id() {',
    ]) {
      assert.ok(looksCallable(d), `${d} holds a function`);
    }
    for (const d of ['count = 0;', 'public string Name { get; set; }', 'items: string[] = [];', 'ready = a >= b;', 'label?: string;']) {
      assert.ok(!looksCallable(d), `${d} is data`);
    }
  });
});
