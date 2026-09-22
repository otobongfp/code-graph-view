import * as vscode from 'vscode';
import { clearGraphCache, diffRepoRoot } from './graphBuilder';
import { checkoutPullRequest, parsePullRequestRef } from './pullRequest';
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

    vscode.commands.registerCommand('codeGraphView.reviewPullRequest', async () => {
      const input = await vscode.window.showInputBox({
        title: 'Review a pull request',
        prompt: 'Pull request number or link. It will be checked out so it can be analysed.',
        placeHolder: '123',
        validateInput: (v) => (parsePullRequestRef(v) === undefined ? 'Enter a number like 123 or a link ending in /pull/123' : undefined),
      });
      const number = input === undefined ? undefined : parsePullRequestRef(input);
      if (number === undefined) return;
      try {
        const root = await diffRepoRoot();
        const result = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Checking out pull request #${number}…` },
          () => checkoutPullRequest(root, number)
        );
        if (result.caveat) void vscode.window.showWarningMessage(result.caveat);
        CodeGraphPanel.showDiff(context.extensionUri, result.source);
      } catch (err) {
        void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
      }
    }),

    vscode.commands.registerCommand('codeGraphView.refresh', () => {
      CodeGraphPanel.refresh();
    }),

    vscode.workspace.onDidSaveTextDocument(() => clearGraphCache())
  );
}

export function deactivate() {}
