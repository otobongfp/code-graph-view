import * as vscode from 'vscode';
import { clearGraphCache } from './graphBuilder';
import { ContextBucketManager } from './contextBucket';
import { CodeGraphPanel } from './webviewPanel';

export function activate(context: vscode.ExtensionContext) {
  ContextBucketManager.init();
  // Earlier versions saved the AI context in workspace storage; remove anything left over.
  void context.workspaceState.update('codeGraphView.contextBucket', undefined);

  context.subscriptions.push(
    vscode.commands.registerCommand('codeGraphView.open', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showInformationMessage('Open a file to view its code graph.');
        return;
      }
      CodeGraphPanel.createOrShow(context.extensionUri, editor.document.uri);
    }),

    vscode.commands.registerCommand('codeGraphView.openDiff', () => {
      CodeGraphPanel.showDiff(context.extensionUri, 'uncommitted');
    }),

    vscode.commands.registerCommand('codeGraphView.refresh', () => {
      CodeGraphPanel.refresh();
    }),

    vscode.workspace.onDidSaveTextDocument(() => clearGraphCache())
  );
}

export function deactivate() {}
