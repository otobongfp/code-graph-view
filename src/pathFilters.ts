// Which files count as tests or as third-party/build output. Kept free of the vscode API so it can be unit-tested.

/**
 * Test file names per language, matched against the file name only. Conventional suffixes like `Test`/`Spec` are
 * case-sensitive so ordinary names that merely contain the letters (`Latest.cs`, `Contest.java`) are not caught.
 */
const TEST_NAMES: RegExp[] = [
  /\.(spec|test)\.[cm]?[jt]sx?$/i,
  /_test\.go$/,
  /^test_.*\.py$/,
  /_test\.py$/,
  /^Test[A-Z0-9_].*\.java$/,
  /(Tests?|IT)\.java$/,
  /Tests?\.cs$/,
  /_(unit)?test\.(cpp|cc|cxx|c)$/,
  /Test\.php$/,
  /Tests?\.kts?$/,
  /_test\.dart$/,
  /_(test|spec)\.rb$/,
  /^test_.*\.rb$/,
  /Tests?\.swift$/,
  /(Spec|Suite|Test)\.scala$/,
  /_test\.zig$/,
  /_(spec|test)\.lua$/,
];

/** Folders that hold only tests: Jest's `__tests__` and the Maven/Gradle `src/test` tree. */
const TEST_DIRS = /(^|\/)(__tests__|src\/test)\//;

/** Whether `path` (workspace-relative or absolute, `/`-separated) is a test file. */
export function isTestFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return TEST_DIRS.test(path) || TEST_NAMES.some((re) => re.test(name));
}

/** Third-party and generated code: dependencies (node_modules, Go vendor, Python environments) and build output. */
export const DEPENDENCY_DIRS =
  /(^|\/)(node_modules|dist|out|\.next|vendor|target|\.venv|venv|site-packages|__pycache__|\.gradle|build|bin\/(?:Debug|Release|x86|x64|AnyCPU)|obj|\.dart_tool|\.build|\.swiftpm|\.metals|\.bloop)\//;

/** Whether `path` lies in a dependency or build folder. Pass a workspace-relative path so the folders above the workspace don't count. */
export function isDependencyPath(path: string): boolean {
  return DEPENDENCY_DIRS.test(path);
}

/**
 * Whether a class field or property declaration holds a function: an arrow function, a function expression,
 * a lambda, or a getter/setter. Plain data fields (`count = 0`, `{ get; set; }`) are not.
 */
export function looksCallable(declaration: string): boolean {
  const head = declaration.split("\n", 1)[0];
  return (
    /=\s*(async\s+)?(<[^>]*>\s*)?(\([^)]*\)|[\w$]+)\s*(:\s*[^=]+)?=>/.test(head) ||
    /=\s*(async\s+)?function\b/.test(head) ||
    /=\s*lambda\b/.test(head) ||
    /^\s*(?:(?:public|private|protected|static|override)\s+)*(get|set)\s+[\w$#]+\s*\(/.test(head)
  );
}
