/** Reads the inputs and output of a TypeScript/JavaScript callable from source or hover text. No VS Code APIs. */

export interface ParsedParam {
  name: string;
  type?: string;
  optional: boolean;
  rest: boolean;
  defaultValue?: string;
  /** Decorators on the parameter, such as `@Body()` or `@Param('id')`. */
  decorators: string[];
}

export interface ParsedCallable {
  typeParams?: string;
  params: ParsedParam[];
  returnType?: string;
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
const isIdent = (c: string | undefined) => !!c && /[\w$]/.test(c);

function skipString(text: string, i: number): number {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length) {
    if (text[j] === '\\') j += 2;
    else if (text[j] === quote) return j + 1;
    else j++;
  }
  return text.length;
}

/** Index of the bracket closing the one at `open`, or -1. Brackets and strings nest; `<` `>` are not counted. */
function matchClose(text: string, open: number): number {
  const stack: string[] = [];
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(text, i) - 1;
    } else if (pairs[c]) {
      stack.push(pairs[c]);
    } else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Index of the `>` closing the `<` at `open` (generic lists), or -1. */
function matchAngle(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') i = skipString(text, i) - 1;
    else if (c === '(' || c === '[' || c === '{') i = matchClose(text, i) < 0 ? text.length : matchClose(text, i);
    else if (c === '<') depth++;
    else if (c === '>' && text[i - 1] !== '=') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Splits on `sep` where it is not inside brackets, generics or strings. */
function splitTop(text: string, sep = ','): string[] {
  const out: string[] = [];
  let start = 0;
  let angle = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(text, i) - 1;
    } else if (c === '(' || c === '[' || c === '{') {
      const close = matchClose(text, i);
      i = close < 0 ? text.length : close;
    } else if (c === '<' && (isIdent(text[i - 1]) || text[i - 1] === '>')) {
      angle++;
    } else if (c === '>' && text[i - 1] !== '=' && angle > 0) {
      angle--;
    } else if (c === sep && angle === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

interface TypeStop {
  /** Stop at a top-level `=>` (arrow function declarations end their return type there). */
  arrow?: boolean;
  /** Stop at a top-level `=` (a default value or initializer). */
  equals?: boolean;
}

/** Reads one type expression starting at `i`; stops where a function body, `;`, `=>` or `=` begins. */
function readType(text: string, i: number, stop: TypeStop = {}): string {
  let angle = 0;
  let last = ':';
  let j = i;
  for (; j < text.length; j++) {
    const c = text[j];
    if (c === '"' || c === "'" || c === '`') {
      j = skipString(text, j) - 1;
      last = 'a';
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      // A `{` right after a complete type is the body; after `:` `|` `&` `,` `<` `=` it starts an object type.
      if (c === '{' && angle === 0 && !/[:|&,(<=?]/.test(last)) break;
      const close = matchClose(text, j);
      j = close < 0 ? text.length : close;
      last = text[j] ?? ')';
      continue;
    }
    if (c === '<' && (isIdent(text[j - 1]) || text[j - 1] === '>')) angle++;
    else if (c === '>' && text[j - 1] !== '=' && angle > 0) angle--;
    else if (angle === 0) {
      if (c === ';') break;
      if (c === '=' && text[j + 1] === '>') {
        if (stop.arrow) break;
        j++;
        last = ':';
        continue;
      }
      if (c === '=' && stop.equals) break;
    }
    if (!/\s/.test(c)) last = c;
  }
  return collapse(text.slice(i, j));
}

function parseDecorators(text: string): { decorators: string[]; rest: string } {
  const decorators: string[] = [];
  let i = 0;
  while (true) {
    while (/\s/.test(text[i] ?? '')) i++;
    if (text[i] !== '@') break;
    let j = i + 1;
    while (isIdent(text[j]) || text[j] === '.') j++;
    if (text[j] === '(') {
      const close = matchClose(text, j);
      j = close < 0 ? text.length : close + 1;
    }
    decorators.push(collapse(text.slice(i, j)));
    i = j;
  }
  return { decorators, rest: text.slice(i) };
}

function parseParam(raw: string): ParsedParam | undefined {
  const { decorators, rest } = parseDecorators(raw);
  let text = rest.trim();
  if (!text) return undefined;
  text = text.replace(/^(?:(?:public|private|protected|readonly|override)\s+)+/, '');
  const restParam = text.startsWith('...');
  if (restParam) text = text.slice(3).trimStart();

  let name: string;
  let i = 0;
  if (text[0] === '{' || text[0] === '[') {
    const close = matchClose(text, 0);
    i = close < 0 ? text.length : close + 1;
    name = collapse(text.slice(0, i));
    if (name.length > 48) name = name.slice(0, 45) + '…}';
  } else {
    while (isIdent(text[i])) i++;
    name = text.slice(0, i);
  }
  if (!name) return undefined;
  let optional = false;
  while (/\s/.test(text[i] ?? '')) i++;
  if (text[i] === '?') {
    optional = true;
    i++;
  }
  while (/\s/.test(text[i] ?? '')) i++;
  let type: string | undefined;
  if (text[i] === ':') {
    type = readType(text, i + 1, { equals: true }) || undefined;
  }
  let defaultValue: string | undefined;
  const eq = findTopLevelEquals(text, i);
  if (eq >= 0) defaultValue = collapse(text.slice(eq + 1)) || undefined;
  return { name, type, optional: optional || defaultValue !== undefined, rest: restParam, defaultValue, decorators };
}

function findTopLevelEquals(text: string, from: number): number {
  let angle = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') i = skipString(text, i) - 1;
    else if (c === '(' || c === '[' || c === '{') {
      const close = matchClose(text, i);
      i = close < 0 ? text.length : close;
    } else if (c === '<' && (isIdent(text[i - 1]) || text[i - 1] === '>')) angle++;
    else if (c === '>' && text[i - 1] !== '=' && angle > 0) angle--;
    else if (c === '=' && angle === 0 && text[i + 1] !== '>' && text[i - 1] !== '=' && text[i + 1] !== '=') return i;
  }
  return -1;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Parses the callable named `name` in `text`: a method, function, `const f = (…) =>`, or a hover-style
 * `(method) Class.name(a: A): B` / `const name: (a: A) => B`.
 */
export function parseCallable(text: string, name: string): ParsedCallable | undefined {
  const at = new RegExp(`(?<![\\w$])${escapeRe(name)}(?![\\w$])`).exec(text);
  if (!at) return undefined;
  let i = at.index + name.length;
  const skipWs = () => {
    while (/\s/.test(text[i] ?? '')) i++;
  };
  skipWs();
  if (text[i] === '?') i++;
  skipWs();

  let form: 'method' | 'functionType' | 'arrow' = 'method';
  if (text[i] === ':') {
    form = 'functionType';
    i++;
    skipWs();
  } else if (text[i] === '=' && text[i + 1] !== '=' && text[i + 1] !== '>') {
    form = 'arrow';
    i++;
    skipWs();
    if (text.startsWith('async', i) && !isIdent(text[i + 5])) {
      i += 5;
      skipWs();
    }
    if (text.startsWith('function', i) && !isIdent(text[i + 8])) {
      i += 8;
      skipWs();
      if (text[i] === '*') i++;
      skipWs();
      while (isIdent(text[i])) i++;
      skipWs();
      form = 'method';
    }
  }

  let typeParams: string | undefined;
  if (text[i] === '<') {
    const close = matchAngle(text, i);
    if (close < 0) return undefined;
    typeParams = text.slice(i, close + 1);
    i = close + 1;
    skipWs();
  }

  let params: ParsedParam[];
  if (text[i] === '(') {
    const close = matchClose(text, i);
    if (close < 0) return undefined;
    params = splitTop(text.slice(i + 1, close))
      .map(parseParam)
      .filter((p): p is ParsedParam => !!p);
    i = close + 1;
  } else if (form === 'arrow' && /[A-Za-z_$]/.test(text[i] ?? '')) {
    // `const f = x => …`
    let j = i;
    while (isIdent(text[j])) j++;
    let k = j;
    while (/\s/.test(text[k] ?? '')) k++;
    if (!text.startsWith('=>', k)) return undefined;
    params = [{ name: text.slice(i, j), optional: false, rest: false, decorators: [] }];
    i = j;
  } else {
    return undefined;
  }
  skipWs();

  let returnType: string | undefined;
  if (form === 'functionType') {
    if (text.startsWith('=>', i)) returnType = readType(text, i + 2, {}) || undefined;
  } else if (text[i] === ':') {
    returnType = readType(text, i + 1, { arrow: form === 'arrow' }) || undefined;
  }
  return { typeParams, params, returnType };
}

/**
 * Language-agnostic parser for callables in Go, Rust, Python and similar languages: parameters between `(…)`
 * and a return type after `->`, `:` or, as in Go, written straight after the parameter list. Pass `name` so a
 * Go receiver `(s *Server)` is not mistaken for the parameters, and `languageId` for language quirks.
 */
export function parseGenericCallable(text: string, name?: string, languageId?: string): ParsedCallable | undefined {
  if (!text) return undefined;
  let start = 0;
  if (name) {
    const at = new RegExp(`(?<![\\w$])${escapeRe(name)}\\s*(?:<[^()]*>)?\\s*\\(`).exec(text);
    if (at) start = at.index;
  }
  // Rust lifetimes (`&'a str`) look like the start of a string to the bracket scanner, so drop them.
  const body = languageId === 'rust' ? text.slice(start).replace(/'[A-Za-z_]\w*\s?/g, '') : text.slice(start);
  const parenOpen = body.indexOf('(');
  if (parenOpen < 0) return undefined;
  const parenClose = matchClose(body, parenOpen);
  if (parenClose < 0) return undefined;

  const params: ParsedParam[] = [];
  for (const raw of splitTop(body.slice(parenOpen + 1, parenClose))) {
    const p = raw.trim();
    if (!p) continue;
    let rest = p.startsWith('...') || p.startsWith('*');
    const clean = rest ? p.replace(/^\.{3}|^\*{1,2}/, '').trim() : p;

    let mainPart = clean;
    let defaultValue: string | undefined;
    const eqIdx = mainPart.indexOf('=');
    if (eqIdx >= 0) {
      defaultValue = mainPart.slice(eqIdx + 1).trim();
      mainPart = mainPart.slice(0, eqIdx).trim();
    }
    const add = (name: string, type: string | undefined) =>
      params.push({ name: name || 'param', type: type || undefined, optional: defaultValue !== undefined, rest, defaultValue, decorators: [] });

    // Rust receivers: `self`, `&self`, `&mut self`.
    if (/^&?\s*(?:mut\s+)?self\b/.test(mainPart)) {
      add(mainPart, undefined);
      continue;
    }
    const colonIdx = mainPart.indexOf(':');
    if (colonIdx >= 0) {
      add(mainPart.slice(0, colonIdx).trim().replace(/^(mut\s+|&mut\s+|&)/, ''), mainPart.slice(colonIdx + 1).trim());
      continue;
    }
    const words = mainPart.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      let type = words.slice(1).join(' ');
      if (type.startsWith('...')) {
        // Go variadic: `args ...T`
        rest = true;
        type = type.slice(3);
      }
      add(words[0], type);
    } else if (words.length === 1) {
      add(words[0], undefined);
    }
  }

  if (languageId === 'go' && params.length > 0) {
    if (params.every((q) => !q.type)) {
      // Unnamed parameters, as in interface methods: the words are the types.
      params.forEach((q, i) => {
        q.type = q.name;
        q.name = `arg${i + 1}`;
      });
    } else {
      // `a, b int`: parameters share the type that follows them.
      let carry: string | undefined;
      for (let i = params.length - 1; i >= 0; i--) {
        if (params[i].type) carry = params[i].type;
        else if (carry) params[i].type = carry;
      }
    }
  }

  // The return type is read from the declaration line only, so a function body can never leak into it.
  const line = body
    .slice(parenClose + 1)
    .split('\n')[0]
    .replace(/\s*\/\/.*$/, '')
    .trim();
  const tidy = (t: string) =>
    t
      .replace(/\s+where\b.*$/, '')
      .replace(/\s\{.*$/, '')
      .replace(/[{;]\s*$/, '')
      .replace(/:\s*$/, '')
      .trim() || undefined;
  let returnType: string | undefined;
  if (line.startsWith('->')) returnType = tidy(line.slice(2));
  else if (line.startsWith(':')) returnType = tidy(line.slice(1));
  else if (line && !line.startsWith('{') && !line.startsWith(';')) returnType = tidy(line);
  return { params, returnType };
}

/** Decorators and modifiers written before the name of a declaration, e.g. `@Get(':id') async`. */
export function parseHeaderPrefix(prefix: string): { decorators: string[]; modifiers: string[] } {
  const { decorators, rest } = parseDecorators(prefix);
  const shown = new Set(['public', 'private', 'protected', 'static', 'async', 'abstract', 'readonly', 'override', 'get', 'set', 'export']);
  const modifiers = rest
    .split(/\s+/)
    .map((w) => w.replace(/[*]/g, ''))
    .filter((w) => shown.has(w));
  return { decorators, modifiers: [...new Set(modifiers)] };
}

/** Splits TypeScript hover markdown into the signature and its doc comment (description and @param/@returns). */
export function splitHover(markdown: string, name?: string): {
  signature?: string;
  description?: string;
  paramDocs: Record<string, string>;
  returnsDoc?: string;
} {
  const fences = [...markdown.matchAll(/```[\w-]*\n([\s\S]*?)```/g)];
  const holdsMethod = name ? new RegExp(`(?<![\\w$])${escapeRe(name)}\\s*[(<:=]`) : undefined;
  const fence = (holdsMethod && fences.find((f) => holdsMethod.test(f[1]))) || fences[0];
  const signature = fence ? collapse(fence[1]) : undefined;
  let doc = fence ? markdown.slice((fence.index ?? 0) + fence[0].length) : markdown;
  doc = doc.replace(/^\s*---\s*/, '').trim();
  const paramDocs: Record<string, string> = {};
  for (const m of doc.matchAll(/\*@param\*\s+`?([\w$.]+)`?\s*(?:[—–-]\s*)?(.*)/g)) {
    paramDocs[m[1]] = collapse(m[2]);
  }
  const returns = /\*@returns?\*\s*(?:[—–-]\s*)?(.*)/.exec(doc);
  const tagStart = doc.search(/\*@\w+\*/);
  const description = collapse(tagStart >= 0 ? doc.slice(0, tagStart) : doc) || undefined;
  return { signature, description, paramDocs, returnsDoc: returns ? collapse(returns[1]) : undefined };
}

const BUILTIN_TYPES = new Set([
  'Promise', 'Array', 'ReadonlyArray', 'Record', 'Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'Exclude', 'Extract',
  'NonNullable', 'ReturnType', 'Parameters', 'Awaited', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Date', 'Error', 'RegExp',
  'String', 'Number', 'Boolean', 'Object', 'Function', 'Symbol', 'BigInt', 'Buffer', 'Uint8Array', 'JSON', 'Iterable',
  'Iterator', 'AsyncIterable', 'PromiseLike', 'Generator', 'AsyncGenerator', 'T', 'K', 'V', 'U', 'R',
  'Vec', 'Option', 'Result', 'Box', 'Rc', 'Arc', 'Cell', 'RefCell', 'HashMap', 'HashSet', 'BTreeMap', 'BTreeSet', 'Self', 'Some', 'None', 'Ok', 'Err',
  'Optional', 'List', 'Dict', 'Tuple', 'Any', 'Union', 'Callable', 'Sequence', 'Mapping', 'Iterable', 'Type', 'True', 'False', 'None',
]);

/** Type names worth looking up (user-defined-looking identifiers), in first-seen order, with where each first appears. */
export function typeNamesIn(text: string): Array<{ name: string; index: number }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; index: number }> = [];
  for (const m of text.matchAll(/(?<![\w$."'])([A-Z][A-Za-z0-9_]*)(?![\w$"'])/g)) {
    if (BUILTIN_TYPES.has(m[1]) || seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ name: m[1], index: m.index ?? 0 });
  }
  return out;
}
