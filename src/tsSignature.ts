/** Reads the inputs and output of a TypeScript/JavaScript callable from source or hover text. No VS Code APIs. */

import type { UnwrappedReturn } from './types';

export interface ParsedParam {
  name: string;
  type?: string;
  optional: boolean;
  rest: boolean;
  defaultValue?: string;
  /** Decorators on the parameter, such as `@Body()` or `@Param('id')`. */
  decorators: string[];
  readonly?: boolean;
  nullable?: boolean;
  mutable?: boolean;
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
  const isReadonly = /\breadonly\b/.test(text);
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

  const isNullable = optional || (type ? /(?:\?\s*$|\|\s*(?:null|undefined)\b|\b(?:null|undefined)\s*\||\b(?:Option|Optional|Nullable)(?:<|\[))/i.test(type) : false);

  return {
    name,
    type,
    optional: optional || defaultValue !== undefined,
    rest: restParam,
    defaultValue,
    decorators,
    readonly: isReadonly || undefined,
    nullable: isNullable || undefined,
  };
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

const MUT_LEAD_RE = /^(?:mut|inout|ref|out|var)\s+/;
const RO_LEAD_RE = /^(?:readonly|const|val|in|final)\s+/;

/**
 * Language-agnostic parser for callables in Go, Rust, Python, Java, C#, C/C++, PHP, Kotlin, Dart, Ruby, Swift, Scala, Zig, Lua:
 * parameters between `(…)` and return types (either trailing via `->`/`:` or preceding the function name).
 * Pass `name` so receivers/prefixes are handled accurately, and `languageId` for language-specific syntax.
 */
export function parseGenericCallable(text: string, name?: string, languageId?: string): ParsedCallable | undefined {
  if (!text) return undefined;
  const lang = (languageId || '').toLowerCase();
  let start = 0;
  if (name) {
    const at = new RegExp(`(?<![\\w$])${escapeRe(name)}\\s*(?:<[^()]*>|\\[[^\\]()]*\\])?\\s*\\(`).exec(text);
    if (at) start = at.index;
  }
  // Rust lifetimes (`&'a str`) look like the start of a string to the bracket scanner, so drop them.
  const body = lang === 'rust' ? text.slice(start).replace(/'[A-Za-z_]\w*\s?/g, '') : text.slice(start);
  const parenOpen = body.indexOf('(');
  if (parenOpen < 0) return undefined;
  const parenClose = matchClose(body, parenOpen);
  if (parenClose < 0) return undefined;

  const isCStyle = lang === 'java' || lang === 'csharp' || lang === 'cs' || lang === 'c' || lang === 'cpp' || lang === 'cxx' || lang === 'dart';
  const isPhp = lang === 'php';

  const params: ParsedParam[] = [];
  for (const raw of splitTop(body.slice(parenOpen + 1, parenClose))) {
    const p = raw.trim();
    if (!p) continue;
    let isOptional = false;
    let mainPart = p;

    // Dart named params `{param = val}` or positional optional `[param = val]`
    if ((mainPart.startsWith('{') && mainPart.endsWith('}')) || (mainPart.startsWith('[') && mainPart.endsWith(']'))) {
      isOptional = true;
      mainPart = mainPart.slice(1, -1).trim();
    }

    let rest = mainPart.startsWith('...') || mainPart.startsWith('*') || /\bparams\s+/.test(mainPart) || mainPart.includes('...');
    const clean = mainPart.replace(/^\.{3}|^\*{1,2}/, '').replace(/\bparams\s+/, '').trim();
    mainPart = clean;

    let defaultValue: string | undefined;
    const eqIdx = mainPart.indexOf('=');
    if (eqIdx >= 0) {
      defaultValue = mainPart.slice(eqIdx + 1).trim();
      mainPart = mainPart.slice(0, eqIdx).trim();
    }

    const add = (pName: string, pType: string | undefined, mutFlag?: boolean, roFlag?: boolean) => {
      let isMut = mutFlag;
      let isRo = roFlag;
      if (pType) {
        if (/(?:^|\s)&mut(?:\s|\[|[A-Za-z_]|$)/.test(pType) || /\b(?:mut|&mut|inout)\b/.test(pType)) {
          isMut = true;
        } else if (/(?:^|\s)&(?!\s*mut\b)(?:\[|[A-Za-z_])/.test(pType) || /\b(?:readonly|const)\b/.test(pType)) {
          isRo = true;
        }
      }
      const isNull = isOptional || (pType ? /(?:\?\s*$|\|\s*(?:null|undefined|nil|None)\b|\b(?:null|undefined|nil|None)\s*\||\b(?:Option|Optional|Nullable)(?:<|\[))/i.test(pType) : false);
      params.push({
        name: pName || 'param',
        type: pType || undefined,
        optional: isOptional || defaultValue !== undefined,
        rest,
        defaultValue,
        decorators: [],
        readonly: isRo && !isMut ? true : undefined,
        nullable: isNull || undefined,
        mutable: isMut || undefined,
      });
    };

    // Rust receivers: `self`, `&self`, `&mut self`, `mut self`.
    if (/^&?\s*(?:mut\s+)?self\b/.test(mainPart)) {
      const isMutSelf = /^&?\s*mut\s+self\b/.test(mainPart);
      const isRoSelf = /^&\s*self\b/.test(mainPart);
      add(mainPart, undefined, isMutSelf, isRoSelf);
      continue;
    }

    // PHP: variables start with `$`
    if (isPhp || mainPart.includes('$')) {
      const dollarIdx = mainPart.indexOf('$');
      if (dollarIdx >= 0) {
        let pName = mainPart.slice(dollarIdx).trim();
        if (pName.startsWith('...')) {
          rest = true;
          pName = pName.slice(3).trim();
        }
        const pType = mainPart.slice(0, dollarIdx).trim() || undefined;
        add(pName, pType);
        continue;
      }
    }

    // Explicit colon syntax: `name: Type` (Python, Kotlin, TypeScript, Swift, Scala, Zig, Rust, etc.)
    const colonIdx = !isCStyle ? mainPart.indexOf(':') : -1;
    if (colonIdx >= 0 && mainPart[colonIdx + 1] !== ':') {
      let rawName = mainPart.slice(0, colonIdx).trim();
      let isMut = false;
      let isRo = false;
      if (MUT_LEAD_RE.test(rawName)) {
        isMut = true;
        rawName = rawName.replace(MUT_LEAD_RE, '').trim();
      } else if (RO_LEAD_RE.test(rawName)) {
        isRo = true;
        rawName = rawName.replace(RO_LEAD_RE, '').trim();
      }
      const pWords = rawName.split(/\s+/).filter(Boolean);
      const pName = pWords.length > 1 ? pWords[pWords.length - 1] : rawName;
      add(pName, mainPart.slice(colonIdx + 1).trim(), isMut, isRo);
      continue;
    }

    // Java, C#, C/C++, Dart style: `[modifiers/annotations] Type name`
    if (isCStyle) {
      let s = mainPart;
      if (s.includes('...')) {
        rest = true;
        s = s.replace('...', ' ').trim();
      }
      const lastSpace = s.lastIndexOf(' ');
      if (lastSpace >= 0) {
        let pType = s.slice(0, lastSpace).trim();
        const pName = s.slice(lastSpace + 1).trim();
        pType = pType.replace(/@\w+(?:\([^)]*\))?\s*/g, '').trim();
        let isMut = false;
        let isRo = false;
        if (/\b(?:out|ref|inout)\b/.test(pType)) isMut = true;
        if (/\b(?:const|readonly|final|in)\b/.test(pType)) isRo = true;
        add(pName, pType, isMut, isRo);
        continue;
      }
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

  if (lang === 'go' && params.length > 0) {
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

  // The return type is read from the declaration line or prefix before method name
  const line = body
    .slice(parenClose + 1)
    .split('\n')[0]
    .replace(/\s*\/\/.*$/, '')
    .trim();
  const tidy = (t: string) =>
    t
      .replace(/\s+where\b.*$/, '')
      .replace(/\s*=\s*\{?.*$/, '')
      .replace(/\s\{.*$/, '')
      .replace(/[{;=]\s*$/, '')
      .replace(/:\s*$/, '')
      .replace(/\b(async\*?|sync\*?)\b/g, '')
      .trim() || undefined;

  let returnType: string | undefined;
  if (line.startsWith('->')) returnType = tidy(line.slice(2));
  else if (line.startsWith(':')) returnType = tidy(line.slice(1));
  else if (line && !line.startsWith('{') && !line.startsWith(';') && !line.startsWith('=') && !/^(async\*?|sync\*?)\b/.test(line)) {
    returnType = tidy(line);
  }

  // If return type is preceding the function name (Java, C#, C/C++, Dart)
  if (!returnType && start > 0 && isCStyle) {
    const pre = text.slice(0, start).trim();
    const preLines = pre.split('\n');
    const lastLine = preLines[preLines.length - 1].trim();
    const stripped = lastLine
      .replace(/@\w+(?:\([^)]*\))?\s*/g, '')
      .replace(/\[[^\]]+\]\s*/g, '')
      .replace(/\b(public|protected|private|internal|static|final|abstract|synchronized|native|default|strictfp|async|override|virtual|sealed|partial|extern|unsafe|readonly|inline|constexpr|consteval|explicit|friend|late|const)\b/g, '')
      .trim();
    if (stripped) {
      returnType = stripped.replace(/^<[^>]+>\s*/, '').trim() || undefined;
    }
  }

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
  'Task', 'ValueTask', 'IEnumerable', 'IList', 'IDictionary', 'ICollection', 'Nullable', 'Action', 'Func',
  'Integer', 'Double', 'Float', 'Long', 'Short', 'Byte', 'Character', 'Class', 'Void',
  'std', 'vector', 'string', 'unique_ptr', 'shared_ptr',
  'Future', 'Stream', 'Widget', 'BuildContext', 'State', 'Int', 'Bool', 'Dictionary', 'Nil', 'Table', 'Unit',
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

const WRAPPER_NAMES = new Set([
  'Promise', 'Task', 'ValueTask', 'Future', 'Result', 'Option', 'Optional', 'Nullable',
  'Observable', 'Stream', 'Either', 'Response', 'ActionResult', 'AsyncIterable',
  'AsyncIterator', 'Generator', 'AsyncGenerator',
]);

/** Deconstructs wrapper types (Promises, Tasks, Results, Options, Streams, etc.) to extract payload and error paths. */
export function unwrapReturnType(typeStr?: string): UnwrappedReturn | undefined {
  if (!typeStr) return undefined;
  const clean = typeStr.trim();
  if (splitTop(clean, '|').length > 1) return undefined;
  const angleOpen = clean.indexOf('<');
  if (angleOpen <= 0) return undefined;
  const angleClose = matchAngle(clean, angleOpen);
  if (angleClose !== clean.length - 1) return undefined;

  const wrapper = clean.slice(0, angleOpen).trim();
  if (!WRAPPER_NAMES.has(wrapper)) return undefined;

  const innerText = clean.slice(angleOpen + 1, angleClose).trim();
  const parts = splitTop(innerText, ',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;

  let payload = parts[0];
  let error: string | undefined;

  if (wrapper === 'Result' || wrapper === 'Either') {
    if (parts.length >= 2) {
      if (wrapper === 'Either') {
        payload = parts[1];
        error = parts[0];
      } else {
        payload = parts[0];
        error = parts[1];
      }
    }
  }

  const nested = unwrapReturnType(payload);

  return {
    wrapper,
    payload,
    error,
    inner: nested,
  };
}

/** Classifies whether a callable acts as a Query (read-only/pure calculation) or a Command (state mutation/side-effect). */
export function classifyCallable(
  name: string,
  returnType?: string,
  modifiers: string[] = []
): 'query' | 'command' | 'unknown' {
  if (modifiers.includes('get')) return 'query';
  if (modifiers.includes('set')) return 'command';

  const cleanReturn = (returnType ?? '').trim();
  const isVoidReturn =
    /^(?:void|Promise<void>|Task<void>|ValueTask<void>|Future<void>|None|nil|\(\)|std::monostate)$/i.test(
      cleanReturn
    );

  const head = name.replace(/^_+/, '');
  const verb = (head[0]?.toLowerCase() ?? '') + head.slice(1);

  const commandVerbPattern =
    /^(?:set|update|delete|remove|insert|add|push|pop|shift|unshift|clear|reset|save|store|write|create|build|make|handle|process|dispatch|send|emit|post|put|apply|mutate|execute|run|start|stop|init|destroy|close|open|toggle|connect|disconnect|publish|subscribe)(?=$|[A-Z_\d])/;

  const queryVerbPattern =
    /^(?:get|is|has|can|should|find|lookup|search|fetch|query|read|load|count|calculate|compute|to|as|parse|format|extract|validate|check|filter|select|map|list|peek|describe)(?=$|[A-Z_\d])/;

  if (isVoidReturn) return 'command';
  if (commandVerbPattern.test(verb)) return 'command';
  if (queryVerbPattern.test(verb)) return 'query';
  if (cleanReturn && cleanReturn !== 'unknown' && cleanReturn !== 'any') return 'query';

  return 'unknown';
}
