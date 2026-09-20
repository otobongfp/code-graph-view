import { BucketItemData, DetailLevel, SigType } from './types';

export interface FormatOptions {
  optInStripComments?: boolean;
  /** Mask credentials in the exported text. On unless set to false. */
  redactSecrets?: boolean;
}

/** Rough estimate of token count for code and structured text (chars ÷ 4). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Determines language tag for code fences from file extension. */
export function languageFromFile(filePath: string): string {
  if (/\.(ts|tsx)$/i.test(filePath)) return 'typescript';
  if (/\.(js|jsx|mjs|cjs)$/i.test(filePath)) return 'javascript';
  if (/\.go$/i.test(filePath)) return 'go';
  if (/\.rs$/i.test(filePath)) return 'rust';
  if (/\.py$/i.test(filePath)) return 'python';
  return 'text';
}

/** Formats dynamic markdown code fences that safely wrap code containing backticks. */
export function codeFence(code: string, lang = ''): string {
  let ticks = '```';
  while (code.includes(ticks)) {
    ticks += '`';
  }
  return `${ticks}${lang}\n${code}\n${ticks}`;
}

/** Strips single and multi-line comments from code if explicitly requested. */
export function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/^\s*#.*$/gm, '')
    .replace(/\n\s*\n/g, '\n');
}

/**
 * Formats an indented ASCII tree of methods reflecting who calls whom.
 * Handles duplicate references and cycles by printing "(see above)".
 */
export function buildTopologyTree(items: BucketItemData[]): string {
  if (items.length === 0) return '(No methods in context bucket)';

  const itemMap = new Map<string, BucketItemData>();
  const childrenMap = new Map<string, string[]>();
  const allIds = new Set<string>();

  for (const item of items) {
    itemMap.set(item.id, item);
    allIds.add(item.id);
  }

  for (const item of items) {
    if (item.parentId && itemMap.has(item.parentId)) {
      const list = childrenMap.get(item.parentId) ?? [];
      list.push(item.id);
      childrenMap.set(item.parentId, list);
    }
  }

  // Root items are those without a parent in the bucket
  const rootIds = items.filter((item) => !item.parentId || !itemMap.has(item.parentId)).map((item) => item.id);

  const lines: string[] = [];
  const visitedGlobal = new Set<string>();

  const renderNode = (id: string, prefix: string, isTail: boolean, branchAncestors: Set<string>, depth: number) => {
    const item = itemMap.get(id);
    if (!item) return;

    const connector = depth > 0 ? (isTail ? '└─ ' : '├─ ') : '';
    const label = `${item.container ? `${item.container}.` : ''}${item.name} (${item.file.split('/').pop()}:${item.resolvedLine + 1})`;

    if (branchAncestors.has(id)) {
      lines.push(`${prefix}${connector}${label} (recursive loop)`);
      return;
    }

    if (visitedGlobal.has(id)) {
      lines.push(`${prefix}${connector}${label} (see above)`);
      return;
    }

    visitedGlobal.add(id);
    lines.push(`${prefix}${connector}${label}`);

    const children = childrenMap.get(id) ?? [];
    const nextAncestors = new Set(branchAncestors).add(id);
    const childPrefix = depth > 0 ? prefix + (isTail ? '   ' : '│  ') : (children.length > 0 ? ' ' : '');

    children.forEach((childId, idx) => {
      const childTail = idx === children.length - 1;
      renderNode(childId, childPrefix, childTail, nextAncestors, depth + 1);
    });
  };

  rootIds.forEach((rootId, idx) => {
    const isTail = idx === rootIds.length - 1;
    renderNode(rootId, '', isTail, new Set(), 0);
  });

  return lines.join('\n');
}

/**
 * Collects and deduplicates all user-defined types/interfaces referenced by methods in the bucket.
 */
export function collectDeduplicatedTypes(items: BucketItemData[]): SigType[] {
  const typeMap = new Map<string, SigType>();
  for (const item of items) {
    if (!item.signature?.types) continue;
    for (const t of item.signature.types) {
      if (!typeMap.has(t.name)) {
        typeMap.set(t.name, t);
      }
    }
  }
  return [...typeMap.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const REDACTED = '[REDACTED]';

/** Well-known credential formats. Specific patterns run before the generic "secret-named field" one. */
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )*PRIVATE KEY-----/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];

/**
 * Masks credentials before code leaves the editor: known key formats, private-key blocks, passwords inside URLs,
 * and quoted values assigned to fields whose name ends in password/secret/token/api key and the like.
 * Deliberately conservative, so ordinary code (`getToken()`, `password: string`, `"${process.env.KEY}"`) is untouched.
 */
