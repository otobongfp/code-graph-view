import * as assert from 'assert';
import {
  applyTokenBudget,
  buildTopologyTree,
  codeFence,
  collectDeduplicatedTypes,
  estimateTokens,
  formatContextMarkdown,
  redactSecrets,
} from '../src/contextCompressor';
import { BucketItemData } from '../src/types';

function makeItem(
  id: string,
  name: string,
  parentId?: string,
  level: 'name' | 'signature' | 'full' = 'signature'
): BucketItemData {
  return {
    id,
    name,
    file: '/workspace/src/example.ts',
    line: 10,
    character: 0,
    resolvedLine: 10,
    kind: 'method',
    parentId,
    level,
    rawFileSize: 1200,
    signature: {
      name,
      kind: 'method',
      file: '/workspace/src/example.ts',
      line: 10,
      character: 0,
      decorators: [],
      modifiers: ['public', 'async'],
      params: [{ name: 'id', type: 'string', optional: false, rest: false }],
      returns: { type: 'Promise<User>', inferred: false },
      types: [
        {
          name: 'User',
          kind: 'interface',
          file: '/workspace/src/types.ts',
          line: 5,
          declaration: 'interface User {\n  id: string;\n  name: string;\n}',
          truncated: false,
        },
      ],
    },
    body: `async function ${name}(id: string): Promise<User> {\n  return { id, name: "test" };\n}`,
  };
}

describe('Feature: AI Context Compressor & Structurer', () => {
  it('formats dynamic code fences safely when code contains backticks', () => {
    const normalCode = 'const x = 1;';
    assert.strictEqual(codeFence(normalCode, 'ts'), '```ts\nconst x = 1;\n```');

    const codeWithTicks = 'const md = "```markdown\\nhello\\n```";';
    const fenced = codeFence(codeWithTicks, 'ts');
    assert.ok(fenced.startsWith('````ts'));
    assert.ok(fenced.endsWith('````'));
  });

  it('builds an indented topology tree with parent-child links', () => {
    const items: BucketItemData[] = [
      makeItem('root', 'UserController.create'),
      makeItem('child1', 'UserService.create', 'root'),
      makeItem('child2', 'MailService.sendWelcome', 'child1'),
    ];

    const tree = buildTopologyTree(items);
    assert.ok(tree.includes('UserController.create (example.ts:11)'));
    assert.ok(tree.includes('└─ UserService.create (example.ts:11)'));
    assert.ok(tree.includes('MailService.sendWelcome (example.ts:11)'));
  });

  it('handles diamond dependencies with (see above) annotations without duplicating branches', () => {
    const items: BucketItemData[] = [
      makeItem('a', 'MethodA'),
      makeItem('b', 'MethodB', 'a'),
      makeItem('c', 'MethodC', 'a'),
      makeItem('shared', 'SharedHelper', 'b'),
      makeItem('shared_dup', 'SharedHelper', 'c'),
    ];
    items[4].id = 'shared';

    const tree = buildTopologyTree(items);
    assert.ok(tree.includes('(see above)'));
  });

  it('deduplicates referenced types across multiple methods', () => {
    const items: BucketItemData[] = [
      makeItem('1', 'MethodOne'),
      makeItem('2', 'MethodTwo'),
    ];

    const types = collectDeduplicatedTypes(items);
    assert.strictEqual(types.length, 1);
    assert.strictEqual(types[0].name, 'User');
  });

  it('formats full markdown context cleanly with topology, specs and types', () => {
    const items: BucketItemData[] = [
      makeItem('1', 'UserController.create', undefined, 'signature'),
      makeItem('2', 'UserService.create', '1', 'full'),
    ];

    const md = formatContextMarkdown(items);
    assert.ok(md.includes('# Curated Execution Context'));
    assert.ok(md.includes('## 1. Topology & Call Flow'));
    assert.ok(md.includes('## 2. Method Specifications'));
    assert.ok(md.includes('## 3. Referenced Types & Schemas'));
    assert.ok(md.includes('interface User'));
    assert.ok(!md.includes('📦'));
    assert.ok(!md.includes('✨'));
  });

  it('applies token budget by stepping down outer levels from full to signature to name', () => {
    const items: BucketItemData[] = [
      makeItem('1', 'RootMethod', undefined, 'full'),
      makeItem('2', 'LeafMethod', '1', 'full'),
    ];

    items[1].level = 'signature';
    const targetBudget = estimateTokens(formatContextMarkdown(items));
    items[1].level = 'full';

    const pruned = applyTokenBudget(items, targetBudget);

    assert.strictEqual(pruned[0].level, 'full');
    assert.strictEqual(pruned[1].level, 'signature');
  });
});


