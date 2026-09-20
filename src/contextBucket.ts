import * as fs from 'fs';
import * as vscode from 'vscode';
import { estimateTokens, formatContextMarkdown } from './contextCompressor';
import { getDocumentSymbols, symbolAt } from './graphBuilder';
import { getSignature } from './signatureProvider';
import { BucketItemData, BucketItemRef, BucketSummary, DetailLevel } from './types';

export class ContextBucketManager {
  private static instance: ContextBucketManager | undefined;
  private items: BucketItemRef[] = [];
  private onDidUpdateEmitter = new vscode.EventEmitter<BucketSummary>();
  public readonly onDidUpdate = this.onDidUpdateEmitter.event;

  // Kept in memory only: it lives as long as the window, so closing the workspace clears it.
  public static init(): ContextBucketManager {
    if (!ContextBucketManager.instance) {
      ContextBucketManager.instance = new ContextBucketManager();
    }
    return ContextBucketManager.instance;
  }

  public static get(): ContextBucketManager | undefined {
    return ContextBucketManager.instance;
  }

  public getItems(): BucketItemRef[] {
    return [...this.items];
  }

  public async addItems(newItems: BucketItemRef[]): Promise<BucketSummary> {
    const existingIds = new Set(this.items.map((i) => i.id));
    for (const item of newItems) {
      if (!existingIds.has(item.id)) {
        this.items.push({
          id: item.id,
          file: item.file,
          name: item.name,
          line: item.line ?? 0,
          character: item.character ?? 0,
          kind: item.kind ?? 'method',
          level: item.level || 'signature',
          parentId: item.parentId,
        });
        existingIds.add(item.id);
      } else {
        const existing = this.items.find((i) => i.id === item.id);
        if (existing) {
          if (item.parentId && !existing.parentId) {
            existing.parentId = item.parentId;
          }
          if (item.line !== undefined) existing.line = item.line;
          if (item.character !== undefined) existing.character = item.character;
        }
      }
    }
    return this.resolveSummary();
  }

  public async removeItem(id: string): Promise<BucketSummary> {
    this.items = this.items.filter((i) => i.id !== id);
    return this.resolveSummary();
  }

  public async updateLevel(id: string, level: DetailLevel): Promise<BucketSummary> {
    const item = this.items.find((i) => i.id === id);
    if (item) {
      item.level = level;
      }
    return this.resolveSummary();
  }

  public async clear(): Promise<BucketSummary> {
    this.items = [];
    return this.resolveSummary();
  }

  public async resolveSummary(): Promise<BucketSummary> {
    const resolved: BucketItemData[] = [];
    const rawFileSizes = new Map<string, number>();

    for (const ref of this.items) {
      const uri = vscode.Uri.file(ref.file);
      let rawSize = rawFileSizes.get(ref.file);
      if (rawSize === undefined) {
        try {
          rawSize = fs.existsSync(ref.file) ? fs.statSync(ref.file).size : 0;
        } catch {
          rawSize = 0;
        }
        rawFileSizes.set(ref.file, rawSize);
      }

      let resolvedLine = ref.line ?? 0;
      let pos = new vscode.Position(ref.line ?? 0, ref.character ?? 0);
      let body: string | undefined;
      let signature = undefined;

      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const symbols = await getDocumentSymbols(uri);
        const enclosing = symbolAt(symbols, pos);

        if (enclosing) {
          resolvedLine = enclosing.selectionRange.start.line;
          pos = enclosing.selectionRange.start;
          if (ref.level === 'full') {
            body = doc.getText(enclosing.range);
          }
        }

        if (ref.level === 'signature' || ref.level === 'full') {
          signature = await getSignature(uri, pos).catch(() => undefined);
        }
      } catch {}

      resolved.push({
        ...ref,
        resolvedLine,
        signature,
        body,
        rawFileSize: rawSize,
      });
    }

    const redact = vscode.workspace.getConfiguration('codeGraphView').get<boolean>('redactSecrets', true);
    const markdown = formatContextMarkdown(resolved, { redactSecrets: redact });
    const estTokens = estimateTokens(markdown);
    const totalRawBytes = Array.from(rawFileSizes.values()).reduce((a, b) => a + b, 0);
    const rawTokens = estimateTokens(' '.repeat(totalRawBytes));

    const summary: BucketSummary = {
      items: resolved,
      estTokens,
      rawTokens,
      markdown,
    };

    this.onDidUpdateEmitter.fire(summary);
    return summary;
  }
}