export function redactSecrets(text: string): { text: string; count: number } {
  let count = 0;
  const mask = () => {
    count++;
    return REDACTED;
  };
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, mask);
  out = out.replace(/(:\/\/[^\s:@/]+:)(?!\[REDACTED\])[^\s@/]{3,}(@)/g, (_m, a: string, b: string) => `${a}${mask()}${b}`);
  out = out.replace(
    /\b([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|authorization)["']?\s*[:=]\s*)(["'`])(?!\$\{|\{\{|<|%\(|\[REDACTED\])([^"'`\s]{8,})\2/gi,
    (_m, key: string, quote: string) => `${key}${quote}${mask()}${quote}`
  );
  return { text: out, count };
}

/**
 * Generates clean, high-density markdown context ready to paste into any AI chat.
 */
export function formatContextMarkdown(items: BucketItemData[], options: FormatOptions = {}): string {
  if (items.length === 0) return '# Curated Execution Context\n\n(Context bucket is empty)';

  const tree = buildTopologyTree(items);
  const types = collectDeduplicatedTypes(items);

  const totalRawChars = items.reduce((sum, item) => sum + (item.rawFileSize || 0), 0);
  const totalRawTokens = estimateTokens(' '.repeat(totalRawChars));

  const sections: string[] = [];

  sections.push('# Curated Execution Context');
  sections.push(
    `> **Summary**: ${items.length} curated method${items.length === 1 ? '' : 's'} across ${new Set(items.map((i) => i.file)).size} file${new Set(items.map((i) => i.file)).size === 1 ? '' : 's'}.`
  );

  sections.push('## 1. Topology & Call Flow\n\n```text\n' + tree + '\n```');

  sections.push('## 2. Method Specifications');

  items.forEach((item, index) => {
    const parts: string[] = [];
    const displayName = item.container ? `${item.container}.${item.name}` : item.name;
    const lang = languageFromFile(item.file);

    parts.push(`### 2.${index + 1} \`${displayName}\` [${item.level.toUpperCase()}]`);
    parts.push(`- **Location**: \`${item.file}:${item.resolvedLine + 1}\``);

    if (item.level === 'name') {
      parts.push(`- **Identifier**: \`${displayName}\` (${item.kind ?? 'method'})`);
    } else if (item.level === 'signature') {
      if (item.signature) {
        const sig = item.signature;
        const paramsText = sig.params
          .map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type ?? 'any'}`)
          .join(', ');
        const ret = sig.returns?.type ? `: ${sig.returns.type}` : '';
        const sigLine = `${sig.modifiers?.join(' ') ? `${sig.modifiers.join(' ')} ` : ''}${displayName}(${paramsText})${ret}`;
        parts.push(codeFence(sigLine, lang));

        if (sig.description) {
          parts.push(`*Docstring*: ${sig.description}`);
        }
      } else {
        parts.push(`- **Signature**: \`${displayName}(...)\``);
      }
    } else if (item.level === 'full') {
      if (item.body) {
        let code = item.body;
        if (options.optInStripComments) {
          code = stripComments(code);
        }
        parts.push(codeFence(code, lang));
      } else if (item.signature) {
        const sig = item.signature;
        const paramsText = sig.params
          .map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type ?? 'any'}`)
          .join(', ');
        const ret = sig.returns?.type ? `: ${sig.returns.type}` : '';
        parts.push(codeFence(`${displayName}(${paramsText})${ret}`, lang));
      }
    }

    sections.push(parts.join('\n'));
  });

  if (types.length > 0) {
    const typeParts: string[] = ['## 3. Referenced Types & Schemas'];
    types.forEach((t) => {
      const decl = t.declaration ? codeFence(t.declaration, languageFromFile(t.file)) : `\`${t.name}\``;
      typeParts.push(`#### \`${t.name}\` (${t.kind}) — \`${t.file.split('/').pop()}:${t.line + 1}\`\n${decl}`);
    });
    sections.push(typeParts.join('\n\n'));
  }

  const markdown = sections.join('\n\n');
  if (options.redactSecrets === false) return markdown;
  const redacted = redactSecrets(markdown);
  return redacted.count === 0
    ? redacted.text
    : `${redacted.text}\n\n> Note: ${redacted.count} secret-looking value${redacted.count === 1 ? ' was' : 's were'} replaced with ${REDACTED} before export.`;
}

/**
 * Trims detail levels from outer items inward when a token budget is specified.
 */
export function applyTokenBudget(items: BucketItemData[], targetBudget: number): BucketItemData[] {
  if (targetBudget <= 0) return items;

  let current = items.map((i) => ({ ...i }));
  let currentEst = estimateTokens(formatContextMarkdown(current));
  if (currentEst <= targetBudget) return current;

  // Step 1: Lower leaf items from 'full' to 'signature'
  for (let idx = current.length - 1; idx >= 0; idx--) {
    if (current[idx].level === 'full') {
      current[idx].level = 'signature';
      currentEst = estimateTokens(formatContextMarkdown(current));
      if (currentEst <= targetBudget) return current;
    }
  }

  // Step 2: Lower leaf items from 'signature' to 'name'
  for (let idx = current.length - 1; idx >= 0; idx--) {
    if (current[idx].level === 'signature') {
      current[idx].level = 'name';
      currentEst = estimateTokens(formatContextMarkdown(current));
      if (currentEst <= targetBudget) return current;
    }
  }

  return current;
}
