/** Names of the functions and methods a source file declares. Text matching, so it errs towards missing a name over inventing one. */

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'else', 'do', 'with', 'super', 'constructor']);

const TS_FUNCTION = /(?:^|[\s;{}])(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/g;
const TS_ARROW = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async\s*)?(?:function\b|\([^)\n]*\)\s*(?::[^=\n]+)?=>|[A-Za-z_$][\w$]*\s*=>)/g;
const TS_METHOD = /^[ \t]*(?:(?:public|private|protected|static|async|readonly|override|abstract|get|set)\s+)*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>\n]*>)?\s*\([^\n]*(?:\{|;|,)?\s*$/gm;
const PY = /^[ \t]*(?:async\s+)?def\s+([A-Za-z_]\w*)/gm;
const GO = /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/gm;
const RUST = /\bfn\s+([A-Za-z_]\w*)/g;

function collect(text: string, re: RegExp, out: Set<string>, accept: (name: string, line: string) => boolean = () => true) {
  for (const m of text.matchAll(re)) {
    if (!KEYWORDS.has(m[1]) && accept(m[1], m[0])) out.add(m[1]);
  }
}

export function declaredNames(text: string, file: string): string[] {
  const out = new Set<string>();
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) {
    collect(text, TS_FUNCTION, out);
    collect(text, TS_ARROW, out);
    // A method looks like a call; only lines that open a body (or declare one) count.
    collect(text, TS_METHOD, out, (_name, line) => /\{\s*$/.test(line) || /\)\s*(?::[^;{]+)?;\s*$/.test(line));
  } else if (/\.py$/.test(file)) {
    collect(text, PY, out);
  } else if (/\.go$/.test(file)) {
    collect(text, GO, out);
  } else if (/\.rs$/.test(file)) {
    collect(text, RUST, out);
  }
  return [...out];
}
