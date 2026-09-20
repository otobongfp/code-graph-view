export interface SymbolRow {
  id: string;
  name: string;
  kind: 'function' | 'method';
  line: number;
  character: number;
}

export interface FileNode {
  id: string;
  label: string;
  file: string;
  symbols: SymbolRow[];
}

/** `source` calls `target`; both are SymbolRow ids. */
export interface CallEdge {
  id: string;
  source: string;
  target: string;
}

/** What a diff view adds to a graph: which methods changed and how, and what could not be placed on a method. */
export interface DiffInfo {
  source: string;
  title: string;
  summary: string;
  /** Symbol id -> how that method changed. */
  changes: Record<string, { kind: 'added' | 'modified'; lines: number }>;
  /** Changes that are not inside any method (imports, types, config, deleted files ...). */
  other: Array<{ file: string; label: string; note: string; line: number }>;
  /** True when some positions were estimated because the code changed since the commit. */
  approximate: boolean;
}

export interface DiffCommit {
  sha: string;
  subject: string;
  author: string;
  when: string;
}

export interface SigParam {
  name: string;
  type?: string;
  optional: boolean;
  rest: boolean;
  defaultValue?: string;
  decorators: string[];
  doc?: string;
  /** The type was worked out by the language server rather than written in the source. */
  inferred?: boolean;
}

/** A type used by a method's inputs or output, with a look at where it is declared. */
export interface SigType {
  name: string;
  kind: string;
  file: string;
  line: number;
  declaration: string;
  truncated: boolean;
}

/** What goes into a method and what comes out of it. */
export interface SignatureData {
  name: string;
  container?: string;
  kind: string;
  file: string;
  line: number;
  character: number;
  decorators: string[];
  modifiers: string[];
  typeParams?: string;
  description?: string;
  params: SigParam[];
  returns?: { type: string; inferred: boolean; doc?: string };
  types: SigType[];
}

export interface GraphData {
  rootFile: string;
  rootFileId: string;
  /** Set when the graph is rooted at a single method rather than a whole file. */
  rootSymbolId?: string;
  rootLabel: string;
  /** Symbol ids the traversal started from; the webview filters by hops from these. */
  roots: string[];
  /** Deepest hop count fetched in either direction. */
  maxDepth: number;
  files: FileNode[];
  edges: CallEdge[];
  truncated: boolean;
  /** Milliseconds the extension spent fetching this graph from the language server. */
  fetchMs: number;
  /** Present when this graph shows the changes of a git diff instead of a file or method. */
  diff?: DiffInfo;
  /** Something the user should know about how complete this graph is, such as a language server without call hierarchy. */
  notice?: string;
}

export interface OpenFileMessage {
  command: 'openFile';
  file: string;
  line: number;
  character: number;
}

export interface RequestRefreshMessage {
  command: 'requestRefresh';
}

/** Re-root the graph on a file (no line) or a single method (line + character). */
export interface FocusMessage {
  command: 'focus';
  file: string;
  line?: number;
  character?: number;
  name?: string;
}

export interface BackMessage {
  command: 'back';
}

export interface ForwardMessage {
  command: 'forward';
}

/** Jump straight to an entry of the navigation trail (a breadcrumb click). */
export interface GoToMessage {
  command: 'goTo';
  index: number;
}

export interface SearchMessage {
  command: 'search';
  query: string;
  id: number;
}

/** Fetch a method's full call chain (both directions) so the hop slider knows how deep it goes. */
export interface ExploreMessage {
  command: 'explore';
  id: string;
  file: string;
  line: number;
  character: number;
}

/** Open the diff view for a source: 'uncommitted', 'unstaged', 'staged', 'branch' or 'commit:<sha>'. */
export interface DiffMessage {
  command: 'diff';
  source: string;
}

export interface DiffSourcesMessage {
  command: 'diffSources';
}

/** Ask for the inputs, output and types of the method at a position. */
export interface SignatureMessage {
  command: 'signature';
  id: number;
  file: string;
  line: number;
  character: number;
}

export interface SearchResult {
  kind: 'file' | 'function' | 'method' | 'class';
  label: string;
  detail: string;
  file: string;
  line: number;
  character: number;
}

export interface SearchResultsMessage {
  command: 'searchResults';
  id: number;
  results: SearchResult[];
}

export interface GraphDataMessage {
  command: 'graphData';
  data: GraphData;
  /** Labels of every root visited, oldest first, and which one is showing. */
  trail: string[];
  cursor: number;
  /** True while the crawl is still running; a final message follows. */
  partial?: boolean;
}

export interface LoadingMessage {
  command: 'loading';
}

export interface ErrorMessage {
  command: 'error';
  message: string;
}

export interface ExploreResultMessage {
  command: 'exploreResult';
  id: string;
  /** Absent when the request was superseded or failed, so the webview can ask again later. */
  data?: GraphData;
}

export interface GitStatusSummary {
  hasHead: boolean;
  uncommittedCount: number;
  unstagedCount: number;
  stagedCount: number;
  branchCount: number;
  baseBranch?: string;
  commits: DiffCommit[];
}

export interface DiffSourcesResultMessage {
  command: 'diffSources';
  commits: DiffCommit[];
  summary?: GitStatusSummary;
  error?: string;
}

export interface SignatureResultMessage {
  command: 'signatureResult';
  id: number;
  data?: SignatureData;
  error?: string;
}

export type DetailLevel = 'name' | 'signature' | 'full';

export interface BucketItemRef {
  id: string;
  file: string;
  name: string;
  container?: string;
  line: number;
  character: number;
  kind: 'method' | 'function';
  parentId?: string;
  level: DetailLevel;
}

export interface BucketItemData extends BucketItemRef {
  resolvedLine: number;
  signature?: SignatureData;
  body?: string;
  rawFileSize: number;
}

export interface BucketSummary {
  items: BucketItemData[];
  estTokens: number;
  rawTokens: number;
  markdown: string;
}

export interface GetBucketMessage {
  command: 'getBucket';
}

export interface AddToBucketMessage {
  command: 'addToBucket';
  items: BucketItemRef[];
}

export interface RemoveFromBucketMessage {
  command: 'removeFromBucket';
  id: string;
}

export interface UpdateBucketLevelMessage {
  command: 'updateBucketLevel';
  id: string;
  level: DetailLevel;
}

export interface ClearBucketMessage {
  command: 'clearBucket';
}

export interface CopyBucketMessage {
  command: 'copyBucket';
}

export interface SendBucketToChatMessage {
  command: 'sendBucketToChat';
}

export interface BucketUpdatedMessage {
  command: 'bucketUpdated';
  summary: BucketSummary;
}

export type WebviewToExtensionMessage =
  | OpenFileMessage
  | RequestRefreshMessage
  | FocusMessage
  | BackMessage
  | ForwardMessage
  | GoToMessage
  | DiffMessage
  | DiffSourcesMessage
  | SignatureMessage
  | SearchMessage
  | ExploreMessage
  | GetBucketMessage
  | AddToBucketMessage
  | RemoveFromBucketMessage
  | UpdateBucketLevelMessage
  | ClearBucketMessage
  | CopyBucketMessage
  | SendBucketToChatMessage;

export type ExtensionToWebviewMessage =
  | SignatureResultMessage
  | DiffSourcesResultMessage
  | ExploreResultMessage
  | GraphDataMessage
  | LoadingMessage
  | ErrorMessage
  | SearchResultsMessage
  | BucketUpdatedMessage;
