import * as vscode from 'vscode';
import { getDocumentSymbols, isWorkspaceFile, symbolAt } from './graphBuilder';
import { SigParam, SigType, SignatureData } from './types';
import { parseCallable, parseGenericCallable, parseHeaderPrefix, splitHover, typeNamesIn } from './tsSignature';

const MAX_TYPES = 8;
const MAX_TYPE_LINES = 16;
const MAX_HEADER_CHARS = 4000;

/** The symbol at `pos` and the symbols enclosing it, outermost first. */
function symbolPath(symbols: vscode.DocumentSymbol[], pos: vscode.Position): vscode.DocumentSymbol[] {
  for (const s of symbols) {
    if (s.range.contains(pos)) {
      return [s, ...symbolPath(s.children, pos)];
    }
  }
  return [];
}

function hoverMarkdown(hovers: vscode.Hover[] | undefined): string {
  const parts: string[] = [];
  for (const h of hovers ?? []) {
    for (const c of h.contents) {
      if (typeof c === 'string') parts.push(c);
      else if ('language' in c) parts.push('```' + c.language + '\n' + c.value + '\n```');
      else parts.push(c.value);
    }
  }
  return parts.join('\n\n');
}

function declarationKind(text: string): string {
  const m = /\b(interface|abstract class|class|enum|type|function|const)\b/.exec(text.split('\n')[0]);
  return m ? m[1] : 'type';
}

/** Where `name` is declared and how it looks, or undefined for library types and anything outside the workspace. */
async function resolveType(
  name: string,
  uri: vscode.Uri,
  usedAt: vscode.Position | undefined
): Promise<SigType | undefined> {
  let target: { uri: vscode.Uri; pos: vscode.Position } | undefined;
  if (usedAt) {
    const found = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink> | undefined>(
      'vscode.executeDefinitionProvider',
      uri,
      usedAt
    );
    for (const f of found ?? []) {
      const loc = 'targetUri' in f ? { uri: f.targetUri, range: f.targetSelectionRange ?? f.targetRange } : f;
      if (loc.range && isWorkspaceFile(loc.uri)) {
        target = { uri: loc.uri, pos: loc.range.start };
        break;
      }
    }
  }
  if (!target) {
    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[] | undefined>(
      'vscode.executeWorkspaceSymbolProvider',
      name
    );
    const hit = (symbols ?? []).find((s) => s.name === name && isWorkspaceFile(s.location.uri));
    if (hit) target = { uri: hit.location.uri, pos: hit.location.range.start };
  }
  if (!target) return undefined;

  const doc = await vscode.workspace.openTextDocument(target.uri);
  const enclosing = symbolAt(await getDocumentSymbols(target.uri), target.pos);
  const startLine = enclosing ? enclosing.range.start.line : target.pos.line;
  const endLine = enclosing ? enclosing.range.end.line : Math.min(doc.lineCount - 1, target.pos.line + 8);
  const lastShown = Math.min(endLine, startLine + MAX_TYPE_LINES - 1);
  const declaration = doc.getText(new vscode.Range(startLine, 0, lastShown, doc.lineAt(lastShown).text.length));
  return {
    name,
    kind: declarationKind(declaration),
    file: target.uri.fsPath,
    line: startLine,
    declaration,
    truncated: endLine > lastShown,
  };
}

/**
 * Inputs, output and types of the method at `position`. Parameters and the return type come from the source
 * when written there and from the language server's hover when inferred; doc comments come from the hover too.
 */
export async function getSignature(uri: vscode.Uri, position: vscode.Position): Promise<SignatureData> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const path = symbolPath(await getDocumentSymbols(uri), position);
  const symbol = path[path.length - 1] ?? symbolAt([], position);
  if (!symbol) {
    throw new Error('No method or function found at this position.');
  }
  const container = [...path]
    .reverse()
    .slice(1)
    .find((s) => [
        vscode.SymbolKind.Class,
        vscode.SymbolKind.Struct,
        vscode.SymbolKind.Enum,
        vscode.SymbolKind.Object,
        vscode.SymbolKind.Interface,
        vscode.SymbolKind.Module,
        vscode.SymbolKind.Namespace,
      ].includes(s.kind));

  const nameAt = symbol.selectionRange.start;
  const endOffset = Math.min(doc.offsetAt(symbol.range.end), doc.offsetAt(nameAt) + MAX_HEADER_CHARS);
  const source = doc.getText(new vscode.Range(nameAt, doc.positionAt(endOffset)));
  const prefix = parseHeaderPrefix(doc.getText(new vscode.Range(symbol.range.start, nameAt)));
  // The TypeScript parser understands `name(a: A): B`; the generic one understands Go, Rust, Python and friends.
  // Using the TypeScript one on those would "succeed" with the wrong answer, so pick by language.
  const tsLike = /^(typescript|typescriptreact|javascript|javascriptreact)$/.test(doc.languageId);
  const parse = (text: string) =>
    tsLike
      ? (parseCallable(text, symbol.name) ?? parseGenericCallable(text, symbol.name, doc.languageId))
      : parseGenericCallable(text, symbol.name, doc.languageId);
  const fromSource = parse(source);

  const hovers = await vscode.commands.executeCommand<vscode.Hover[] | undefined>('vscode.executeHoverProvider', uri, nameAt);
  const hover = splitHover(hoverMarkdown(hovers), symbol.name);
  const fromHover = hover.signature ? parse(hover.signature) : undefined;

  const base = fromSource ?? fromHover;
  const params: SigParam[] = (base?.params ?? []).map((p, i) => {
    const inferredType = !p.type ? fromHover?.params[i]?.type : undefined;
    return {
      ...p,
      type: p.type ?? inferredType,
      inferred: inferredType !== undefined,
      doc: hover.paramDocs[p.name],
    };
  });
  const returnType = fromSource?.returnType ?? fromHover?.returnType;
  const returns = returnType
    ? { type: returnType, inferred: !fromSource?.returnType, doc: hover.returnsDoc }
    : undefined;

  // Look up each user-defined type mentioned, using its position in the source when it is written there.
  const mentioned = typeNamesIn([...params.map((p) => p.type ?? ''), returns?.type ?? ''].join(' , ')).slice(0, MAX_TYPES);
  const startOffset = doc.offsetAt(nameAt);
  const types: SigType[] = [];
  const seen = new Set<string>();
  for (const { name } of mentioned) {
    const inSource = new RegExp(`(?<![\\w$.])${name}(?![\\w$])`).exec(source);
    const usedAt = inSource ? doc.positionAt(startOffset + inSource.index) : undefined;
    const type = await resolveType(name, uri, usedAt).catch(() => undefined);
    if (type && !seen.has(`${type.file}:${type.line}`)) {
      seen.add(`${type.file}:${type.line}`);
      types.push(type);
    }
  }

  return {
    name: symbol.name,
    container: container?.name,
    kind: vscode.SymbolKind[symbol.kind].toLowerCase(),
    file: uri.fsPath,
    line: nameAt.line,
    character: nameAt.character,
    decorators: prefix.decorators,
    modifiers: prefix.modifiers,
    typeParams: base?.typeParams,
    description: hover.description,
    params,
    returns,
    types,
  };
}