describe('Feature: Context export of items saved by older versions', () => {
  it('never prints "undefined" for an item saved without a kind', () => {
    const legacy = makeItem('a', 'legacyMethod', undefined, 'name') as Partial<BucketItemData>;
    delete legacy.kind;
    const md = formatContextMarkdown([legacy as BucketItemData]);
    assert.ok(md.includes('legacyMethod'), 'the method appears in the export');
    assert.ok(!md.includes('undefined'), 'no "undefined" leaks into the exported context');
    assert.ok(md.includes('(method)'), 'falls back to "method"');
  });
});


describe('Feature: Secret masking in exported context', () => {
  const key = 'sk-' + 'a1B2c3D4e5F6g7H8i9J0k1L2';
  const aws = 'AKIA' + 'IOSFODNN7EXAMPLE';

  it('masks well-known credential formats', () => {
    const src = [
      `const openai = "${key}";`,
      `aws_key: ${aws}`,
      'const gh = "ghp_' + 'A'.repeat(36) + '";',
      'const jwt = "eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4fw";',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const { text, count } = redactSecrets(src);
    assert.strictEqual(count, 5);
    for (const leaked of [key, aws, 'ghp_AAAA', 'eyJhbGci', 'MIIEvQIBADANBg']) {
      assert.ok(!text.includes(leaked), `${leaked} must not survive`);
    }
  });

  it('masks passwords in URLs and quoted values on secret-named fields, keeping the field name', () => {
    const { text, count } = redactSecrets('db = "postgres://admin:hunter2pass@db.local/app"\nconst password = "correct-horse-battery";\nconfig.apiKey = \'abcd1234efgh5678\';');
    assert.strictEqual(count, 3);
    assert.ok(text.includes('postgres://admin:[REDACTED]@db.local/app'), 'URL user kept, password masked');
    assert.ok(text.includes('const password = "[REDACTED]";'), 'field name kept');
    assert.ok(text.includes("config.apiKey = '[REDACTED]';"));
  });

  it('leaves ordinary code alone', () => {
    const ordinary = [
      'const tokenizer = new Tokenizer("some words here");',
      'function getToken(): string { return this.token; }',
      'interface Login { password: string; secret?: string }',
      'const empty = { password: "" };',
      'const fromEnv = { apiKey: "${process.env.API_KEY}" };',
      'const help = { token: "The token used for auth" };',
      'const shortOne = { password: "abc" };',
    ].join('\n');
    const { text, count } = redactSecrets(ordinary);
    assert.strictEqual(count, 0);
    assert.strictEqual(text, ordinary);
  });

  it('is applied to the exported markdown, says so, and can be switched off', () => {
    const item = makeItem('a', 'connect', undefined, 'full');
    item.body = `async connect() {\n  const apiKey = "${key}";\n}`;
    const on = formatContextMarkdown([item]);
    assert.ok(!on.includes(key), 'secret is masked in the export');
    assert.ok(on.includes('replaced with [REDACTED]'), 'the export says something was masked');
    const off = formatContextMarkdown([item], { redactSecrets: false });
    assert.ok(off.includes(key), 'switching masking off leaves the text as written');
  });
});
