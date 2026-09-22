import * as assert from 'assert';
import { parseCallable, parseGenericCallable, splitHover } from '../src/tsSignature';

describe('Feature: Language Signature Extraction Engine', () => {
  describe('TypeScript & JavaScript Callable Extraction', () => {
    it('parses standard async method with parameters and return types', () => {
      const code = 'async function createUser(id: string, name?: string, role: string = "user"): Promise<User> {';
      const parsed = parseCallable(code, 'createUser');
      assert.ok(parsed);
      assert.strictEqual(parsed.returnType, 'Promise<User>');
      assert.strictEqual(parsed.params.length, 3);
      assert.strictEqual(parsed.params[0].name, 'id');
      assert.strictEqual(parsed.params[0].type, 'string');
      assert.strictEqual(parsed.params[0].optional, false);

      assert.strictEqual(parsed.params[1].name, 'name');
      assert.strictEqual(parsed.params[1].type, 'string');
      assert.strictEqual(parsed.params[1].optional, true);

      assert.strictEqual(parsed.params[2].name, 'role');
      assert.strictEqual(parsed.params[2].defaultValue, '"user"');
      assert.strictEqual(parsed.params[2].optional, true);
    });

    it('parses arrow functions with typed arguments and return types', () => {
      const code = 'const multiply = (a: number, b: number): number => a * b;';
      const parsed = parseCallable(code, 'multiply');
      assert.ok(parsed);
      assert.strictEqual(parsed.returnType, 'number');
      assert.strictEqual(parsed.params.length, 2);
      assert.strictEqual(parsed.params[0].name, 'a');
      assert.strictEqual(parsed.params[1].name, 'b');
    });

    it('extracts generic type parameters and constrained generics', () => {
      const code = 'function transform<T, R extends Base>(item: T, fn: (x: T) => R): R {';
      const parsed = parseCallable(code, 'transform');
      assert.ok(parsed);
      assert.strictEqual(parsed.typeParams, '<T, R extends Base>');
      assert.strictEqual(parsed.returnType, 'R');
      assert.strictEqual(parsed.params.length, 2);
    });

    it('extracts method decorators and rest parameters', () => {
      const code = 'save(@Body() data: CreateDTO, ...tags: string[]): boolean {';
      const parsed = parseCallable(code, 'save');
      assert.ok(parsed);
      assert.strictEqual(parsed.params[0].decorators[0], '@Body()');
      assert.strictEqual(parsed.params[0].name, 'data');
      assert.strictEqual(parsed.params[1].name, 'tags');
      assert.strictEqual(parsed.params[1].rest, true);
      assert.strictEqual(parsed.returnType, 'boolean');
    });
  });

  describe('Multi-Language Callable Extraction (Python, Go, Rust, Java, C#, C/C++, PHP, Kotlin)', () => {
    it('parses Python function definitions with type hints and default values', () => {
      const pyCode = 'def process_item(item_id: int, options: dict = None) -> list[str]:';
      const parsed = parseGenericCallable(pyCode, 'process_item', 'python');
      assert.ok(parsed);
      assert.strictEqual(parsed.params.length, 2);
      assert.strictEqual(parsed.params[0].name, 'item_id');
      assert.strictEqual(parsed.params[0].type, 'int');
      assert.strictEqual(parsed.params[1].name, 'options');
      assert.strictEqual(parsed.params[1].optional, true);
    });

    it('parses Go struct methods and function parameters', () => {
      const goCode = 'func (s *Server) HandleRequest(ctx context.Context, req *Request) (*Response, error) {';
      const parsed = parseGenericCallable(goCode, 'HandleRequest', 'go');
      assert.ok(parsed);
      assert.strictEqual(parsed.params.length, 2);
      assert.strictEqual(parsed.params[0].name, 'ctx');
      assert.strictEqual(parsed.params[0].type, 'context.Context');
      assert.strictEqual(parsed.params[1].name, 'req');
      assert.strictEqual(parsed.params[1].type, '*Request');
    });

    it('parses Rust function signatures with references and Result types', () => {
      const rustCode = 'pub fn calculate(&self, input: &str, count: usize) -> Result<u64, Error> {';
      const parsed = parseGenericCallable(rustCode, 'calculate', 'rust');
      assert.ok(parsed);
      assert.strictEqual(parsed.params[0].name, '&self');
      assert.strictEqual(parsed.params[1].name, 'input');
      assert.strictEqual(parsed.params[1].type, '&str');
      assert.strictEqual(parsed.params[2].name, 'count');
      assert.strictEqual(parsed.params[2].type, 'usize');
    });

    it('parses Java methods with annotations and generic return types', () => {
      const javaCode = 'public static List<String> searchUsers(@NotNull String query, int maxResults = 10) {';
      const parsed = parseGenericCallable(javaCode, 'searchUsers', 'java');
      assert.ok(parsed);
      assert.strictEqual(parsed.returnType, 'List<String>');
      assert.strictEqual(parsed.params.length, 2);
      assert.strictEqual(parsed.params[0].name, 'query');
      assert.strictEqual(parsed.params[0].type, 'String');
      assert.strictEqual(parsed.params[1].name, 'maxResults');
      assert.strictEqual(parsed.params[1].type, 'int');
      assert.strictEqual(parsed.params[1].optional, true);
    });

    it('parses C# async methods with default parameters', () => {
      const csCode = 'public async Task<User> GetUserAsync(string id, bool includeDetails = false) {';
      const parsed = parseGenericCallable(csCode, 'GetUserAsync', 'csharp');
      assert.ok(parsed);
      assert.strictEqual(parsed.returnType, 'Task<User>');
      assert.strictEqual(parsed.params.length, 2);
      assert.strictEqual(parsed.params[0].name, 'id');
      assert.strictEqual(parsed.params[0].type, 'string');
      assert.strictEqual(parsed.params[1].name, 'includeDetails');
      assert.strictEqual(parsed.params[1].defaultValue, 'false');
      assert.strictEqual(parsed.params[1].optional, true);
    });

    it('parses C++ functions with const references', () => {
      const cppCode = 'int process_buffer(const std::string& key, size_t size) {';
      const parsed = parseGenericCallable(cppCode, 'process_buffer', 'cpp');
      assert.ok(parsed);
      assert.strictEqual(parsed.returnType, 'int');
      assert.strictEqual(parsed.params.length, 2);
      assert.strictEqual(parsed.params[0].name, 'key');
      assert.strictEqual(parsed.params[0].type, 'const std::string&');
      assert.strictEqual(parsed.params[1].name, 'size');
      assert.strictEqual(parsed.params[1].type, 'size_t');
    });

    it('parses PHP functions with typed parameters and return type', () => {
      const phpCode = 'public function findUser(string $id, ?array $options = null): ?User {';
      const parsed = parseGenericCallable(phpCode, 'findUser', 'php');
      assert.ok(parsed);
      assert.strictEqual(parsed.returnType, '?User');
      assert.strictEqual(parsed.params.length, 2);
      assert.strictEqual(parsed.params[0].name, '$id');
      assert.strictEqual(parsed.params[0].type, 'string');
      assert.strictEqual(parsed.params[1].name, '$options');
      assert.strictEqual(parsed.params[1].type, '?array');
      assert.strictEqual(parsed.params[1].optional, true);
    });

    it('parses Kotlin functions with default parameters and return types', () => {
      const ktCode = 'suspend fun calculate(value: Double, scale: Int = 2): Double {';
      const parsed = parseGenericCallable(ktCode, 'calculate', 'kotlin');
      assert.ok(parsed);
      assert.strictEqual(parsed.returnType, 'Double');
      assert.strictEqual(parsed.params.length, 2);
      assert.strictEqual(parsed.params[0].name, 'value');
      assert.strictEqual(parsed.params[0].type, 'Double');
      assert.strictEqual(parsed.params[1].name, 'scale');
      assert.strictEqual(parsed.params[1].defaultValue, '2');
      assert.strictEqual(parsed.params[1].optional, true);
    });

    it('parses Dart methods with named and optional parameters', () => {
      const dartCode = 'Future<User> fetchUser(String id, {bool detailed = false}) async {';
      const parsed = parseGenericCallable(dartCode, 'fetchUser', 'dart');
      assert.ok(parsed);
      assert.strictEqual(parsed.returnType, 'Future<User>');
      assert.strictEqual(parsed.params.length, 2);
      assert.strictEqual(parsed.params[0].name, 'id');
      assert.strictEqual(parsed.params[0].type, 'String');
      assert.strictEqual(parsed.params[1].name, 'detailed');
      assert.strictEqual(parsed.params[1].type, 'bool');
      assert.strictEqual(parsed.params[1].optional, true);
    });

    it('parses Swift functions with argument labels and return type', () => {
      const swiftCode = 'func transfer(from source: Account, to target: Account, amount: Double = 0.0) -> Bool {';
      const parsed = parseGenericCallable(swiftCode, 'transfer', 'swift');
      assert.ok(parsed);
      assert.strictEqual(parsed.returnType, 'Bool');
      assert.strictEqual(parsed.params.length, 3);
      assert.strictEqual(parsed.params[0].name, 'source');
      assert.strictEqual(parsed.params[0].type, 'Account');
      assert.strictEqual(parsed.params[1].name, 'target');
      assert.strictEqual(parsed.params[1].type, 'Account');
      assert.strictEqual(parsed.params[2].name, 'amount');
      assert.strictEqual(parsed.params[2].optional, true);
    });

    it('parses Ruby methods with default arguments', () => {
      const rbCode = 'def calculate_tax(subtotal, rate = 0.05, *options)';
      const parsed = parseGenericCallable(rbCode, 'calculate_tax', 'ruby');
      assert.ok(parsed);
      assert.strictEqual(parsed.params.length, 3);
      assert.strictEqual(parsed.params[0].name, 'subtotal');
      assert.strictEqual(parsed.params[1].name, 'rate');
      assert.strictEqual(parsed.params[1].optional, true);
      assert.strictEqual(parsed.params[2].name, 'options');
      assert.strictEqual(parsed.params[2].rest, true);
    });

    it('parses Scala functions with typed parameters and return type', () => {
      const scalaCode = 'def transform[T](item: T, factor: Double = 1.0): String = {';
      const parsed = parseGenericCallable(scalaCode, 'transform', 'scala');
      assert.ok(parsed);
      assert.strictEqual(parsed.returnType, 'String');
      assert.strictEqual(parsed.params.length, 2);
      assert.strictEqual(parsed.params[0].name, 'item');
      assert.strictEqual(parsed.params[0].type, 'T');
      assert.strictEqual(parsed.params[1].name, 'factor');
      assert.strictEqual(parsed.params[1].optional, true);
    });

    it('parses Zig functions with parameters and return type', () => {
      const zigCode = 'pub fn add(a: i32, b: i32) i32 {';
      const parsed = parseGenericCallable(zigCode, 'add', 'zig');
      assert.ok(parsed);
      assert.strictEqual(parsed.returnType, 'i32');
      assert.strictEqual(parsed.params.length, 2);
      assert.strictEqual(parsed.params[0].name, 'a');
      assert.strictEqual(parsed.params[0].type, 'i32');
      assert.strictEqual(parsed.params[1].name, 'b');
      assert.strictEqual(parsed.params[1].type, 'i32');
    });

    it('parses Lua functions', () => {
      const luaCode = 'function calculate_score(player, multiplier)';
      const parsed = parseGenericCallable(luaCode, 'calculate_score', 'lua');
      assert.ok(parsed);
      assert.strictEqual(parsed.params.length, 2);
      assert.strictEqual(parsed.params[0].name, 'player');
      assert.strictEqual(parsed.params[1].name, 'multiplier');
    });
  });
});


