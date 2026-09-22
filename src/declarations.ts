/** Names of the functions and methods a source file declares. Text matching, so it errs towards missing a name over inventing one. */

const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'else', 'do', 'with', 'super', 'constructor',
  'class', 'struct', 'interface', 'enum', 'namespace', 'package', 'typedef', 'using', 'sizeof', 'typeof',
  'new', 'delete', 'throw', 'throws', 'fun', 'def', 'fn', 'void', 'int', 'bool', 'boolean', 'char', 'float',
  'double', 'string', 'var', 'val', 'let', 'pub', 'local', 'end', 'then',
]);

const TS_FUNCTION = /(?:^|[\s;{}])(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/g;
const TS_ARROW = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async\s*)?(?:function\b|\([^)\n]*\)\s*(?::[^=\n]+)?=>|[A-Za-z_$][\w$]*\s*=>)/g;
const TS_METHOD = /^[ \t]*(?:(?:public|private|protected|static|async|readonly|override|abstract|get|set)\s+)*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>\n]*>)?\s*\([^\n]*(?:\{|;|,)?\s*$/gm;
const PY = /^[ \t]*(?:async\s+)?def\s+([A-Za-z_]\w*)/gm;
const GO = /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/gm;
const RUST = /\bfn\s+([A-Za-z_]\w*)/g;
const JAVA_METHOD = /^[ \t]*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|protected|private|static|final|abstract|synchronized|native|default|strictfp)\s+)*(?:<[^>\n]+>\s+)?(?:[\w$<>\[\],?]+\s+)+([A-Za-z_$][\w$]*)\s*\([^\n]*\)\s*(?:throws\s+[^{;]+)?\s*[{;]/gm;
const CS_METHOD = /^[ \t]*(?:\[[^\]\n]+\]\s+)*(?:(?:public|protected|private|internal|static|async|override|virtual|sealed|abstract|partial|extern|unsafe|readonly)\s+)*(?:[\w$<>\[\],?]+\s+)+([A-Za-z_$][\w$]*)\s*(?:<[^>\n]+>)?\s*\([^\n]*\)\s*(?:where\s+[^{;=>]+)?\s*[{;=>]/gm;
const CPP_FUNC = /^[ \t]*(?:(?:inline|static|virtual|explicit|constexpr|consteval|constinit|friend)\s+)*(?:(?:const\s+)?[\w:*&<>]+\s+)+([A-Za-z_]\w*)\s*(?:<[^>\n]+>)?\s*\([^\n]*\)(?:\s*const)?(?:\s*noexcept(?:\([^)]*\))?)?(?:\s*->\s*[^{;]+)?\s*[{;]/gm;
const PHP_FUNC = /(?:^|[\s;{}])(?:(?:public|protected|private|static|final|abstract)\s+)*function\s+&?\s*([A-Za-z_]\w*)/gm;
const KOTLIN_FUNC = /^[ \t]*(?:(?:public|private|protected|internal|open|override|abstract|final|suspend|inline|tailrec|operator|infix)\s+)*fun\s+(?:<[^>\n]+>\s+)?(?:[A-Za-z_]\w*(?:<[^>\n]+>)?\.)?([A-Za-z_]\w*)\s*(?:<[^>\n]+>)?\s*\(/gm;
const DART_FUNC = /^[ \t]*(?:(?:static|final|const|late|abstract)\s+)*(?:[\w$?<>\[\],]+\s+)+([A-Za-z_$][\w$]*)\s*(?:<[^>\n]+>)?\s*\([^\n]*\)\s*(?:async\*?|sync\*?)?\s*[{;=>]/gm;
const RUBY_FUNC = /^[ \t]*def\s+(?:self\.)?([A-Za-z_]\w*[!?=]?)/gm;
const SWIFT_FUNC = /^[ \t]*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|fileprivate|internal|open|static|class|final|mutating|nonmutating|override|actor|async|throws)\s+)*func\s+([A-Za-z_]\w*)\s*(?:<[^>\n]+>)?\s*\(/gm;
const SCALA_FUNC = /^[ \t]*(?:(?:override|private|protected|final|implicit|lazy|inline)\s+)*def\s+([A-Za-z_$][\w$]*)\s*(?:\[[^\]\n]+\])?\s*\(/gm;
const ZIG_FUNC = /^[ \t]*(?:(?:pub|export|extern)\s+)?fn\s+([A-Za-z_]\w*)\s*\(/gm;
const LUA_FUNC = /(?:^|[\s;])(?:local\s+)?function\s+(?:[A-Za-z_]\w*[:.])?([A-Za-z_]\w*)\s*\(/gm;

function collect(text: string, re: RegExp, out: Set<string>, accept: (name: string, line: string) => boolean = () => true) {
  for (const m of text.matchAll(re)) {
    if (!KEYWORDS.has(m[1]) && accept(m[1], m[0])) out.add(m[1]);
  }
}

export function declaredNames(text: string, file: string): string[] {
  const out = new Set<string>();
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file)) {
    collect(text, TS_FUNCTION, out);
    collect(text, TS_ARROW, out);
    // A method looks like a call; only lines that open a body (or declare one) count.
    collect(text, TS_METHOD, out, (_name, line) => /\{\s*$/.test(line) || /\)\s*(?::[^;{]+)?;\s*$/.test(line));
  } else if (/\.py$/i.test(file)) {
    collect(text, PY, out);
  } else if (/\.go$/i.test(file)) {
    collect(text, GO, out);
  } else if (/\.rs$/i.test(file)) {
    collect(text, RUST, out);
  } else if (/\.java$/i.test(file)) {
    collect(text, JAVA_METHOD, out);
  } else if (/\.cs$/i.test(file)) {
    collect(text, CS_METHOD, out);
  } else if (/\.(c|cpp|cc|cxx|h|hpp)$/i.test(file)) {
    collect(text, CPP_FUNC, out);
  } else if (/\.php$/i.test(file)) {
    collect(text, PHP_FUNC, out);
  } else if (/\.(kt|kts)$/i.test(file)) {
    collect(text, KOTLIN_FUNC, out);
  } else if (/\.dart$/i.test(file)) {
    collect(text, DART_FUNC, out);
  } else if (/\.rb$/i.test(file)) {
    collect(text, RUBY_FUNC, out);
  } else if (/\.swift$/i.test(file)) {
    collect(text, SWIFT_FUNC, out);
  } else if (/\.(scala|sc)$/i.test(file)) {
    collect(text, SCALA_FUNC, out);
  } else if (/\.zig$/i.test(file)) {
    collect(text, ZIG_FUNC, out);
  } else if (/\.lua$/i.test(file)) {
    collect(text, LUA_FUNC, out);
  }
  return [...out];
}
