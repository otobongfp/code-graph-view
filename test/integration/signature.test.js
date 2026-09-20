// The signature provider end to end: source parsing, hover for inferred types and doc comments, and project types.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const h = require('./helpers');

const SERVICE = `import { CreateUserDto } from './user.dto';

export class UserService {
  /**
   * Creates a user and sends the welcome mail.
   *
   * @param dto - the details of the new user
   * @param notify - whether to send the welcome mail
   * @returns the stored user
   */
  @Post('users')
  @UseGuards(AuthGuard)
  public async create(@Body() dto: CreateUserDto, notify = true) {
    return this.repo.save(dto);
  }
}
`;
const DTO = "export interface CreateUserDto {\n  name: string;\n  email: string;\n  role?: 'admin' | 'member';\n}\n";

module.exports = [
  [
    'reads inputs, output, decorators, doc comment and project types for a NestJS-style method',
    async () => {
      const ws = h.tempDir('sig');
      fs.writeFileSync(path.join(ws, 'user.service.ts'), SERVICE);
      fs.writeFileSync(path.join(ws, 'user.dto.ts'), DTO);
      globalThis.__ws = ws;
      const { getSignature } = h.freshRequire(h.bundleNode(path.join(h.root, 'src', 'signatureProvider.ts'), 'signature.js'));
      const vs = h.freshRequire(path.join(__dirname, 'fakes', 'signature.js'));
      const lines = SERVICE.split('\n');
      const line = lines.findIndex((l) => /async create\(/.test(l));
      const sig = await getSignature(vs.Uri.file(path.join(ws, 'user.service.ts')), new vs.Position(line, lines[line].indexOf('create') + 2));

      assert.strictEqual(sig.name, 'create');
      assert.strictEqual(sig.container, 'UserService');
      assert.deepStrictEqual(sig.decorators, ["@Post('users')", '@UseGuards(AuthGuard)']);
      assert.deepStrictEqual(sig.modifiers, ['public', 'async']);
      assert.strictEqual(sig.description, 'Creates a user and sends the welcome mail.');

      const [dto, notify] = sig.params;
      assert.strictEqual(dto.name, 'dto');
      assert.strictEqual(dto.type, 'CreateUserDto');
      assert.deepStrictEqual(dto.decorators, ['@Body()']);
      assert.strictEqual(dto.doc, 'the details of the new user');
      assert.strictEqual(dto.inferred, false, 'written in the source');
      assert.strictEqual(notify.type, 'boolean', 'the type comes from the language server');
      assert.strictEqual(notify.inferred, true);
      assert.strictEqual(notify.optional, true);
      assert.strictEqual(notify.defaultValue, 'true');

      assert.deepStrictEqual(sig.returns, { type: 'Promise<CreateUserDto>', inferred: true, doc: 'the stored user' });
      assert.strictEqual(sig.types.length, 1);
      assert.strictEqual(sig.types[0].name, 'CreateUserDto');
      assert.strictEqual(sig.types[0].kind, 'interface');
      assert.ok(sig.types[0].declaration.includes('email: string;'));
    },
  ],
];