describe('Feature: Multi-language declarations (parsed with their body present, as in real use)', () => {
  const show = (text: string, name: string, lang: string) => {
    const r = parseGenericCallable(text, name, lang);
    return { params: r?.params.map((p) => `${p.rest ? '*' : ''}${p.name}${p.type ? ': ' + p.type : ''}${p.defaultValue ? ' = ' + p.defaultValue : ''}`).join(', '), ret: r?.returnType };
  };
  const cases: Array<[string, string, string, string, string, string | undefined]> = [
    // label, text, name, language, expected params, expected return type
    ['python return type', 'create(self, dto: CreateUserDto, notify: bool = True) -> User:\n    return self.repo.save(dto)\n', 'create', 'python', 'self, dto: CreateUserDto, notify: bool = True', 'User'],
    ['python generics and **kwargs', 'load(self, key: str, *args: int, **kw: Any) -> Optional[Dict[str, int]]:\n    pass\n', 'load', 'python', 'self, key: str, *args: int, *kw: Any', 'Optional[Dict[str, int]]'],
    ['python keyword-only marker', 'run(self, a, *, retries: int = 3):\n    pass\n', 'run', 'python', 'self, a, retries: int = 3', undefined],
    ['python hover', '(method) def create(self: Self@UserService, dto: CreateUserDto) -> User', 'create', 'python', 'self: Self@UserService, dto: CreateUserDto', 'User'],
    ['go typed parameters', 'Handle(w http.ResponseWriter, r *http.Request) error {\n\treturn nil\n}\n', 'Handle', 'go', 'w: http.ResponseWriter, r: *http.Request', 'error'],
    ['go multiple returns', 'Find(id int) (*User, error) {\n\treturn nil, nil\n}\n', 'Find', 'go', 'id: int', '(*User, error)'],
    ['go grouped parameters share a type', 'Add(a, b int) int {\n\treturn a + b\n}\n', 'Add', 'go', 'a: int, b: int', 'int'],
    ['go variadic', 'Log(format string, args ...interface{}) {\n}\n', 'Log', 'go', 'format: string, *args: interface{}', undefined],
    ['go hover with a receiver', 'func (s *Server) Handle(w http.ResponseWriter, r *http.Request) error', 'Handle', 'go', 'w: http.ResponseWriter, r: *http.Request', 'error'],
    ['go unnamed parameters (interface methods)', 'Do(string, int) error', 'Do', 'go', 'arg1: string, arg2: int', 'error'],
    ['go struct{} return keeps its braces', 'Config() struct{} {\n}\n', 'Config', 'go', '', 'struct{}'],
    ['rust &self', 'area(&self, scale: f64) -> f64 {\n    1.0\n}\n', 'area', 'rust', '&self, scale: f64', 'f64'],
    ['rust :: paths in the return type', 'read(path: &str) -> Result<Vec<u8>, io::Error> {\n    todo!()\n}\n', 'read', 'rust', 'path: &str', 'Result<Vec<u8>, io::Error>'],
    ['rust where clause is not part of the type', 'parse<T: FromStr>(input: &str) -> Option<T> where T::Err: Debug {\n    None\n}\n', 'parse', 'rust', 'input: &str', 'Option<T>'],
    ['rust &mut self', 'push(&mut self, item: T) {\n}\n', 'push', 'rust', '&mut self, item: T', undefined],
    ['rust lifetimes', "longest<'a>(a: &'a str, b: &'a str) -> &'a str {\n    a\n}\n", 'longest', 'rust', 'a: &str, b: &str', '&str'],
    ['java method', 'public int sum(int a, int b) {\n    return a + b;\n}\n', 'sum', 'java', 'a: int, b: int', 'int'],
    ['csharp method', 'public Task<int> CountAsync(string filter = "all") {\n    return Task.FromResult(0);\n}\n', 'CountAsync', 'csharp', 'filter: string = "all"', 'Task<int>'],
    ['cpp function', 'double compute(double x, int n) {\n    return x;\n}\n', 'compute', 'cpp', 'x: double, n: int', 'double'],
    ['php function', 'function render(string $view, array $data = []): string {\n    return "";\n}\n', 'render', 'php', '$view: string, $data: array = []', 'string'],
    ['kotlin function', 'fun greet(name: String, formal: Boolean = false): String {\n    return "Hi";\n}\n', 'greet', 'kotlin', 'name: String, formal: Boolean = false', 'String'],
    ['dart method', 'Future<String> load(String path, {bool cached = true}) async {\n    return "";\n}\n', 'load', 'dart', 'path: String, cached: bool = true', 'Future<String>'],
    ['swift function', 'func greet(to person: String, shout: Bool = false) -> String {\n    return "Hello";\n}\n', 'greet', 'swift', 'person: String, shout: Bool = false', 'String'],
    ['ruby method', 'def add(a, b = 0)\n    a + b\nend\n', 'add', 'ruby', 'a, b = 0', undefined],
    ['scala function', 'def multiply(x: Int, y: Int = 1): Int = {\n    x * y\n}\n', 'multiply', 'scala', 'x: Int, y: Int = 1', 'Int'],
    ['zig function', 'pub fn max(a: i32, b: i32) i32 {\n    return if (a > b) a else b;\n}\n', 'max', 'zig', 'a: i32, b: i32', 'i32'],
    ['lua function', 'function render_view(name, context)\n    return true\nend\n', 'render_view', 'lua', 'name, context', undefined],
  ];
  for (const [label, text, name, lang, params, ret] of cases) {
    it(`parses ${label}`, () => {
      assert.deepStrictEqual(show(text, name, lang), { params, ret });
    });
  }

  it('never lets a function body leak into the return type', () => {
    const r = parseGenericCallable('Handle(w W) error {\n\tdoSomething()\n\treturn nil\n}\n', 'Handle', 'go');
    assert.strictEqual(r?.returnType, 'error');
  });

  it('picks the hover block that holds the method (rust-analyzer lists the module path first)', () => {
    const md = '```rust\nmy_crate::shapes\n```\n\n```rust\nfn area(&self, scale: f64) -> f64\n```\n\n---\n\nArea of the shape.';
    const h = splitHover(md, 'area');
    assert.strictEqual(h.signature, 'fn area(&self, scale: f64) -> f64');
    assert.strictEqual(h.description, 'Area of the shape.');
  });
});
