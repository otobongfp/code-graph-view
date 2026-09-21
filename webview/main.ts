import ELK, { ElkNode } from 'elkjs/lib/elk.bundled.js';
import styles from './styles.css';
import type {
  BucketItemRef,
  BucketSummary,
  CallEdge,
  DetailLevel,
  DiffCommit,
  ExtensionToWebviewMessage,
  FileNode,
  GitStatusSummary,
  GraphData,
  SearchResult,
  SignatureData,
  SymbolRow,
  WebviewToExtensionMessage,
} from '../src/types';

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewToExtensionMessage): void;
};

const vscode = acquireVsCodeApi();
const elk = new ELK();
const app = document.getElementById('app')!;

const HEADER_H = 28;
const ROW_H = 24;
const SUB_H = 20;
const CARD_PAD_BOTTOM = 6;
const CORNER = 8;
const CHAR_W = 7;
const MIN_W = 170;
const MAX_W = 380;
const CANVAS_PAD = 24;
const DEFAULT_DEPTH = 2;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.25;
const FIT_MARGIN = 24;
const EDGE_CORNER = 8;
const SUB_MAX = 12;

/** Rows per card page follow the window height so a page fills the screen instead of a fixed handful. */
function pageSize(): number {
  return Math.max(10, Math.min(40, Math.floor((window.innerHeight - 240) / ROW_H)));
}

const layoutCache = new Map<string, ElkNode>();

const HINT_METHODS = 'Click a method to trace its calls and open it · double-click to start from it · ? for help';
const HINT_DIFF = 'Only changed methods are shown (amber = modified, green = new) · Callers shows what a change could affect · ? for help';
const HINT_SERVICES = 'One box per file; a number on a line = calls between two files · click to trace · ? for help';

const ICONS = {
  back: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M10.7 13.7L5 8l5.7-5.7.7.7L6.4 8l5 5z"/></svg>`,
  fwd: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.3 2.3L11 8l-5.7 5.7-.7-.7L9.6 8l-5-5z"/></svg>`,
  zoomOut: `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  zoomIn: `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  fit: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3"/></svg>`,
  tidy: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="4.5" height="4.5" rx="1"/><rect x="9.5" y="2" width="4.5" height="4.5" rx="1"/><rect x="2" y="9.5" width="4.5" height="4.5" rx="1"/><rect x="9.5" y="9.5" width="4.5" height="4.5" rx="1"/></svg>`,
  isolate: `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="2.6" fill="currentColor"/></svg>`,
  signature: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4h2.5a2 2 0 012 2v4a2 2 0 002 2h1.5M3 8.5h6"/></svg>`,
  robot: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4.5" width="11" height="9" rx="2.5"/><path d="M8 1.5v3M1 9h1.5M13.5 9H15"/><circle cx="5.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="10.5" cy="8.5" r="1.1" fill="currentColor"/><path d="M5.5 11h5"/></svg>`,
  plus: `<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  refresh: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8A5.5 5.5 0 1 1 12 4.2L13.5 2.5V7H9"/></svg>`,
  help: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"/><path d="M6.5 6.2a1.5 1.5 0 0 1 2.8.6c0 .8-1.3 1.1-1.3 2"/><circle cx="8" cy="11.8" r=".8" fill="currentColor"/></svg>`,
  diff: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="4" cy="4" r="2"/><circle cx="4" cy="12" r="2"/><circle cx="12" cy="6" r="2"/><path d="M4 6v4M4 8a4 4 0 0 0 4-4v0a4 4 0 0 1 4 2"/></svg>`,
  mode: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="2" y="2.5" width="12" height="3.5" rx="1"/><rect x="2" y="8" width="5.5" height="5.5" rx="1"/><rect x="8.5" y="8" width="5.5" height="5.5" rx="1"/></svg>`,
};

app.innerHTML = `<style>${styles}</style>
  <div id="shell">
    <div id="searchbar">
      <input id="q" type="text" placeholder="Search files and symbols…   ( / )" autocomplete="off" spellcheck="false" />
      <div id="results" hidden></div>
    </div>
    <div id="body">
      <div id="left">
        <div id="main"></div>
        <div id="hopctl" hidden><span class="hl">Hops</span><input id="hops" type="range" min="1" max="1" value="1" /><span id="hoplabel"></span></div>
      </div>
      <div id="splitter" hidden></div>
      <aside id="rightdock" hidden>
        <div id="dock-tabs">
          <button id="tab-sig" class="dock-tab active" title="Signature Inspector (Alt+S)">
            <span class="dock-tab-icon">${ICONS.signature}</span>
            <span>Signature</span>
          </button>
          <button id="tab-bucket" class="dock-tab" title="AI Context (Alt+C)">
            <span class="dock-tab-icon">${ICONS.robot}</span>
            <span>AI Context</span>
            <span id="tab-bucket-badge" class="dock-badge" hidden>0</span>
          </button>
          <button id="dock-close" class="dock-close-btn" title="Close panel">✕</button>
        </div>
        <div id="dock-content-sig" class="dock-content">
          <div id="sg-head">
            <span id="sg-title"></span>
            <span class="spacer"></span>
            <button id="sg-open" title="Open this method in the editor">Open in editor</button>
          </div>
          <div id="sg-body"></div>
        </div>
        <div id="dock-content-bucket" class="dock-content" hidden>
          <div id="bk-toolbar">
            <span class="bk-title">${ICONS.robot} AI Context</span>
            <span class="spacer"></span>
            <button id="bk-add-trace" class="bk-btn" title="Add all currently traced methods to context">+ Add Trace</button>
            <button id="bk-clear" class="bk-btn bk-btn-danger" title="Clear all items in context">Clear</button>
          </div>
          <div class="bk-desc-box">
            Collect methods & call paths from the graph to export clean, structured context for your AI assistant.
          </div>
          <div id="bk-list"></div>
          <div id="bk-footer">
            <button id="bk-copy" class="bk-primary-btn" title="Copy context to clipboard">Copy Context</button>
            <button id="bk-chat" class="bk-secondary-btn" title="Send context directly to VS Code Chat">Send to Chat</button>
          </div>
        </div>
      </aside>
    </div>
  </div>`;
const main = document.getElementById('main')!;
const hopCtl = document.getElementById('hopctl')!;
const hopSlider = document.getElementById('hops') as HTMLInputElement;
const hopLabel = document.getElementById('hoplabel')!;
const rightDock = document.getElementById('rightdock')!;
const dockSplit = document.getElementById('splitter')!;
const tabSigBtn = document.getElementById('tab-sig')!;
const tabBucketBtn = document.getElementById('tab-bucket')!;
const tabBucketBadge = document.getElementById('tab-bucket-badge')!;
const dockCloseBtn = document.getElementById('dock-close')!;
const dockContentSig = document.getElementById('dock-content-sig')!;
const dockContentBucket = document.getElementById('dock-content-bucket')!;
const sgBody = document.getElementById('sg-body')!;
const sgTitle = document.getElementById('sg-title')!;
const bkList = document.getElementById('bk-list')!;

let activeDockTab: 'sig' | 'bucket' = 'sig';
let dockOpen = false;
let currentBucketSummary: BucketSummary | null = null;
let latestSymInfoAll = new Map<string, { row: SymbolRow; file: FileNode; index: number }>();

type Mode = 'methods' | 'services';
type Show = 'both' | 'callers' | 'callees';

interface Point {
  x: number;
  y: number;
}

interface Selection {
  syms: Set<string>;
  edges: Set<string>;
  focus: Set<string>;
  focusEdge?: string;
}

interface CallTarget {
  row: SymbolRow;
  file: FileNode;
  cross: boolean;
}

interface RowGeom {
  top: number;
  calls: CallTarget[];
  more: number;
  fold: boolean;
}

interface PageInfo {
  page: number;
  count: number;
  from: number;
  to: number;
  total: number;
}

interface Reach {
  hops: Map<string, number>;
  dirs: Map<string, 'up' | 'down'>;
  edges: Set<string>;
  maxHop: number;
}

/** Everything within `limit` hops of `start`: callees ('down') and callers ('up'), with hop distances. */
function reach(data: GraphData, start: string, limit: number): Reach {
  const out = group(data.edges, (e) => e.source);
  const inn = group(data.edges, (e) => e.target);
  const hops = new Map<string, number>([[start, 0]]);
  const dirs = new Map<string, 'up' | 'down'>();
  const edges = new Set<string>();
  let maxHop = 0;
  const walk = (adj: Map<string, CallEdge[]>, forward: boolean) => {
    const seen = new Set([start]);
    let frontier = [start];
    for (let d = 1; d <= limit && frontier.length > 0; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const e of adj.get(id) ?? []) {
          edges.add(e.id);
          const other = forward ? e.target : e.source;
          if (seen.has(other)) continue;
          seen.add(other);
          next.push(other);
          maxHop = Math.max(maxHop, d);
          if (!hops.has(other) || hops.get(other)! > d) {
            hops.set(other, d);
            dirs.set(other, forward ? 'down' : 'up');
          }
        }
      }
      frontier = next;
    }
  };
  walk(out, true);
  walk(inn, false);
  return { hops, dirs, edges, maxHop };
}

function mergeInto(target: GraphData, delta: GraphData) {
  for (const f of delta.files) {
    const existing = target.files.find((x) => x.id === f.id);
    if (!existing) {
      target.files.push({ ...f, symbols: [...f.symbols] });
      continue;
    }
    const have = new Set(existing.symbols.map((sym) => sym.id));
    for (const sym of f.symbols) if (!have.has(sym.id)) existing.symbols.push(sym);
    existing.symbols.sort((a, b) => a.line - b.line);
  }
  const haveEdges = new Set(target.edges.map((e) => e.id));
  for (const e of delta.edges) if (!haveEdges.has(e.id)) target.edges.push(e);
}

interface View {
  extras: boolean;
  /** Files and edges before paging, so callee lists still name methods that are on another page. */
  allFiles: FileNode[];
  allEdges: CallEdge[];
  pageInfo: Map<string, PageInfo>;
  files: FileNode[];
  edges: CallEdge[];
  counts: Map<string, number>;
  tips: Map<string, string>;
}

let mode: Mode = 'methods';
let show: Show = 'both';
let depth = DEFAULT_DEPTH;
let isolate: { syms: Set<string>; edges: Set<string> } | null = null;
let expanded = new Set<string>();
let lastSel: { starts: string[]; edgeId?: string } | null = null;
let trail: string[] = [];
let cursor = -1;
interface FlowStep {
  symId: string;
  name: string;
  file: string;
  line: number;
  character: number;
}
let flowTrail: FlowStep[] = [];
/** Steps peeled off the end of the flow trail by Back, newest last, so Forward can replay them. */
let flowFwd: FlowStep[] = [];
/** Steps Back/Forward through the flow trail; false means it had nothing to do and the root history should move instead. */
let flowNav: ((dir: -1 | 1) => boolean) | null = null;
let renderSeq = 0;
let currentData: GraphData | null = null;
/** The method whose call chain is being explored, and how many hops of it to show. */
let pin: { start: string; hops: number } | null = null;
const explored = new Set<string>();
const exploreDone = new Set<string>();
const exploreTruncated = new Set<string>();
let onExplored: (() => void) | null = null;
let lastPinRender = '';
const pageOf = new Map<string, number>();
const subAll = new Set<string>();
let hopTotal = 0;
let hopTimer: number | undefined;
let rerenderCurrent: (() => void) | null = null;

function paintSlider() {
  const min = Number(hopSlider.min);
  const max = Number(hopSlider.max);
  const pct = max > min ? ((Number(hopSlider.value) - min) / (max - min)) * 100 : 100;
  hopSlider.style.setProperty('--pct', `${pct}%`);
}

hopSlider.addEventListener('input', () => {
  if (!pin) return;
  pin.hops = Number(hopSlider.value);
  hopLabel.textContent = `${pin.hops} of ${hopTotal} hops`;
  paintSlider();
  window.clearTimeout(hopTimer);
  hopTimer = window.setTimeout(() => rerenderCurrent?.(), 120);
});

let view = { tx: 0, ty: 0, k: 1 };
/** True when the next render should re-fit the view (new graph or a different mode) instead of keeping it. */
let refit = true;
/** Elements (`card:<file>` / `row:<symbol>`) whose on-screen position must not change across the next re-layout. */
let anchorKeys: string[] = [];
/** World positions of cards and rows from the last render, used to slide cards instead of teleporting them. */
let prevPos = new Map<string, { x: number; y: number }>();
interface MapState {
  /** Column of each card (0 is the anchor column; callers go negative, callees positive). */
  col: Map<string, number>;
  /** Canonical top of each card; cards are only ever pushed down from it, never re-laid-out. */
  y: Map<string, number>;
  /** Widest card ever seen in each column, so columns never shift sideways when a card shrinks. */
  colW: Map<number, number>;
}

const GUTTER = 130;
const GAP_Y = 28;
const DEFAULT_COL_W = 240;
const newMapState = (): MapState => ({ col: new Map(), y: new Map(), colW: new Map() });
let mapState = newMapState();
let rearrange = false;
let partialSeen = false;
/** The method or function you last clicked; always drawn in a bright colour so you can find it. */
let activeId: string | null = null;
/** In the changes view: how many hops of callers / callees of the changed methods to show. */
let impactUp = 0;
let impactDown = 0;
let diffCommits: DiffCommit[] = [];
let diffSummary: GitStatusSummary | null = null;
let diffCommitsRequested = false;
/** Whether clicking a method also shows its inputs, output and types in the side panel. */
let sigOn = false;
let sigReq = 0;
let sigLast: { file: string; line: number; character: number; name: string } | null = null;
let sigCur: SignatureData | null = null;
let revealNext = false;
let currentRootKey = '';
const layoutMemory = new Map<
  string,
  {
    map: MapState;
    view: { tx: number; ty: number; k: number };
    flow: FlowStep[];
    flowFwd: FlowStep[];
    expanded: Set<string>;
    depth: number;
  }
>();

function colLeft(state: MapState, c: number): number {
  let x = 0;
  if (c > 0) {
    for (let j = 0; j < c; j++) x += (state.colW.get(j) ?? DEFAULT_COL_W) + GUTTER;
  } else {
    for (let j = c; j < 0; j++) x -= (state.colW.get(j) ?? DEFAULT_COL_W) + GUTTER;
  }
  return x;
}

/** Final top of each visible card: its canonical y, pushed down only as far as needed to clear the card above. */
function stackY(state: MapState, files: FileNode[], heights: Map<string, number>): Map<string, number> {
  const byCol = new Map<number, FileNode[]>();
  for (const f of files) {
    const c = state.col.get(f.id)!;
    (byCol.get(c) ?? byCol.set(c, []).get(c)!).push(f);
  }
  const out = new Map<string, number>();
  byCol.forEach((list) => {
    list.sort((a, b) => state.y.get(a.id)! - state.y.get(b.id)! || a.id.localeCompare(b.id));
    let bottom = -Infinity;
    for (const f of list) {
      const y = Math.max(state.y.get(f.id)!, bottom + GAP_Y);
      out.set(f.id, y);
      bottom = y + heights.get(f.id)!;
    }
  });
  return out;
}
let pinParent: string | undefined;
let resizeObs: ResizeObserver | null = null;

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

function group(edges: CallEdge[], key: (e: CallEdge) => string): Map<string, CallEdge[]> {
  const map = new Map<string, CallEdge[]>();
  for (const e of edges) {
    const k = key(e);
    (map.get(k) ?? map.set(k, []).get(k)!).push(e);
  }
  return map;
}

/**
 * Narrows the fetched graph to what should be on screen: hops from the roots
 * in the chosen direction, then (optionally) collapsed to file-to-file calls,
 * then (optionally) cut down to an isolated trace.
 */
function buildView(data: GraphData): View {
  const out = group(data.edges, (e) => e.source);
  const inn = group(data.edges, (e) => e.target);
  const size = pageSize();
  // Paging the root file narrows which methods the graph is drawn from, so only their relations show.
  let activeRoots = data.roots;
  let rootPage: PageInfo | undefined;
  if (mode === 'methods' && !data.rootSymbolId) {
    const rootSet = new Set(data.roots);
    const rootFile = data.files.find((f) => f.id === data.rootFileId);
    const pinned = pin && rootSet.has(pin.start) ? pin.start : undefined;
    const rest = (rootFile ? rootFile.symbols : []).filter((sym) => rootSet.has(sym.id) && sym.id !== pinned);
    if (rest.length > size) {
      const count = Math.ceil(rest.length / size);
      const page = Math.min(Math.max(pageOf.get(data.rootFileId) ?? 0, 0), count - 1);
      pageOf.set(data.rootFileId, page);
      const slice = rest.slice(page * size, (page + 1) * size);
      activeRoots = slice.map((sym) => sym.id).concat(pinned ? [pinned] : []);
      rootPage = { page, count, from: page * size + 1, to: page * size + slice.length, total: rest.length };
    }
  }

  const keep = new Set(activeRoots);
  const kept = new Set<CallEdge>();

  const walk = (adj: Map<string, CallEdge[]>, forward: boolean, limit: number) => {
    const seen = new Set(activeRoots);
    let frontier = [...activeRoots];
    for (let d = 0; d < limit && frontier.length > 0; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const e of adj.get(id) ?? []) {
          kept.add(e);
          const other = forward ? e.target : e.source;
          keep.add(other);
          if (!seen.has(other)) {
            seen.add(other);
            next.push(other);
          }
        }
      }
      frontier = next;
    }
  };
  if (data.diff) {
    // Changes view: only the changed methods, plus as many hops of impact as you ask for.
    walk(out, true, impactDown);
    walk(inn, false, impactUp);
  } else {
    if (show !== 'callers') walk(out, true, depth);
    if (show !== 'callees') walk(inn, false, depth);
  }
  // Calls between the roots themselves are always drawn.
  const rootSet = new Set(activeRoots);
  for (const e of data.edges) if (rootSet.has(e.source) && rootSet.has(e.target)) kept.add(e);

  // The pinned method's own hop range is added on top of the file-level view.
  let extras = false;
  if (pin && mode === 'methods') {
    const edgeMap = new Map(data.edges.map((e) => [e.id, e]));
    const r = reach(data, pin.start, pin.hops);
    r.hops.forEach((_, id) => {
      if (!keep.has(id)) {
        keep.add(id);
        extras = true;
      }
    });
    r.edges.forEach((id) => {
      const e = edgeMap.get(id);
      if (e) kept.add(e);
    });
  }

  let files: FileNode[] = data.files
    .map((f) => ({ ...f, symbols: f.symbols.filter((s) => keep.has(s.id)) }))
    .filter((f) => f.symbols.length > 0);
  let edges = [...kept];
  const counts = new Map<string, number>();
  const tips = new Map<string, string>();

  if (mode === 'services') {
    const fileOf = new Map<string, FileNode>();
    files.forEach((f) => f.symbols.forEach((s) => fileOf.set(s.id, f)));
    const agg = new Map<string, CallEdge>();
    for (const e of edges) {
      const a = fileOf.get(e.source);
      const b = fileOf.get(e.target);
      if (!a || !b || a.id === b.id) continue;
      const id = `s:${a.id}>${b.id}`;
      if (!agg.has(id)) agg.set(id, { id, source: a.id, target: b.id });
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    files = files.map((f) => {
      const names = f.symbols.map((s) => s.name);
      tips.set(f.id, names.slice(0, 15).join('\n') + (names.length > 15 ? `\n… +${names.length - 15} more` : ''));
      return {
        ...f,
        symbols: [
          {
            id: f.id,
            name: `${names.length} method${names.length === 1 ? '' : 's'}`,
            kind: 'method' as const,
            line: 0,
            character: 0,
          },
        ],
      };
    });
    edges = [...agg.values()];
  } else {
    const ids = new Set(files.flatMap((f) => f.symbols.map((s) => s.id)));
    edges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  }

  if (isolate) {
    const iso = isolate;
    files = files
      .map((f) => ({ ...f, symbols: f.symbols.filter((s) => iso.syms.has(s.id)) }))
      .filter((f) => f.symbols.length > 0);
    edges = edges.filter((e) => iso.edges.has(e.id));
  }

  const allFiles = files;
  const allEdges = edges;
  const pageInfo = new Map<string, PageInfo>();
  if (mode === 'methods') {
    const forced = new Set<string>();
    if (data.rootSymbolId) forced.add(data.rootSymbolId);
    if (pin) reach(data, pin.start, pin.hops).hops.forEach((_, id) => forced.add(id));
    if (isolate) isolate.syms.forEach((id) => forced.add(id));
    files = files.map((f) => {
      if (rootPage && f.id === data.rootFileId) return f;
      const rest = f.symbols.filter((sym) => !forced.has(sym.id));
      if (rest.length <= size) return f;
      const count = Math.ceil(rest.length / size);
      const page = Math.min(Math.max(pageOf.get(f.id) ?? 0, 0), count - 1);
      pageOf.set(f.id, page);
      const slice = rest.slice(page * size, (page + 1) * size);
      const visible = new Set(slice.map((sym) => sym.id));
      pageInfo.set(f.id, { page, count, from: page * size + 1, to: page * size + slice.length, total: rest.length });
      return { ...f, symbols: f.symbols.filter((sym) => forced.has(sym.id) || visible.has(sym.id)) };
    });
    if (rootPage) pageInfo.set(data.rootFileId, rootPage);
    const visibleIds = new Set(files.flatMap((f) => f.symbols.map((sym) => sym.id)));
    edges = edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));
  }

  return { files, edges, counts, tips, extras, allFiles, allEdges, pageInfo };
}

function subLabel(t: CallTarget, widthPx: number): { name: string; suffix: string } {
  const room = Math.max(4, Math.floor((widthPx - 74) / CHAR_W));
  let name = t.row.name;
  let suffix = t.cross ? ` · ${baseName(t.file.label)}` : '';
  if (name.length + suffix.length > room) {
    if (name.length > room) {
      name = name.slice(0, room - 1) + '…';
      suffix = '';
    } else {
      const left = room - name.length - 1;
      suffix = left > 2 ? suffix.slice(0, left) + '…' : '';
    }
  }
  return { name, suffix };
}

function crumbLabel(label: string): string {
  if (label.startsWith('Δ ')) return label;
  const [file, method] = label.split(' › ');
  const base = file.split('/').pop() ?? file;
  return method ? `${base} · ${method}` : base;
}

const CRUMB_WINDOW = 6;

/** Clickable trail of the roots visited (windowed around the current one), with this root's execution steps after it. */
function crumbsHtml(fallback: string): string {
  if (trail.length === 0) return `<span class="crumb cur">${escapeXml(crumbLabel(fallback))}</span>`;
  const inFlow = flowTrail.length > 1;
  const first = Math.min(Math.max(0, cursor - 3), Math.max(0, trail.length - CRUMB_WINDOW));
  const last = Math.min(trail.length, first + CRUMB_WINDOW);
  const parts: string[] = first > 0 ? ['<span class="crumb-more">…</span>'] : [];
  for (let i = first; i < last; i++) {
    const label = trail[i];
    if (i > first || first > 0) parts.push('<span class="crumb-sep">→</span>');
    const isRoot = i === cursor;
    const cls = isRoot ? (inFlow ? ' root-crumb' : ' cur') : '';
    const tip = isRoot && inFlow ? `${label}: click to clear the steps and return to it` : label;
    parts.push(`<span class="crumb${cls}" data-i="${i}" title="${escapeAttr(tip)}">${escapeXml(crumbLabel(label))}</span>`);
    if (isRoot && inFlow) {
      flowTrail.forEach((step) => {
        parts.push('<span class="crumb-sep">›</span>');
        const isCur = step.symId === activeId;
        parts.push(
          `<span class="crumb flow-crumb${isCur ? ' cur' : ''}" data-sym="${escapeAttr(step.symId)}" title="${escapeAttr(step.file)}:${step.line + 1}">${escapeXml(step.name)}</span>`
        );
      });
    }
  }
  if (last < trail.length) parts.push('<span class="crumb-more">…</span>');
  return parts.join('');
}

/** Options for the changes-source picker; the current source is selected and recent commits are listed. */
function diffSourceOptions(data: GraphData): string {
  const current = data.diff?.source ?? '';
  const opt = (value: string, label: string, disabled = false) =>
    `<option value="${escapeAttr(value)}"${value === current ? ' selected' : ''}${disabled && value !== current ? ' disabled' : ''}>${escapeXml(label)}</option>`;

  const commitOpts = diffCommits.map((c) => opt(`commit:${c.sha}`, `${c.sha}  ${c.subject}`)).join('');
  const knownCommit = diffCommits.some((c) => `commit:${c.sha}` === current);
  const extra = current.startsWith('commit:') && !knownCommit ? opt(current, `Commit ${current.slice(7)}`) : '';

  const s = diffSummary;
  const uncommittedLabel = s ? `Uncommitted (${s.uncommittedCount})` : 'Uncommitted (all)';
  const unstagedLabel = s ? `Unstaged (${s.unstagedCount})` : 'Unstaged';
  const stagedLabel = s ? `Staged (${s.stagedCount})` : 'Staged';
  const branchLabel = s
    ? s.hasHead
      ? `This branch vs ${s.baseBranch ?? 'main'} (${s.branchCount})`
      : 'This branch (no commits yet)'
    : 'This branch vs main / origin';

  return (
    `<option value=""${current ? '' : ' selected'}>Changes…</option>` +
    opt('uncommitted', uncommittedLabel, s !== null && s.uncommittedCount === 0) +
    opt('unstaged', unstagedLabel, s !== null && s.unstagedCount === 0) +
    opt('staged', stagedLabel, s !== null && s.stagedCount === 0) +
    opt('branch', branchLabel, s !== null && (!s.hasHead || s.branchCount === 0)) +
    extra +
    `<optgroup id="commits" label="Recent commits">${commitOpts || '<option disabled>no commits available</option>'}</optgroup>` +
    (data.diff ? '<option value="__exit">← Leave the changes view</option>' : '')
  );
}

function renderMessage(text: string) {
  hopCtl.hidden = true;
  main.innerHTML = `<div style="padding:16px;color:var(--vscode-descriptionForeground);font-family:var(--vscode-font-family);">${escapeXml(text)}</div>`;
}

async function renderGraph(data: GraphData) {
  const seq = ++renderSeq;
  currentData = data;
  const { files, edges, counts, tips, extras, allFiles, allEdges, pageInfo } = buildView(data);
  const isServices = mode === 'services';

  if (data.files.length === 0 && !data.diff) {
    renderMessage('No functions or methods found (the language server may still be starting — try Refresh).');
    return;
  }

  const symInfo = new Map<string, { row: SymbolRow; file: FileNode; index: number }>();
  for (const file of files) {
    file.symbols.forEach((row, index) => symInfo.set(row.id, { row, file, index }));
  }

  const symInfoAll = new Map<string, { row: SymbolRow; file: FileNode; index: number }>();
  for (const file of allFiles) {
    file.symbols.forEach((row, index) => symInfoAll.set(row.id, { row, file, index }));
  }
  latestSymInfoAll = symInfoAll;

  const edgeById = new Map(edges.map((e) => [e.id, e]));
  const outAdj = group(edges, (e) => e.source);
  const inAdj = group(edges, (e) => e.target);
  const callsOf = new Map<string, CallTarget[]>();
  const crossEdges: CallEdge[] = [];
  const usedOut = new Set<string>();
  const usedIn = new Set<string>();

  if (!isServices) {
    for (const e of allEdges) {
      const from = symInfoAll.get(e.source);
      const to = symInfoAll.get(e.target);
      if (!from || !to) continue;
      (callsOf.get(e.source) ?? callsOf.set(e.source, []).get(e.source)!).push({
        row: to.row,
        file: to.file,
        cross: from.file.id !== to.file.id,
      });
    }
  }
  for (const e of edges) {
    const from = symInfo.get(e.source);
    const to = symInfo.get(e.target);
    if (!from || !to) continue;
    if (from.file.id !== to.file.id) {
      crossEdges.push(e);
      usedOut.add(e.source);
      usedIn.add(e.target);
    }
  }
  callsOf.forEach((list) =>
    list.sort((a, b) => Number(a.cross) - Number(b.cross) || a.row.name.localeCompare(b.row.name))
  );

  const geoms = new Map<string, RowGeom[]>();
  const heights = new Map<string, number>();
  const widths = new Map<string, number>();
  for (const file of files) {
    let top = HEADER_H;
    let widest = baseName(file.label).length + 2 + (pageInfo.has(file.id) ? 18 : 0);
    const list: RowGeom[] = file.symbols.map((row) => {
      const all = expanded.has(row.id) ? callsOf.get(row.id) ?? [] : [];
      const showAll = subAll.has(row.id);
      const calls = showAll ? all : all.slice(0, SUB_MAX);
      const more = all.length - calls.length;
      const fold = showAll && all.length > SUB_MAX;
      const geom = { top, calls, more, fold };
      top += ROW_H + (calls.length + (more > 0 || fold ? 1 : 0)) * SUB_H;
      widest = Math.max(widest, row.name.length + 7);
      for (const t of calls) {
        widest = Math.max(widest, t.row.name.length + (t.cross ? 3 + baseName(t.file.label).length : 0) + 9);
      }
      return geom;
    });
    geoms.set(file.id, list);
    heights.set(file.id, top + CARD_PAD_BOTTOM);
    widths.set(file.id, Math.max(MIN_W, Math.min(MAX_W, widest * CHAR_W + 44)));
  }

  // ---- Stable map: ELK arranges the first time (or on Re-arrange); after that positions never move by themselves.
  const state = mapState;
  let layoutMs = 0;
  if (files.length > 0 && (state.col.size === 0 || rearrange)) {
    const elkGraph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.edgeRouting': 'POLYLINE',
        'elk.spacing.nodeNode': '36',
        'elk.layered.spacing.nodeNodeBetweenLayers': String(GUTTER),
        'elk.layered.nodePlacement.strategy': files.length > 25 ? 'BRANDES_KOEPF' : 'NETWORK_SIMPLEX',
        'elk.layered.thoroughness': files.length > 25 ? '3' : '7',
      },
      children: files.map((file) => {
        const w = widths.get(file.id)!;
        const ports: object[] = [];
        file.symbols.forEach((row, i) => {
          const cy = geoms.get(file.id)![i].top + ROW_H / 2;
          if (usedOut.has(row.id)) {
            ports.push({ id: `${row.id}|out`, x: w, y: cy, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'EAST' } });
          }
          if (usedIn.has(row.id)) {
            ports.push({ id: `${row.id}|in`, x: 0, y: cy, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'WEST' } });
          }
        });
        return { id: file.id, width: w, height: heights.get(file.id)!, ports, layoutOptions: { 'elk.portConstraints': 'FIXED_POS' } };
      }),
      edges: crossEdges.map((e) => ({ id: e.id, sources: [`${e.source}|out`], targets: [`${e.target}|in`] })),
    };
    const layoutKey = JSON.stringify([
      files.length > 25,
      elkGraph.children.map((c) => [c.id, c.width, c.height, (c.ports as Array<{ id: string; y: number }>).map((pt) => `${pt.id}@${pt.y}`)]),
      elkGraph.edges.map((e) => e.id),
    ]);
    let layout = layoutCache.get(layoutKey);
    if (!layout) {
      const t0 = performance.now();
      layout = (await elk.layout(elkGraph as unknown as ElkNode)) as ElkNode;
      layoutMs = Math.round(performance.now() - t0);
      layoutCache.set(layoutKey, layout);
      if (layoutCache.size > 12) layoutCache.delete(layoutCache.keys().next().value as string);
    }
    if (seq !== renderSeq) return;

    state.col.clear();
    state.y.clear();
    state.colW.clear();
    // Cards in one layer overlap horizontally and different layers never do, so overlap groups are the columns.
    const arranged = (layout.children ?? [])
      .map((c) => ({ id: c.id!, x: c.x ?? 0, y: c.y ?? 0, w: c.width ?? MIN_W }))
      .sort((p, q) => p.x - q.x);
    let layer = -1;
    let right = -Infinity;
    for (const n of arranged) {
      if (n.x >= right - 1) {
        layer++;
        right = n.x + n.w;
      } else {
        right = Math.max(right, n.x + n.w);
      }
      state.col.set(n.id, layer);
      state.y.set(n.id, n.y);
    }
    rearrange = false;
  } else {
    // New cards go next to whatever they connect to; nothing already placed moves.
    const fileOfSym = new Map<string, string>();
    for (const f of data.files) for (const sym of f.symbols) fileOfSym.set(sym.id, f.id);
    const nbrs = new Map<string, Array<{ file: string; delta: number }>>();
    const addNbr = (from: string, file: string, delta: number) =>
      (nbrs.get(from) ?? nbrs.set(from, []).get(from)!).push({ file, delta });
    for (const e of data.edges) {
      const a = fileOfSym.get(e.source);
      const b = fileOfSym.get(e.target);
      if (!a || !b || a === b) continue;
      addNbr(a, b, -1); // a calls b, so a sits left of b
      addNbr(b, a, 1);
    }
    const missing = files.filter((f) => !state.col.has(f.id));
    let progress = true;
    while (missing.length > 0 && progress) {
      progress = false;
      for (let i = 0; i < missing.length; i++) {
        const f = missing[i];
        const placed = (nbrs.get(f.id) ?? []).filter((n) => state.col.has(n.file));
        if (placed.length === 0) continue;
        const votes = new Map<number, number>();
        for (const n of placed) {
          const c = state.col.get(n.file)! + n.delta;
          votes.set(c, (votes.get(c) ?? 0) + 1);
        }
        const col = [...votes.entries()].sort((p, q) => q[1] - p[1] || Math.abs(p[0]) - Math.abs(q[0]))[0][0];
        state.col.set(f.id, col);
        state.y.set(f.id, placed.reduce((sum, n) => sum + (state.y.get(n.file) ?? 0), 0) / placed.length);
        missing.splice(i, 1);
        i--;
        progress = true;
      }
    }
    const rootCol = state.col.get(data.rootFileId) ?? 0;
    for (const f of missing) {
      let bottom = 0;
      state.col.forEach((c, id) => {
        if (c === rootCol) bottom = Math.max(bottom, (state.y.get(id) ?? 0) + (heights.get(id) ?? 200) + GAP_Y);
      });
      state.col.set(f.id, rootCol);
      state.y.set(f.id, bottom);
    }
  }

  for (const f of files) {
    const c = state.col.get(f.id)!;
    state.colW.set(c, Math.max(state.colW.get(c) ?? 0, widths.get(f.id)!));
  }
  const yFinal = stackY(state, files, heights);
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const f of files) {
    boxes.set(f.id, { x: colLeft(state, state.col.get(f.id)!), y: yFinal.get(f.id)!, w: widths.get(f.id)!, h: heights.get(f.id)! });
  }

  const posNow = new Map<string, { x: number; y: number }>();
  for (const file of files) {
    const b = boxes.get(file.id)!;
    posNow.set(`card:${file.id}`, { x: b.x, y: b.y });
    file.symbols.forEach((row, i) => posNow.set(`row:${row.id}`, { x: b.x, y: b.y + geoms.get(file.id)![i].top }));
  }
  const resetView = refit;
  // Positions are absolute now, so if something you clicked did shift (a card above it grew), pan the camera to follow it.
  if (!resetView) {
    for (const key of [...anchorKeys, `card:${data.rootFileId}`]) {
      const before = prevPos.get(key);
      const now = posNow.get(key);
      if (before && now) {
        view.tx -= (now.x - before.x) * view.k;
        view.ty -= (now.y - before.y) * view.k;
        break;
      }
    }
  }
  anchorKeys = [];
  const origin = { x: 0, y: 0 };
  const animate = !resetView && prevPos.size > 0;

  // ---- Edges: right-angled routes that live in the gutters between columns; an edge that spans columns
  // crosses them only through a gap between cards, so lines never run over a card.
  const eastDots = new Set<string>();
  const westDots = new Set<string>();
  const colIntervals = new Map<number, Array<[number, number]>>();
  boxes.forEach((b, fid) => {
    const c = state.col.get(fid)!;
    (colIntervals.get(c) ?? colIntervals.set(c, []).get(c)!).push([b.y, b.y + b.h]);
  });
  const gutterStart = (g: number) => colLeft(state, g) + (state.colW.get(g) ?? DEFAULT_COL_W);

  /** A y that is free of cards in every column in `cols`, as close to `pref` as possible. */
  const pickChannel = (cols: number[], pref: number): number => {
    const blocked: Array<[number, number]> = [];
    for (const c of cols) for (const iv of colIntervals.get(c) ?? []) blocked.push([iv[0], iv[1]]);
    if (blocked.length === 0) return pref;
    blocked.sort((p, q) => p[0] - q[0]);
    const merged: Array<[number, number]> = [];
    for (const iv of blocked) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1] + 12) last[1] = Math.max(last[1], iv[1]);
      else merged.push([iv[0], iv[1]]);
    }
    if (!merged.some((iv) => pref >= iv[0] - 6 && pref <= iv[1] + 6)) return pref;
    const candidates = [merged[0][0] - 16, merged[merged.length - 1][1] + 16];
    for (let i = 0; i + 1 < merged.length; i++) {
      if (merged[i + 1][0] - merged[i][1] >= 20) candidates.push((merged[i][1] + merged[i + 1][0]) / 2);
    }
    return candidates.reduce((best, y) => (Math.abs(y - pref) < Math.abs(best - pref) ? y : best));
  };

  interface Planned {
    e: CallEdge;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    gA: number;
    gB: number;
    long: boolean;
    ya: number;
  }
  const planned: Planned[] = [];
  for (const e of edges) {
    const from = symInfo.get(e.source);
    const to = symInfo.get(e.target);
    if (!from || !to) continue;
    if (from.file.id === to.file.id) continue;
    const ba = boxes.get(from.file.id);
    const bb = boxes.get(to.file.id);
    if (!ba || !bb) continue;
    const ca = state.col.get(from.file.id);
    const cb = state.col.get(to.file.id);
    if (ca === undefined || cb === undefined) continue;
    const y1 = ba.y + geoms.get(from.file.id)![from.index].top + ROW_H / 2;
    const y2 = bb.y + geoms.get(to.file.id)![to.index].top + ROW_H / 2;
    const plan: Planned = { e, x1: 0, y1, x2: 0, y2, gA: ca, gB: ca, long: false, ya: y1 };
    if (ca < cb) {
      plan.x1 = ba.x + ba.w;
      plan.x2 = bb.x;
      plan.gA = ca;
      plan.gB = cb - 1;
      plan.long = cb - ca > 1;
      if (plan.long) plan.ya = pickChannel(Array.from({ length: cb - ca - 1 }, (_, i) => ca + 1 + i), y1);
      eastDots.add(e.source);
      westDots.add(e.target);
    } else if (ca > cb) {
      plan.x1 = ba.x;
      plan.x2 = bb.x + bb.w;
      plan.gA = ca - 1;
      plan.gB = cb;
      plan.long = ca - cb > 1;
      if (plan.long) plan.ya = pickChannel(Array.from({ length: ca - cb - 1 }, (_, i) => cb + 1 + i), y1);
      westDots.add(e.source);
      eastDots.add(e.target);
    } else {
      plan.x1 = ba.x + ba.w;
      plan.x2 = bb.x + bb.w;
      eastDots.add(e.source);
      eastDots.add(e.target);
    }
    planned.push(plan);
  }

  // Give edges that share a gutter their own vertical lane whenever their vertical runs would overlap.
  const perGutter = new Map<number, Array<{ key: string; y0: number; y1: number }>>();
  const addRun = (g: number, key: string, ya: number, yb: number) =>
    (perGutter.get(g) ?? perGutter.set(g, []).get(g)!).push({ key, y0: Math.min(ya, yb), y1: Math.max(ya, yb) });
  for (const p of planned) {
    if (p.long) {
      addRun(p.gA, `${p.e.id}:A`, p.y1, p.ya);
      addRun(p.gB, `${p.e.id}:B`, p.ya, p.y2);
    } else {
      addRun(p.gA, `${p.e.id}:A`, p.y1, p.y2);
    }
  }
  const laneX = new Map<string, number>();
  perGutter.forEach((items, g) => {
    items.sort((p, q) => p.y0 - q.y0 || p.y1 - q.y1);
    const ends: number[] = [];
    const laneOf = new Map<string, number>();
    for (const it of items) {
      let l = ends.findIndex((end) => end + 6 < it.y0);
      if (l < 0) {
        l = ends.length;
        ends.push(it.y1);
      } else {
        ends[l] = it.y1;
      }
      laneOf.set(it.key, l);
    }
    const spacing = ends.length > 1 ? Math.min(10, (GUTTER - 28) / (ends.length - 1)) : 0;
    const x0 = gutterStart(g) + 14;
    laneOf.forEach((l, key) => laneX.set(key, x0 + l * spacing));
  });

  const edgeParts: string[] = [];
  const topParts: string[] = [];
  for (const p of planned) {
    const la = laneX.get(`${p.e.id}:A`)!;
    const pts: Point[] = p.long
      ? [
          { x: p.x1, y: p.y1 },
          { x: la, y: p.y1 },
          { x: la, y: p.ya },
          { x: laneX.get(`${p.e.id}:B`)!, y: p.ya },
          { x: laneX.get(`${p.e.id}:B`)!, y: p.y2 },
          { x: p.x2, y: p.y2 },
        ]
      : [
          { x: p.x1, y: p.y1 },
          { x: la, y: p.y1 },
          { x: la, y: p.y2 },
          { x: p.x2, y: p.y2 },
        ];
    const d = roundedPath(pts, EDGE_CORNER);
    const count = counts.get(p.e.id);
    let label = '';
    if (count !== undefined) {
      const mid = midpoint(pts);
      const text = String(count);
      const pillW = 12 + text.length * 6;
      label = `<g class="elabel" transform="translate(${mid.x},${mid.y})"><rect x="${-pillW / 2}" y="-8" width="${pillW}" height="16" rx="8" /><text y="4" text-anchor="middle">${text}</text></g>`;
    }
    edgeParts.push(
      `<g class="edge" data-id="${escapeAttr(p.e.id)}"><path class="hit" d="${d}" /><path class="line" d="${d}" />${label}</g>`
    );
    topParts.push(`<path class="topline" data-id="${escapeAttr(p.e.id)}" d="${d}" />`);
  }

  const cardParts: string[] = [];
  files.forEach((file, fi) => {
    const box = boxes.get(file.id);
    if (!box) return;
    const { x, y, w, h } = box;
    const isRoot = file.id === data.rootFileId;
    const fileChanges = data.diff ? file.symbols.map((sym) => data.diff!.changes[sym.id]).filter(Boolean) : [];
    const headerFill =
      fileChanges.length > 0
        ? fileChanges.every((c) => c.kind === 'added')
          ? '#2f7a45'
          : '#9a6b16'
        : isRoot
          ? 'var(--vscode-button-background,#0e639c)'
          : '#3f6591';
    const headerText = isRoot ? 'var(--vscode-button-foreground,#fff)' : '#fff';
    const pg = pageInfo.get(file.id);
    let pager = '';
    let titleRoom = w - 24;
    if (pg) {
      const label = `${pg.from}–${pg.to} / ${pg.total}`;
      const lw = Math.ceil(label.length * 6.2);
      const nextX = w - 28;
      const labelRight = nextX - 4;
      const prevX = labelRight - lw - 4 - 20;
      titleRoom = prevX - 20;
      const fid = escapeAttr(file.id);
      const btn = (x: number, dir: number, glyph: string, disabled: boolean) =>
        `<g class="pg-btn${disabled ? ' dis' : ''}" data-file="${fid}" data-dir="${dir}"><rect x="${x}" y="4" width="20" height="20" rx="4" /><text x="${x + 10}" y="19" text-anchor="middle">${glyph}</text></g>`;
      pager = `<g class="pager">${btn(prevX, -1, '‹', pg.page === 0)}<text class="pg-label" x="${labelRight - lw / 2}" y="18" text-anchor="middle">${label}</text>${btn(nextX, 1, '›', pg.page >= pg.count - 1)}</g>`;
    }
    const title = escapeXml(truncate(baseName(file.label), titleRoom));

    const rows = file.symbols
      .map((row, i) => {
        const geom = geoms.get(file.id)![i];
        const total = (callsOf.get(row.id) ?? []).length;
        const isOpen = geom.calls.length > 0;
        const isRootRow = !isServices && row.id === data.rootSymbolId;
        const change = !isServices ? data.diff?.changes[row.id] : undefined;
        const chipFill = row.kind === 'method' ? 'var(--vscode-charts-blue,#3794ff)' : 'var(--vscode-charts-green,#89d185)';
        const chip = isServices
          ? `<rect x="23" y="${ROW_H / 2 - 7}" width="14" height="14" rx="3" fill="#6b7280" /><text x="30" y="${ROW_H / 2 + 3}" font-size="10" font-weight="700" text-anchor="middle" fill="#fff">≡</text>`
          : `<circle cx="30" cy="${ROW_H / 2}" r="7" fill="${chipFill}" /><text x="30" y="${ROW_H / 2 + 3}" font-size="9" font-weight="700" text-anchor="middle" fill="#111">${row.kind === 'method' ? 'm' : 'f'}</text>`;
        const west = westDots.has(row.id) ? `<circle class="port" cx="0" cy="${ROW_H / 2}" r="3" />` : '';
        const east = eastDots.has(row.id) ? `<circle class="port" cx="${w}" cy="${ROW_H / 2}" r="3" />` : '';
        const chevron =
          total > 0
            ? `<g class="chev" data-sym="${escapeAttr(row.id)}"><rect x="0" y="0" width="22" height="${ROW_H}" fill="transparent" /><text x="11" y="${ROW_H / 2 + 3.5}" text-anchor="middle">${isOpen ? '▾' : '▸'}</text></g>`
            : '';
        const badge =
          total > 0 && !isOpen ? `<text class="badge" x="${w - 24}" y="${ROW_H / 2 + 3.5}" text-anchor="end">${total}</text>` : '';
        const addBtn = isServices
          ? ''
          : `<g class="row-add-btn" data-sym="${escapeAttr(row.id)}" title="Add to AI Context"><rect x="${w - 20}" y="3" width="16" height="16" rx="3" /><text x="${w - 12}" y="${ROW_H / 2 + 3.5}" text-anchor="middle">+</text></g>`;
        const tip = isServices
          ? tips.get(file.id) ?? row.name
          : change
            ? `${row.name} — ${change.kind === 'added' ? 'new' : 'modified'}, ${change.lines} line${change.lines === 1 ? '' : 's'} changed (line ${row.line + 1})`
            : `${row.name}  (line ${row.line + 1})`;

        const mainRow = `<g class="row${isRootRow ? ' isroot' : ''}${change ? ` changed ${change.kind}` : ''}" data-sym="${escapeAttr(row.id)}" transform="translate(0,${geom.top})">
          <rect class="rowbg" width="${w}" height="${ROW_H}" />
          ${isRootRow ? `<rect class="rootbar" width="3" height="${ROW_H}" />` : ''}
          ${change ? `<rect class="changebar" width="4" height="${ROW_H}" />` : ''}
          <rect class="activebar" width="4" height="${ROW_H}" />
          ${chip}
          <text class="rname" x="44" y="${ROW_H / 2 + 4}">${escapeXml(truncate(row.name, w - 74))}</text>
          <title>${escapeXml(tip)}</title>
          <g class="hopchip"><circle class="hopcircle" cx="${w - 14}" cy="${ROW_H / 2}" r="8" /><text class="hoptext" x="${w - 14}" y="${ROW_H / 2 + 3.5}" text-anchor="middle"></text></g>
          ${chevron}${badge}${addBtn}${west}${east}
        </g>`;

        const subRows = geom.calls
          .map((t, j) => {
            const last = j === geom.calls.length - 1 && !(geom.more > 0 || geom.fold);
            const { name, suffix } = subLabel(t, w - 24);
            const dot = t.row.kind === 'method' ? 'var(--vscode-charts-blue,#3794ff)' : 'var(--vscode-charts-green,#89d185)';
            const tree = last ? `M30 0 V${SUB_H / 2} H40` : `M30 0 V${SUB_H} M30 ${SUB_H / 2} H40`;
            const subAdd = isServices
              ? ''
              : `<g class="sub-add-btn" data-target="${escapeAttr(t.row.id)}" data-parent="${escapeAttr(row.id)}" title="Add to AI Context"><rect x="${w - 20}" y="2" width="16" height="16" rx="3" /><text x="${w - 12}" y="${SUB_H / 2 + 3.5}" text-anchor="middle">+</text></g>`;
            return `<g class="sub" data-target="${escapeAttr(t.row.id)}" data-parent="${escapeAttr(row.id)}" transform="translate(0,${geom.top + ROW_H + j * SUB_H})">
              <rect class="rowbg" width="${w}" height="${SUB_H}" />
              <rect class="activebar" width="4" height="${SUB_H}" />
              <path class="tree" d="${tree}" />
              <circle cx="47" cy="${SUB_H / 2}" r="3.5" fill="${dot}" />
              <text class="sname" x="56" y="${SUB_H / 2 + 4}">${escapeXml(name)}<tspan class="sfile">${escapeXml(suffix)}</tspan></text>
              <title>${escapeXml(t.row.name)} — ${escapeXml(t.file.label)}:${t.row.line + 1}</title>
              ${subAdd}
            </g>`;
          })
          .join('\n');

        const tail =
          geom.more > 0 || geom.fold
            ? `<g class="submore" data-sym="${escapeAttr(row.id)}" transform="translate(0,${geom.top + ROW_H + geom.calls.length * SUB_H})">
              <rect class="rowbg" width="${w}" height="${SUB_H}" />
              <path class="tree" d="M30 0 V${SUB_H / 2} H40" />
              <text class="smore" x="56" y="${SUB_H / 2 + 4}">${geom.more > 0 ? `+${geom.more} more…` : 'show fewer'}</text>
            </g>`
            : '';

        return mainRow + subRows + tail;
      })
      .join('\n');

    cardParts.push(`
      <g class="card" data-file="${escapeAttr(file.id)}" style="transform:translate(${x}px,${y}px)" filter="url(#cardShadow)">
        <clipPath id="clip-${fi}"><rect width="${w}" height="${h}" rx="${CORNER}" /></clipPath>
        <g clip-path="url(#clip-${fi})">
          <rect width="${w}" height="${h}" fill="var(--vscode-editorWidget-background,#252526)" />
          <g class="card-header" data-file="${escapeAttr(file.id)}">
            <rect width="${w}" height="${HEADER_H}" fill="${headerFill}" />
            <text x="12" y="18" font-size="12" font-weight="600" fill="${headerText}">${title}</text>
            <title>${escapeXml(file.label)}</title>
          </g>
          ${pager}
        </g>
        <rect class="cardborder" width="${w}" height="${h}" rx="${CORNER}" fill="none" stroke="var(--vscode-widget-border,rgba(255,255,255,.12))" />
        ${rows}
      </g>`);
  });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  boxes.forEach((b) => {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  });
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 240;
    maxY = 120;
  }
  const boundsPad = CANVAS_PAD + 16;
  const bounds = { x: minX - boundsPad, y: minY - boundsPad, w: maxX - minX + boundsPad * 2, h: maxY - minY + boundsPad * 2 };
  const baseHint = data.diff ? HINT_DIFF : isServices ? HINT_SERVICES : HINT_METHODS;
  const hint = edges.length === 0 && !data.diff && !data.notice ? 'No calls in view — try Callers + callees, or Refresh if the language server is still loading.' : baseHint;
  const sel = (cond: boolean) => (cond ? ' selected' : '');

  main.innerHTML = `
    <div id="wrap">
      <div id="toolbar">
        <div class="tb-cluster left">
          <div class="tb-group">
            <button id="back" class="tb-btn tb-icon-btn"${cursor <= 0 ? ' disabled' : ''} title="Back: return to the previous view (Alt+←)">${ICONS.back}</button>
            <button id="fwd" class="tb-btn tb-icon-btn"${cursor >= trail.length - 1 ? ' disabled' : ''} title="Forward: undo a Back (Alt+→)">${ICONS.fwd}</button>
          </div>
          <nav id="crumbs" title="Where you've been, oldest first. Click a step to jump back to it.">${crumbsHtml(data.rootLabel)}</nav>
        </div>
        <div class="tb-cluster">
          <div class="tb-select-wrap" title="Look at what changed in git instead of a file">
            <span class="tb-label-icon" title="Changes">${ICONS.diff}</span>
            <select id="diffsrc" title="Choose what to compare. Pick “Leave the changes view” to go back.">${diffSourceOptions(data)}</select>
          </div>
          <div class="tb-select-wrap" title="View mode: Methods (each row is a method) or Services (one box per file)">
            <span class="tb-label-icon" title="Mode">${ICONS.mode}</span>
            <select id="mode" title="View mode">
              <option value="methods"${sel(mode === 'methods')}>Methods</option>
              <option value="services"${sel(mode === 'services')}>Services</option>
            </select>
          </div>
          ${
            data.diff
              ? `<div class="tb-select-wrap" title="Also show methods that call the changed ones (callers)"><span class="tb-sublabel">Callers</span>
            <select id="impactup">${[0, 1, 2, 3].map((n) => `<option value="${n}"${sel(impactUp === n)}>${n === 0 ? 'none' : `${n} hop${n === 1 ? '' : 's'}`}</option>`).join('')}</select></div>
          <div class="tb-select-wrap" title="Also show what the changed methods call (callees)"><span class="tb-sublabel">Callees</span>
            <select id="impactdown">${[0, 1].map((n) => `<option value="${n}"${sel(impactDown === n)}>${n === 0 ? 'none' : '1 hop'}</option>`).join('')}</select></div>`
              : `<div class="tb-select-wrap" title="Which relations to draw: callers, callees, or both">
            <select id="show" title="Show relations">
              <option value="both"${sel(show === 'both')}>Both</option>
              <option value="callers"${sel(show === 'callers')}>Callers only</option>
              <option value="callees"${sel(show === 'callees')}>Callees only</option>
            </select></div>`
          }
        </div>
        <div class="tb-cluster right">
          <div class="tb-group" title="Zoom. Pinch or ⌘/Ctrl+scroll to zoom, drag or two-finger scroll to move.">
            <button id="zout" class="tb-btn tb-icon-btn" title="Zoom out (−)">${ICONS.zoomOut}</button>
            <span id="zlabel">100%</span>
            <button id="zin" class="tb-btn tb-icon-btn" title="Zoom in (+)">${ICONS.zoomIn}</button>
            <button id="zfit" class="tb-btn tb-icon-btn" title="Fit graph in view (0)">${ICONS.fit}</button>
          </div>
          <button id="rearrange" class="tb-btn tb-icon-btn" title="Tidy layout: re-run automatic graph placement">${ICONS.tidy}</button>
          <button id="isolate" class="tb-btn tb-icon-btn${isolate ? ' on' : ''}" hidden title="${isolate ? 'Show all: bring back hidden calls (Esc)' : 'Isolate: hide everything except traced path'}">${ICONS.isolate}</button>
          <button id="sigbtn" class="tb-btn tb-icon-btn${dockOpen && activeDockTab === 'sig' ? ' on' : ''}" title="Signature Inspector: inputs, output and types (Alt+S)">${ICONS.signature}</button>
          <button id="ctxbtn" class="tb-btn${dockOpen && activeDockTab === 'bucket' ? ' on' : ''}" title="AI Context: Curate methods for LLM (Alt+C)">
            ${ICONS.robot}
            <span id="ctxbtn-badge" class="tb-badge"${currentBucketSummary && currentBucketSummary.items.length > 0 ? '' : ' hidden'}>${currentBucketSummary?.items.length ?? 0}</span>
          </button>
          <button id="refresh" class="tb-btn tb-icon-btn" title="Reload: refresh graph from language server">${ICONS.refresh}</button>
          <button id="helpbtn" class="tb-btn tb-icon-btn round" title="Help & shortcuts (?)">${ICONS.help}</button>
        </div>
      </div>
      <div id="legend" hidden>
        <div class="lg">
          <h4>Toolbar & Actions</h4>
          <div class="row2"><span class="lg-icon">${ICONS.back}</span><span><b>Back / Forward</b> (<kbd>Alt</kbd>+<kbd>←</kbd> / <kbd>→</kbd>): Navigate previous views</span></div>
          <div class="row2"><span class="lg-icon">${ICONS.diff}</span><span><b>Changes</b>: Switch between active file & git diff comparisons</span></div>
          <div class="row2"><span class="lg-icon">${ICONS.mode}</span><span><b>View Mode</b>: <b>Methods</b> (detailed call graph) or <b>Services</b> (file-level)</span></div>
          <div class="row2"><span class="lg-icon">${ICONS.fit}</span><span><b>Zoom & Fit</b> (<kbd>0</kbd>): Zoom in/out, fit entire graph in view</span></div>
          <div class="row2"><span class="lg-icon">${ICONS.tidy}</span><span><b>Tidy</b>: Re-run automatic graph placement</span></div>
          <div class="row2"><span class="lg-icon">${ICONS.isolate}</span><span><b>Isolate</b> (<kbd>Esc</kbd> to clear): Focus only on the traced call path</span></div>
          <div class="row2"><span class="lg-icon">${ICONS.signature}</span><span><b>Signature</b> (<kbd>Alt</kbd>+<kbd>S</kbd>): Inspect parameters, return types & TypeScript definitions</span></div>
          <div class="row2"><span class="lg-icon">${ICONS.robot}</span><span><b>AI Context</b> (<kbd>Alt</kbd>+<kbd>C</kbd>): Curate methods & export compressed context for LLM</span></div>
          <div class="row2"><span class="lg-icon">${ICONS.refresh}</span><span><b>Reload</b>: Refresh code analysis from language server</span></div>
        </div>
        <div class="lg">
          <h4>Visual Legend</h4>
          <div class="row2"><span class="sw" style="background:#e2c541"></span><span><b>Gold highlight</b>: Currently selected method (<kbd>F</kbd> centers it)</span></div>
          <div class="row2"><span class="sw dot" style="background:#3794ff"></span><span><b>Blue dot / lines</b>: <b>Callees</b> (methods this calls; number = distance)</span></div>
          <div class="row2"><span class="sw dot" style="background:#d18616"></span><span><b>Orange dot / lines</b>: <b>Callers</b> (methods calling this; number = distance)</span></div>
          <div class="row2"><span class="sw" style="background:#9a6b16"></span><span><b>Amber bar</b>: Modified symbol in git changes</span></div>
          <div class="row2"><span class="sw" style="background:#2f7a45"></span><span><b>Green bar</b>: Newly added symbol in git changes</span></div>
          <div class="row2"><span>▸</span><span>Expands nested calls; grey badge indicates total direct callees</span></div>
        </div>
        <div class="lg">
          <h4>Navigation & Shortcuts</h4>
          <div style="margin-bottom:4px;"><kbd>→</kbd> / <kbd>Enter</kbd> <b>Step into callees</b> (downstream flow)</div>
          <div style="margin-bottom:4px;"><kbd>←</kbd> <b>Step into callers</b> (upstream origin)</div>
          <div style="margin-bottom:4px;"><kbd>↑</kbd> / <kbd>↓</kbd> <b>Step sibling methods</b> in active file</div>
          <div style="margin-bottom:4px;"><kbd>Space</kbd> Open in editor · <kbd>F</kbd> Center active method</div>
          <div style="margin-bottom:4px;"><kbd>/</kbd> Search files & symbols · <kbd>Esc</kbd> Clear selection</div>
          <div><b>Double-click</b> to re-root · <b>Hops slider</b> controls connection depth.</div>
        </div>
      </div>
      <div id="statusbar">${
        data.diff
          ? `<span class="dsum">${escapeXml(data.diff.summary)}</span>${data.diff.approximate ? '<span class="warn" title="The code changed since this commit, so some method positions are estimated.">positions estimated</span>' : ''}${data.diff.other.length ? `<button id="otherbtn" class="otherbtn">Other changes (${data.diff.other.length})</button>` : ''}`
          : ''
      }<span id="status">${escapeXml(hint)}</span>${data.truncated ? '<span class="warn">Some calls were left out (size limits) — click a method to explore it fully</span>' : ''}${data.notice ? `<span class="warn" title="${escapeAttr(data.notice)}">${escapeXml(data.notice)}</span>` : ''}<span class="perf" title="Time spent asking the language server, and laying the graph out (0 = reused)">fetch ${data.fetchMs} ms · layout ${layoutMs} ms</span></div>
      ${
        data.diff && data.diff.other.length
          ? `<div id="otherlist" hidden>${data.diff.other
              .map((o, i) => `<div class="oth" data-i="${i}" title="${escapeAttr(o.file)}"><b>${escapeXml(o.label)}</b><span>${escapeXml(o.note)}</span></div>`)
              .join('')}</div>`
          : ''
      }
      <div id="scroll">
        ${files.length === 0 && data.diff ? `<div class="emptydiff">No changed methods in “${escapeXml(data.diff.title)}”.${data.diff.other.length ? '<br>Other changes (imports, config, tests…) are listed under “Other changes”.' : ''}</div>` : ''}
        <svg id="graph">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0L10 5L0 10z" fill="var(--vscode-editorLineNumber-foreground,#858585)" />
            </marker>
            <marker id="arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0L10 5L0 10z" fill="var(--vscode-charts-blue,#3794ff)" />
            </marker>
            <marker id="arrow-focus" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0L10 5L0 10z" fill="var(--vscode-charts-orange,#d18616)" />
            </marker>
            <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.25" />
            </filter>
          </defs>
          <g id="world"><g transform="translate(${origin.x},${origin.y})">
            <g id="edges">${edgeParts.join('\n')}</g>
            <g id="cards">${cardParts.join('\n')}</g>
            <g id="edges-top">${topParts.join('\n')}</g>
          </g></g>
        </svg>
      </div>
    </div>`;

  const scroller = main.querySelector<HTMLElement>('#scroll')!;
  const zlabel = main.querySelector<HTMLElement>('#zlabel')!;
  const world = main.querySelector<SVGGElement>('#world')!;

  const cw = () => scroller.clientWidth;
  const ch = () => scroller.clientHeight;
  const fitK = () => {
    const f = Math.min((cw() - 2 * FIT_MARGIN) / bounds.w, (ch() - 2 * FIT_MARGIN) / bounds.h);
    return Number.isFinite(f) && f > 0 ? f : 1;
  };
  // Farthest out shows the whole graph (never smaller than needed, never above 100% for that);
  // farthest in is MAX_ZOOM.
  const clampK = (k: number) => Math.min(MAX_ZOOM, Math.max(Math.min(fitK(), 1), k));
  // The content can be panned freely but never entirely out of sight.
  const clampPan = () => {
    const bw = bounds.w * view.k;
    const bh = bounds.h * view.k;
    const visX = Math.min(bw, 160);
    const visY = Math.min(bh, 160);
    const x0 = view.tx + bounds.x * view.k;
    const y0 = view.ty + bounds.y * view.k;
    if (x0 > cw() - visX) view.tx -= x0 - (cw() - visX);
    if (x0 + bw < visX) view.tx += visX - (x0 + bw);
    if (y0 > ch() - visY) view.ty -= y0 - (ch() - visY);
    if (y0 + bh < visY) view.ty += visY - (y0 + bh);
  };
  const paintView = () => {
    world.setAttribute('transform', `translate(${view.tx},${view.ty}) scale(${view.k})`);
    zlabel.textContent = `${Math.round(view.k * 100)}%`;
  };
  const panBy = (dx: number, dy: number) => {
    view.tx += dx;
    view.ty += dy;
    clampPan();
    paintView();
  };
  const setZoom = (next: number, px = cw() / 2, py = ch() / 2) => {
    const k = clampK(next);
    if (k === view.k) return;
    const wx = (px - view.tx) / view.k;
    const wy = (py - view.ty) / view.k;
    view.k = k;
    view.tx = px - wx * k;
    view.ty = py - wy * k;
    clampPan();
    paintView();
  };
  const fitView = () => {
    const k = clampK(fitK());
    view.k = k;
    view.tx = (cw() - bounds.w * k) / 2 - bounds.x * k;
    view.ty = (ch() - bounds.h * k) / 2 - bounds.y * k;
    paintView();
  };
  const startView = () => {
    const k = clampK(Math.max(Math.min(fitK(), 1), 0.7));
    view.k = k;
    view.tx = bounds.w * k <= cw() ? (cw() - bounds.w * k) / 2 - bounds.x * k : FIT_MARGIN - bounds.x * k;
    view.ty = bounds.h * k <= ch() ? (ch() - bounds.h * k) / 2 - bounds.y * k : FIT_MARGIN - bounds.y * k;
    paintView();
  };

  if (resetView) {
    startView();
  } else {
    view.k = clampK(view.k);
    clampPan();
    paintView();
  }
  // Keep the method you just clicked comfortably on screen, panning only as far as needed.
  const revealRow = (id: string) => {
    const info = symInfo.get(id);
    const b = info ? boxes.get(info.file.id) : undefined;
    if (!info || !b) return false;
    const top = b.y + geoms.get(info.file.id)![info.index].top;
    const m = 70;
    const bottomM = hopCtl.hidden ? m : 110;
    const sy0 = view.ty + top * view.k;
    const sy1 = sy0 + ROW_H * view.k;
    if (sy0 < m) view.ty += m - sy0;
    else if (sy1 > ch() - bottomM) view.ty -= sy1 - (ch() - bottomM);
    const sx0 = view.tx + b.x * view.k;
    const sx1 = sx0 + b.w * view.k;
    if (sx0 < m) view.tx += m - sx0;
    else if (sx1 > cw() - m) view.tx -= sx1 - (cw() - m);
    paintView();
    return true;
  };
  if (revealNext && activeId && !resetView) revealRow(activeId);
  revealNext = false;

  refit = false;
  resizeObs?.disconnect();
  resizeObs = new ResizeObserver(() => {
    view.k = clampK(view.k);
    clampPan();
    paintView();
  });
  resizeObs.observe(scroller);

  const svg = main.querySelector<SVGSVGElement>('#graph')!;
  const statusEl = main.querySelector<HTMLElement>('#status')!;
  const isolateBtn = main.querySelector<HTMLButtonElement>('#isolate')!;
  const rowEls = new Map<string, Element>();
  const edgeEls = new Map<string, Element>();
  const edgeTopEls = new Map<string, Element>();
  const cardEls = new Map<string, Element>();
  const subEls = Array.from(main.querySelectorAll('.sub'));
  main.querySelectorAll('.row').forEach((el) => rowEls.set(el.getAttribute('data-sym')!, el));
  main.querySelectorAll('.edge').forEach((el) => edgeEls.set(el.getAttribute('data-id')!, el));
  main.querySelectorAll('.topline').forEach((el) => edgeTopEls.set(el.getAttribute('data-id')!, el));
  main.querySelectorAll('.card').forEach((el) => cardEls.set(el.getAttribute('data-file')!, el));

  const crumbsEl = main.querySelector('#crumbs')!;
  const paintActive = () => {
    const info = activeId ? symInfoAll.get(activeId) : undefined;
    rowEls.forEach((el, id) => el.classList.toggle('active', id === activeId));
    subEls.forEach((el) => el.classList.toggle('active', el.getAttribute('data-target') === activeId));
    cardEls.forEach((el, fileId) => {
      const file = files.find((f) => f.id === fileId);
      el.classList.toggle('hasactive', !!activeId && !!file?.symbols.some((sym) => sym.id === activeId));
    });
    let chip = main.querySelector<HTMLButtonElement>('#activechip');
    if (!info) {
      chip?.remove();
      return;
    }
    if (!chip) {
      chip = document.createElement('button');
      chip.id = 'activechip';
      chip.className = 'activechip';
      chip.title = 'Scroll to the method you last clicked (F)';
      chip.addEventListener('click', () => locateActive());
      crumbsEl.insertAdjacentElement('afterend', chip);
    }
    chip.textContent = `◎ ${isServices ? baseName(info.file.label) : info.row.name}`;
  };
  const locateActive = () => {
    const id = activeId;
    if (!id) return;
    const info = symInfo.get(id);
    const b = info ? boxes.get(info.file.id) : undefined;
    if (!info || !b) {
      statusEl.textContent = 'That method is on another page of its card, or hidden by the current filters.';
      return;
    }
    const top = b.y + geoms.get(info.file.id)![info.index].top;
    view.tx = cw() / 2 - (b.x + b.w / 2) * view.k;
    view.ty = ch() / 2 - (top + ROW_H / 2) * view.k;
    clampPan();
    paintView();
    const el = rowEls.get(id);
    el?.classList.add('pulse');
    setTimeout(() => el?.classList.remove('pulse'), 1800);
  };

  // Slide surviving cards from where they were to where they are now; fade new ones in.
  if (animate) {
    svg.classList.add('anim');
    const moved: Array<[SVGGElement, { x: number; y: number }]> = [];
    cardEls.forEach((el, fid) => {
      const from = prevPos.get(`card:${fid}`);
      const to = posNow.get(`card:${fid}`)!;
      if (!from) {
        el.classList.add('enter');
        return;
      }
      const sx = from.x - origin.x;
      const sy = from.y - origin.y;
      if (Math.abs(sx - to.x) < 0.5 && Math.abs(sy - to.y) < 0.5) return;
      const node = el as SVGGElement;
      node.style.transition = 'none';
      node.style.transform = `translate(${sx}px,${sy}px)`;
      moved.push([node, to]);
    });
    if (moved.length > 0) {
      void svg.getBoundingClientRect();
      requestAnimationFrame(() =>
        moved.forEach(([node, to]) => {
          node.style.transition = '';
          node.style.transform = `translate(${to.x}px,${to.y}px)`;
        })
      );
    }
  }
  prevPos = new Map(Array.from(posNow, ([k, p]) => [k, { x: p.x + origin.x, y: p.y + origin.y }]));

  let curSel: Selection | null = null;

  const trace = (starts: string[], adj: Map<string, CallEdge[]>, forward: boolean, s: Selection) => {
    const queue = [...starts];
    while (queue.length > 0) {
      const id = queue.pop()!;
      for (const e of adj.get(id) ?? []) {
        s.edges.add(e.id);
        const next = forward ? e.target : e.source;
        if (!s.syms.has(next)) {
          s.syms.add(next);
          queue.push(next);
        }
      }
    }
  };

  const applySelection = (s: Selection | null, r?: Reach) => {
    curSel = s;
    svg.classList.toggle('has-sel', !!s);
    rowEls.forEach((el, id) => {
      el.classList.toggle('on', !!s?.syms.has(id));
      el.classList.toggle('focus', !!s?.focus.has(id));
      const hop = r?.hops.get(id);
      const chip = hop !== undefined && hop > 0;
      el.classList.toggle('hashop', chip);
      const text = el.querySelector('.hoptext');
      const circle = el.querySelector<SVGElement>('.hopcircle');
      if (text) text.textContent = chip ? String(hop) : '';
      if (circle) {
        circle.classList.toggle('up', r?.dirs.get(id) === 'up');
        circle.style.fillOpacity = chip ? String(Math.max(0.45, 1 - 0.14 * (hop! - 1))) : '1';
      }
    });
    subEls.forEach((el) => el.classList.toggle('on', !!s?.syms.has(el.getAttribute('data-target')!)));
    edgeEls.forEach((el, id) => {
      const on = !!s?.edges.has(id);
      el.classList.toggle('on', on);
      el.classList.toggle('focus', s?.focusEdge === id);
      const top = edgeTopEls.get(id);
      if (top) {
        top.classList.toggle('show', on);
        top.classList.toggle('focus', s?.focusEdge === id);
      }
    });
    cardEls.forEach((el, fileId) => {
      const file = files.find((f) => f.id === fileId)!;
      el.classList.toggle('off', !!s && !file.symbols.some((sym) => s.syms.has(sym.id)));
    });
    const unit = isServices ? 'service' : 'method';
    statusEl.textContent = s
      ? `Tracing ${s.syms.size} ${unit}${s.syms.size === 1 ? '' : 's'} · ${s.edges.size} call line${s.edges.size === 1 ? '' : 's'} — Isolate hides the rest · Esc clears`
      : hint;
    isolateBtn.hidden = !s && !isolate;
    isolateBtn.classList.toggle('on', !!isolate);
    isolateBtn.title = isolate ? 'Show all: bring back hidden calls (Esc)' : 'Isolate: hide everything except traced path';
    isolateBtn.innerHTML = ICONS.isolate;
    paintActive();
  };

  const select = (starts: string[], focusEdge?: CallEdge) => {
    const hadPin = pin !== null;
    pin = null;
    lastSel = { starts, edgeId: focusEdge?.id };
    if (hadPin) {
      updateHopCtl();
      if (extras) {
        rerender();
        return;
      }
    }
    const s: Selection = { syms: new Set(starts), edges: new Set(), focus: new Set(starts) };
    if (focusEdge) {
      s.syms.add(focusEdge.source);
      s.syms.add(focusEdge.target);
      s.focus = new Set([focusEdge.source, focusEdge.target]);
      s.edges.add(focusEdge.id);
      s.focusEdge = focusEdge.id;
      trace([focusEdge.source], inAdj, false, s);
      trace([focusEdge.target], outAdj, true, s);
    } else {
      trace(starts, outAdj, true, s);
      trace(starts, inAdj, false, s);
    }
    applySelection(s);
  };

  const clearSelection = () => {
    lastSel = null;
    pin = null;
    activeId = null;
    updateHopCtl();
    if (extras) rerender();
    else applySelection(null);
  };

  const updateHopCtl = () => {
    if (!pin) {
      hopCtl.hidden = true;
      return;
    }
    const total = reach(data, pin.start, 50).maxHop;
    hopTotal = total;
    const loading = explored.has(pin.start) && !exploreDone.has(pin.start);
    hopSlider.max = String(Math.max(1, total, pin.hops));
    hopSlider.value = String(pin.hops);
    hopSlider.disabled = total === 0;
    paintSlider();
    const more = exploreTruncated.has(pin.start) ? '+' : '';
    hopLabel.textContent = loading
      ? `${pin.hops} · exploring…`
      : total === 0
        ? 'no calls'
        : `${Math.min(pin.hops, total)} of ${total}${more} hops`;
    hopCtl.hidden = false;
  };

  const selectPinned = () => {
    if (!pin) return;
    const r = reach(data, pin.start, pin.hops);
    const key = `${pin.start}:${pin.hops}:${data.files.length}:${data.edges.length}`;
    if (!isolate && key !== lastPinRender && [...r.hops.keys()].some((id) => !symInfo.has(id))) {
      lastPinRender = key;
      rerender();
      return;
    }
    lastSel = null;
    applySelection({ syms: new Set(r.hops.keys()), edges: new Set(r.edges), focus: new Set([pin.start]) }, r);
    updateHopCtl();
  };

  const beginPin = (id: string, parent?: string) => {
    activeId = id;
    revealNext = true;
    if (pin?.start !== id) {
      pin = { start: id, hops: depth };
      pinParent = parent;
    }
    if (!explored.has(id)) {
      explored.add(id);
      const info = symInfoAll.get(id)!;
      vscode.postMessage({ command: 'explore', id, file: info.file.file, line: info.row.line, character: info.row.character });
    }
    selectPinned();
  };

  const rerender = () => {
    anchorKeys = pin
      ? [`row:${pin.start}`, ...(pinParent ? [`row:${pinParent}`] : [])]
      : lastSel?.starts[0]
        ? [`row:${lastSel.starts[0]}`]
        : [];
    void renderGraph(data);
  };
  const rerenderAround = (keys: string[]) => {
    anchorKeys = keys;
    void renderGraph(data);
  };
  const open = (file: string, line: number, character: number) =>
    vscode.postMessage({ command: 'openFile', file, line, character });
  const focusFile = (file: FileNode) => vscode.postMessage({ command: 'focus', file: file.file });
  const focusSymbol = (info: { row: SymbolRow; file: FileNode }) =>
    vscode.postMessage({
      command: 'focus',
      file: info.file.file,
      line: info.row.line,
      character: info.row.character,
      name: info.row.name,
    });

  let drag: { x: number; y: number; tx: number; ty: number; moved: boolean } | null = null;
  let suppressClick = false;

  scroller.addEventListener('click', (ev) => {
    if (suppressClick) return;
    const target = ev.target as Element;
    const chevEl = target.closest('.chev');
    const addBtnEl = target.closest('.row-add-btn');
    const subAddBtnEl = target.closest('.sub-add-btn');
    const subEl = target.closest('.sub');
    const rowEl = target.closest('.row');
    const headerEl = target.closest('.card-header');
    const edgeEl = target.closest('.edge');
    const pgEl = target.closest('.pg-btn');
    const moreEl = target.closest('.submore');
    if (addBtnEl) {
      const symId = addBtnEl.getAttribute('data-sym')!;
      const info = symInfoAll.get(symId) ?? symInfo.get(symId);
      if (info) {
        vscode.postMessage({
          command: 'addToBucket',
          items: [{
            id: info.row.id,
            file: info.file.file,
            name: info.row.name,
            line: info.row.line,
            character: info.row.character,
            kind: info.row.kind,
            level: 'signature',
          }],
        });
        if (!dockOpen) openDock('bucket');
        else if (activeDockTab !== 'bucket') switchDockTab('bucket');
      }
      return;
    }
    if (subAddBtnEl) {
      const targetId = subAddBtnEl.getAttribute('data-target')!;
      const parentId = subAddBtnEl.getAttribute('data-parent') ?? undefined;
      const info = symInfoAll.get(targetId);
      if (info) {
        vscode.postMessage({
          command: 'addToBucket',
          items: [{
            id: info.row.id,
            file: info.file.file,
            name: info.row.name,
            line: info.row.line,
            character: info.row.character,
            kind: info.row.kind,
            level: 'signature',
            parentId,
          }],
        });
        if (!dockOpen) openDock('bucket');
        else if (activeDockTab !== 'bucket') switchDockTab('bucket');
      }
      return;
    }
    if (pgEl) {
      if (pgEl.classList.contains('dis')) return;
      const fid = pgEl.getAttribute('data-file')!;
      pageOf.set(fid, (pageInfo.get(fid)?.page ?? 0) + Number(pgEl.getAttribute('data-dir')));
      rerenderAround([`card:${fid}`]);
    } else if (moreEl) {
      const id = moreEl.getAttribute('data-sym')!;
      if (!subAll.delete(id)) subAll.add(id);
      rerenderAround([`row:${id}`]);
    } else if (chevEl) {
      const id = chevEl.getAttribute('data-sym')!;
      if (!expanded.delete(id)) expanded.add(id);
      activeId = id;
      revealNext = true;
      rerenderAround([`row:${id}`]);
    } else if (subEl) {
      const info = symInfoAll.get(subEl.getAttribute('data-target')!);
      if (info) {
        beginPin(info.row.id, subEl.getAttribute('data-parent') ?? undefined);
        open(info.file.file, info.row.line, info.row.character);
        showSignature(info.file.file, info.row.line, info.row.character, info.row.name);
        recordFlowStep(info.row.id);
      }
    } else if (rowEl) {
      const info = symInfo.get(rowEl.getAttribute('data-sym')!)!;
      if (isServices) {
        select([info.row.id]);
        open(info.file.file, 0, 0);
      } else {
        beginPin(info.row.id);
        open(info.file.file, info.row.line, info.row.character);
        showSignature(info.file.file, info.row.line, info.row.character, info.row.name);
      }
      recordFlowStep(info.row.id);
    } else if (headerEl) {
      const file = files.find((f) => f.id === headerEl.getAttribute('data-file'))!;
      select(file.symbols.map((s) => s.id));
      open(file.file, 0, 0);
    } else if (edgeEl) {
      const edge = edgeById.get(edgeEl.getAttribute('data-id')!);
      if (edge) select([], edge);
    } else {
      clearSelection();
    }
  });

  scroller.addEventListener('dblclick', (ev) => {
    const target = ev.target as Element;
    if (target.closest('.chev') || target.closest('.pg-btn') || target.closest('.submore')) return;
    const subEl = target.closest('.sub');
    const rowEl = target.closest('.row');
    const headerEl = target.closest('.card-header');
    if (subEl) {
      const info = symInfoAll.get(subEl.getAttribute('data-target')!);
      if (info) focusSymbol(info);
    } else if (rowEl) {
      const info = symInfo.get(rowEl.getAttribute('data-sym')!)!;
      if (isServices) focusFile(info.file);
      else focusSymbol(info);
    } else if (headerEl) {
      const file = files.find((f) => f.id === headerEl.getAttribute('data-file'));
      if (file) focusFile(file);
    }
  });

  const resetFilters = () => {
    isolate = null;
    lastSel = null;
    pin = null;
    rerender();
  };
  const diffSel = main.querySelector<HTMLSelectElement>('#diffsrc')!;
  const requestDiffCommits = () => {
    vscode.postMessage({ command: 'diffSources' });
  };
  diffSel.addEventListener('focus', requestDiffCommits);
  diffSel.addEventListener('mousedown', requestDiffCommits);
  diffSel.addEventListener('change', () => {
    if (diffSel.value === '__exit') vscode.postMessage({ command: 'back' });
    else if (diffSel.value) vscode.postMessage({ command: 'diff', source: diffSel.value });
  });
  main.querySelector<HTMLSelectElement>('#impactup')?.addEventListener('change', (ev) => {
    impactUp = Number((ev.target as HTMLSelectElement).value);
    isolate = null;
    rerender();
  });
  main.querySelector<HTMLSelectElement>('#impactdown')?.addEventListener('change', (ev) => {
    impactDown = Number((ev.target as HTMLSelectElement).value);
    isolate = null;
    rerender();
  });
  const otherList = main.querySelector<HTMLElement>('#otherlist');
  main.querySelector('#otherbtn')?.addEventListener('click', () => {
    if (otherList) otherList.hidden = !otherList.hidden;
  });
  otherList?.addEventListener('click', (ev) => {
    const entry = (ev.target as Element).closest('.oth');
    const item = entry && data.diff ? data.diff.other[Number(entry.getAttribute('data-i'))] : undefined;
    if (item) open(item.file, item.line, 0);
  });
  main.querySelector('#back')!.addEventListener('click', () => {
    if (!flowNav?.(-1)) vscode.postMessage({ command: 'back' });
  });
  main.querySelector('#fwd')!.addEventListener('click', () => {
    if (!flowNav?.(1)) vscode.postMessage({ command: 'forward' });
  });
  main.querySelector('#crumbs')!.addEventListener('click', (ev) => {
    const crumb = (ev.target as Element).closest('.crumb');
    if (!crumb) return;
    const sym = crumb.getAttribute('data-sym');
    if (sym) {
      activateStep(sym);
      return;
    }
    if (crumb.classList.contains('root-crumb')) {
      flowTrail = [];
      flowFwd = [];
      clearSelection();
      crumbsEl.innerHTML = crumbsHtml(data.rootLabel);
      syncNavButtons();
      return;
    }
    if (!crumb.classList.contains('cur')) {
      const idx = crumb.getAttribute('data-i');
      if (idx !== null) {
        vscode.postMessage({ command: 'goTo', index: Number(idx) });
      }
    }
  });
  main.querySelector<HTMLSelectElement>('#mode')!.addEventListener('change', (ev) => {
    mode = (ev.target as HTMLSelectElement).value as Mode;
    resetFilters();
  });
  main.querySelector<HTMLSelectElement>('#show')?.addEventListener('change', (ev) => {
    show = (ev.target as HTMLSelectElement).value as Show;
    isolate = null;
    rerender();
  });
  isolateBtn.addEventListener('click', () => {
    if (isolate) {
      isolate = null;
    } else if (curSel) {
      isolate = { syms: new Set(curSel.syms), edges: new Set(curSel.edges) };
    }
    rerender();
  });
  const legendEl = main.querySelector<HTMLElement>('#legend')!;
  main.querySelector('#helpbtn')!.addEventListener('click', (ev) => {
    legendEl.hidden = !legendEl.hidden;
    (ev.currentTarget as HTMLElement).classList.toggle('on', !legendEl.hidden);
  });
  main.querySelector('#sigbtn')!.addEventListener('click', () => {
    if (dockOpen && activeDockTab === 'sig') {
      closeDock();
    } else {
      openDock('sig');
      if (sigLast) showSignature(sigLast.file, sigLast.line, sigLast.character, sigLast.name);
    }
  });
  main.querySelector('#ctxbtn')?.addEventListener('click', () => {
    if (dockOpen && activeDockTab === 'bucket') {
      closeDock();
    } else {
      openDock('bucket');
    }
  });
  main.querySelector('#rearrange')!.addEventListener('click', () => {
    rearrange = true;
    refit = true;
    rerender();
  });
  main.querySelector('#refresh')!.addEventListener('click', () => vscode.postMessage({ command: 'requestRefresh' }));
  main.querySelector('#zin')!.addEventListener('click', () => setZoom(view.k * ZOOM_STEP));
  main.querySelector('#zout')!.addEventListener('click', () => setZoom(view.k / ZOOM_STEP));
  main.querySelector('#zfit')!.addEventListener('click', fitView);

  // Pinch arrives as a wheel event with ctrlKey and zooms at the pointer; two-finger scroll pans.
  scroller.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      if (ev.ctrlKey || ev.metaKey) {
        const rect = scroller.getBoundingClientRect();
        const delta = Math.max(-50, Math.min(50, ev.deltaY));
        setZoom(view.k * Math.exp(-delta * 0.008), ev.clientX - rect.left, ev.clientY - rect.top);
      } else {
        panBy(-ev.deltaX, -ev.deltaY);
      }
    },
    { passive: false }
  );

  scroller.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0 || (ev.target as Element).closest('.row,.sub,.submore,.card-header,.edge,.chev,.pg-btn')) return;
    drag = { x: ev.clientX, y: ev.clientY, tx: view.tx, ty: view.ty, moved: false };
  });
  document.onmousemove = (ev) => {
    if (!drag) return;
    const dx = ev.clientX - drag.x;
    const dy = ev.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    view.tx = drag.tx + dx;
    view.ty = drag.ty + dy;
    clampPan();
    paintView();
  };
  document.onmouseup = () => {
    if (drag?.moved) {
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 50);
    }
    drag = null;
  };

  const syncNavButtons = () => {
    const back = main.querySelector<HTMLButtonElement>('#back');
    const fwd = main.querySelector<HTMLButtonElement>('#fwd');
    if (back) back.disabled = !(flowTrail.length > 1 || cursor > 0);
    if (fwd) fwd.disabled = !(flowFwd.length > 0 || cursor < trail.length - 1);
  };

  const recordFlowStep = (id: string) => {
    const info = symInfoAll.get(id);
    if (!info) return;
    const existingIdx = flowTrail.findIndex((s) => s.symId === id);
    if (existingIdx >= 0) {
      // Jumping back to an earlier step keeps the later ones reachable through Forward.
      const removed = flowTrail.slice(existingIdx + 1);
      if (removed.length) flowFwd = removed.reverse();
      flowTrail = flowTrail.slice(0, existingIdx + 1);
    } else {
      flowFwd = [];
      if (flowTrail.length > 7) flowTrail.shift();
      flowTrail.push({
        symId: id,
        name: info.row.name,
        file: info.file.file,
        line: info.row.line,
        character: info.row.character,
      });
    }
    crumbsEl.innerHTML = crumbsHtml(data.rootLabel);
    syncNavButtons();
  };

  const activateStep = (id: string) => {
    const info = symInfoAll.get(id);
    if (!info) return;
    beginPin(id);
    open(info.file.file, info.row.line, info.row.character);
    showSignature(info.file.file, info.row.line, info.row.character, info.row.name);
    recordFlowStep(id);
    locateActive();
  };

  flowNav = (dir) => {
    if (dir < 0) {
      if (flowTrail.length < 2) return false;
      activateStep(flowTrail[flowTrail.length - 2].symId);
      return true;
    }
    const next = flowFwd[flowFwd.length - 1];
    if (!next || !symInfoAll.has(next.symId)) return false;
    const rest = flowFwd.slice(0, -1);
    activateStep(next.symId);
    flowFwd = rest;
    syncNavButtons();
    return true;
  };
  syncNavButtons();

  const stepTarget = (symId: string, parentId?: string) => {
    const info = symInfoAll.get(symId);
    if (!info) return;
    if (isServices) {
      select([info.row.id]);
      open(info.file.file, 0, 0);
    } else {
      beginPin(info.row.id, parentId);
      open(info.file.file, info.row.line, info.row.character);
      showSignature(info.file.file, info.row.line, info.row.character, info.row.name);
    }
    recordFlowStep(info.row.id);
    locateActive();
  };

  let calleeStepIdx = 0;
  let lastCalleeSource = '';
  const stepCallee = (id: string) => {
    const edges = outAdj.get(id) ?? [];
    if (edges.length === 0) return;
    if (lastCalleeSource !== id) {
      lastCalleeSource = id;
      calleeStepIdx = 0;
    } else {
      calleeStepIdx = (calleeStepIdx + 1) % edges.length;
    }
    const targetId = edges[calleeStepIdx].target;
    stepTarget(targetId, id);
  };

  let callerStepIdx = 0;
  let lastCallerTarget = '';
  const stepCaller = (id: string) => {
    const edges = inAdj.get(id) ?? [];
    if (edges.length === 0) return;
    if (lastCallerTarget !== id) {
      lastCallerTarget = id;
      callerStepIdx = 0;
    } else {
      callerStepIdx = (callerStepIdx + 1) % edges.length;
    }
    const sourceId = edges[callerStepIdx].source;
    stepTarget(sourceId);
  };

  const stepSibling = (id: string, delta: number) => {
    const info = symInfo.get(id);
    if (!info) return;
    const syms = info.file.symbols;
    if (syms.length <= 1) return;
    const curIdx = syms.findIndex((s) => s.id === id);
    if (curIdx < 0) return;
    const nextIdx = (curIdx + delta + syms.length) % syms.length;
    stepTarget(syms[nextIdx].id);
  };

  rowEls.forEach((rowEl, id) => {
    rowEl.addEventListener('mouseenter', () => {
      if (drag) return;
      svg.classList.add('has-hover');
      const connectedSyms = new Set<string>([id]);
      const connectedEdges = new Set<string>();
      for (const e of outAdj.get(id) ?? []) {
        connectedEdges.add(e.id);
        connectedSyms.add(e.target);
      }
      for (const e of inAdj.get(id) ?? []) {
        connectedEdges.add(e.id);
        connectedSyms.add(e.source);
      }
      rowEls.forEach((el, symId) => el.classList.toggle('hover-on', connectedSyms.has(symId)));
      edgeEls.forEach((el, edgeId) => el.classList.toggle('hover-on', connectedEdges.has(edgeId)));
    });
    rowEl.addEventListener('mouseleave', () => {
      svg.classList.remove('has-hover');
      rowEls.forEach((el) => el.classList.remove('hover-on'));
      edgeEls.forEach((el) => el.classList.remove('hover-on'));
    });
  });

  document.onkeydown = (ev) => {
    if (ev.key === 'Escape') {
      clearSelection();
      return;
    }
    const tag = (ev.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT') return;
    if (ev.key === '+' || ev.key === '=') setZoom(view.k * ZOOM_STEP);
    else if (ev.key === '-') setZoom(view.k / ZOOM_STEP);
    else if (ev.key === '0') fitView();
    else if (ev.key === 'f' || ev.key === 'F') locateActive();
    else if (ev.key === ' ') {
      if (activeId) {
        const info = symInfoAll.get(activeId);
        if (info) open(info.file.file, info.row.line, info.row.character);
        ev.preventDefault();
      }
    } else if (ev.key === 'ArrowRight' || ev.key === 'Enter') {
      if (activeId) {
        stepCallee(activeId);
      } else {
        const first = data.roots[0] ?? files[0]?.symbols[0]?.id;
        if (first) stepTarget(first);
      }
      ev.preventDefault();
    } else if (ev.key === 'ArrowLeft') {
      if (activeId) {
        stepCaller(activeId);
      } else {
        const first = data.roots[0] ?? files[0]?.symbols[0]?.id;
        if (first) stepTarget(first);
      }
      ev.preventDefault();
    } else if (ev.key === 'ArrowDown') {
      if (activeId) {
        stepSibling(activeId, 1);
      } else {
        const first = data.roots[0] ?? files[0]?.symbols[0]?.id;
        if (first) stepTarget(first);
      }
      ev.preventDefault();
    } else if (ev.key === 'ArrowUp') {
      if (activeId) {
        stepSibling(activeId, -1);
      } else {
        const first = data.roots[0] ?? files[0]?.symbols[0]?.id;
        if (first) stepTarget(first);
      }
      ev.preventDefault();
    }
  };

  rerenderCurrent = rerender;

  onExplored = () => {
    updateHopCtl();
    selectPinned();
  };

  if (pin && !isServices) {
    selectPinned();
  } else if (lastSel && lastSel.starts.every((id) => symInfo.has(id))) {
    select(lastSel.starts, lastSel.edgeId ? edgeById.get(lastSel.edgeId) : undefined);
  } else {
    lastSel = null;
    applySelection(null);
  }
}

function midpoint(points: Point[]): Point {
  const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
  let half = 0;
  for (let i = 1; i < points.length; i++) half += dist(points[i - 1], points[i]);
  half /= 2;
  for (let i = 1; i < points.length; i++) {
    const seg = dist(points[i - 1], points[i]);
    if (half <= seg) {
      const t = seg === 0 ? 0 : half / seg;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
      };
    }
    half -= seg;
  }
  return points[points.length - 1];
}

/** Polyline with smooth quadratic-bezier elbows instead of sharp corners. */
function roundedPath(points: Point[], radius: number): string {
  if (points.length < 2) return '';
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
  const towards = (from: Point, to: Point, d: number): Point => {
    const len = dist(from, to);
    if (len === 0) return { ...from };
    const t = Math.min(d, len) / len;
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  };

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const r = Math.min(radius, dist(prev, curr) / 2, dist(curr, next) / 2);
    const before = towards(curr, prev, r);
    const after = towards(curr, next, r);
    d += ` L ${before.x} ${before.y} Q ${curr.x} ${curr.y} ${after.x} ${after.y}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

function truncate(text: string, widthPx: number): string {
  const maxChars = Math.max(1, Math.floor(widthPx / CHAR_W));
  return text.length <= maxChars ? text : text.slice(0, Math.max(1, maxChars - 1)) + '…';
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeXml(s).replace(/"/g, '&quot;');
}

window.addEventListener('message', (event: MessageEvent<ExtensionToWebviewMessage>) => {
  const message = event.data;
  if (message.command === 'loading') {
    const statusEl = document.getElementById('status');
    if (statusEl) {
      statusEl.textContent = 'Building graph…';
    } else {
      renderMessage('Building graph…');
    }
  } else if (message.command === 'error') {
    const statusEl = document.getElementById('status');
    if (statusEl) {
      statusEl.innerHTML = `<span class="warn">Could not build the graph: ${escapeXml(message.message)}</span>`;
      const scroll = document.getElementById('scroll');
      if (scroll && (!currentData || currentData.files.length === 0)) {
        scroll.innerHTML = `<div class="emptydiff"><div style="margin-bottom:8px;font-weight:600;">Could not build graph</div><div>${escapeXml(message.message)}</div><button id="errback" class="otherbtn" style="margin-top:12px;">← Go back</button></div>`;
        document.getElementById('errback')?.addEventListener('click', () => vscode.postMessage({ command: 'back' }));
      }
    } else {
      renderMessage(`Could not build the graph: ${message.message}`);
    }
  } else if (message.command === 'graphData') {
    const incomingKey = `${message.data.rootFileId}#${message.data.rootSymbolId ?? ''}`;
    // The crawl streams snapshots of the same root; fold those in without disturbing what you're doing.
    if (incomingKey === currentRootKey && currentData && (message.partial || partialSeen)) {
      trail = message.trail;
      cursor = message.cursor;
      const known = new Set(currentData.roots);
      for (const id of message.data.roots) if (!known.has(id)) expanded.add(id);
      partialSeen = message.partial === true;
      void renderGraph(message.data);
      return;
    }
    const leaving = { flow: flowTrail, flowFwd, expanded, depth };
    flowTrail = [];
    flowFwd = [];
    partialSeen = message.partial === true;
    activeId = null;
    revealNext = false;
    impactUp = 0;
    impactDown = 0;
    trail = message.trail;
    cursor = message.cursor;
    expanded = new Set(message.data.roots);
    depth = Math.min(DEFAULT_DEPTH, message.data.maxDepth);
    isolate = null;
    lastSel = null;
    pin = null;
    hopCtl.hidden = true;
    pageOf.clear();
    subAll.clear();
    explored.clear();
    exploreDone.clear();
    exploreTruncated.clear();
    const key = `${message.data.rootFileId}#${message.data.rootSymbolId ?? ''}`;
    if (currentRootKey) layoutMemory.set(currentRootKey, { map: mapState, view: { ...view }, ...leaving });
    const remembered = layoutMemory.get(key);
    if (remembered) {
      mapState = remembered.map;
      view = { ...remembered.view };
      refit = false;
      flowTrail = remembered.flow;
      flowFwd = remembered.flowFwd;
      expanded = new Set([...remembered.expanded, ...message.data.roots]);
      depth = Math.min(remembered.depth, message.data.maxDepth);
    } else {
      mapState = newMapState();
      refit = true;
    }
    currentRootKey = key;
    while (layoutMemory.size > 30) layoutMemory.delete(layoutMemory.keys().next().value as string);
    prevPos = new Map();
    pinParent = undefined;
    void renderGraph(message.data);
  } else if (message.command === 'signatureResult') {
    if (message.id !== sigReq) return;
    if (message.data) renderSignature(message.data);
    else sgBody.innerHTML = `<div class="sg-none">Could not read this method's signature: ${escapeXml(message.error ?? 'unknown error')}</div>`;
  } else if (message.command === 'bucketUpdated') {
    renderBucket(message.summary);
  } else if (message.command === 'diffSources') {
    diffCommits = message.commits;
    diffSummary = message.summary ?? null;
    const sel = document.getElementById('diffsrc') as HTMLSelectElement | null;
    if (sel && currentData) {
      const cur = sel.value;
      sel.innerHTML = diffSourceOptions(currentData);
      if (cur) sel.value = cur;
    }
  } else if (message.command === 'exploreResult') {
    if (currentData && explored.has(message.id)) {
      if (message.data) {
        mergeInto(currentData, message.data);
        exploreDone.add(message.id);
        if (message.data.truncated) exploreTruncated.add(message.id);
      } else {
        explored.delete(message.id);
      }
      onExplored?.();
    }
  } else if (message.command === 'searchResults') {
    if (message.id === searchSeq) {
      searchResults = message.results;
      searchSel = 0;
      renderResults();
    }
  }
});

function openDock(tab?: 'sig' | 'bucket') {
  if (tab) switchDockTab(tab);
  rightDock.hidden = false;
  dockSplit.hidden = false;
  dockOpen = true;
  if (activeDockTab === 'sig') {
    sigOn = true;
    document.getElementById('sigbtn')?.classList.add('on');
    document.getElementById('ctxbtn')?.classList.remove('on');
    if (sigLast) {
      sgTitle.textContent = sigLast.name;
      sgBody.innerHTML = '<div class="sg-none">Loading…</div>';
      vscode.postMessage({ command: 'signature', id: ++sigReq, file: sigLast.file, line: sigLast.line, character: sigLast.character });
    }
  } else {
    sigOn = false;
    document.getElementById('ctxbtn')?.classList.add('on');
    document.getElementById('sigbtn')?.classList.remove('on');
  }
}

function closeDock() {
  rightDock.hidden = true;
  dockSplit.hidden = true;
  dockOpen = false;
  sigOn = false;
  document.getElementById('sigbtn')?.classList.remove('on');
  document.getElementById('ctxbtn')?.classList.remove('on');
}

function switchDockTab(tab: 'sig' | 'bucket') {
  activeDockTab = tab;
  tabSigBtn.classList.toggle('active', tab === 'sig');
  tabBucketBtn.classList.toggle('active', tab === 'bucket');
  dockContentSig.hidden = tab !== 'sig';
  dockContentBucket.hidden = tab !== 'bucket';
  if (dockOpen) {
    if (tab === 'sig') {
      sigOn = true;
      document.getElementById('sigbtn')?.classList.add('on');
      document.getElementById('ctxbtn')?.classList.remove('on');
      if (sigLast) {
        sgTitle.textContent = sigLast.name;
        sgBody.innerHTML = '<div class="sg-none">Loading…</div>';
        vscode.postMessage({ command: 'signature', id: ++sigReq, file: sigLast.file, line: sigLast.line, character: sigLast.character });
      }
    } else {
      sigOn = false;
      document.getElementById('ctxbtn')?.classList.add('on');
      document.getElementById('sigbtn')?.classList.remove('on');
    }
  }
}

tabSigBtn.addEventListener('click', () => switchDockTab('sig'));
tabBucketBtn.addEventListener('click', () => switchDockTab('bucket'));
dockCloseBtn.addEventListener('click', () => closeDock());

function highlightBucketItem(name: string) {
  const itemEl = bkList.querySelector(`.bk-item[data-id*="${name}"]`) ||
                 Array.from(bkList.querySelectorAll('.bk-item-name')).find(el => el.textContent === name)?.closest('.bk-item');
  if (itemEl) {
    itemEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    itemEl.classList.remove('flash');
    void (itemEl as HTMLElement).offsetWidth;
    itemEl.classList.add('flash');
  }
}

function showSignature(file: string, line: number, character: number, name: string) {
  sigLast = { file, line, character, name };
  if (dockOpen && activeDockTab === 'sig') {
    sgTitle.textContent = name;
    sgBody.innerHTML = '<div class="sg-none">Loading…</div>';
    vscode.postMessage({ command: 'signature', id: ++sigReq, file, line, character });
  } else if (dockOpen && activeDockTab === 'bucket') {
    highlightBucketItem(name);
  }
}

function hideSignature() {
  if (activeDockTab === 'sig') closeDock();
}

function updateBucketBadges(count: number) {
  if (tabBucketBadge) {
    tabBucketBadge.textContent = String(count);
    tabBucketBadge.hidden = count === 0;
  }
  const tbBadge = document.getElementById('ctxbtn-badge');
  if (tbBadge) {
    tbBadge.textContent = String(count);
    tbBadge.hidden = count === 0;
  }
}

function renderBucket(summary: BucketSummary) {
  currentBucketSummary = summary;
  const count = summary.items.length;
  updateBucketBadges(count);

  if (count === 0) {
    bkList.innerHTML = `<div class="bk-empty">No methods in AI Context.<br>Click <b>+</b> on any method in the graph or click <b>+ Add Trace</b> to curate LLM context.</div>`;
    return;
  }

  bkList.innerHTML = summary.items
    .map((item) => {
      const lvl = item.level || 'signature';

      let previewHtml = '';
      if (lvl === 'name') {
        previewHtml = '';
      } else if (lvl === 'signature') {
        if (item.signature) {
          const sig = item.signature;
          const paramsStr = (sig.params || []).map((p) => `${p.name}${p.type ? `: ${p.type}` : ''}`).join(', ');
          const retStr = sig.returns?.type ? `: ${sig.returns.type}` : '';
          previewHtml = `<div class="bk-item-preview">${escapeXml(sig.name)}(${escapeXml(paramsStr)})${escapeXml(retStr)}</div>`;
        }
      } else if (lvl === 'full') {
        if (item.body) {
          const previewText = item.body.slice(0, 240);
          previewHtml = `<div class="bk-item-preview">${escapeXml(previewText)}${item.body.length > 240 ? '\n…' : ''}</div>`;
        }
      }

      return `
        <div class="bk-item" data-id="${escapeAttr(item.id)}">
          <div class="bk-item-head">
            <div class="bk-item-title">
              <a class="bk-item-name" data-file="${escapeAttr(item.file)}" title="Open in editor">${escapeXml(item.name)}</a>
              <span class="bk-item-file">${escapeXml(baseName(item.file))}</span>
            </div>
            <div class="bk-level-bar">
              <button class="bk-lvl-btn${lvl === 'name' ? ' active' : ''}" data-lvl="name" title="Name only">Name</button>
              <button class="bk-lvl-btn${lvl === 'signature' ? ' active' : ''}" data-lvl="signature" title="Signature & types">Sig</button>
              <button class="bk-lvl-btn${lvl === 'full' ? ' active' : ''}" data-lvl="full" title="Full implementation body">Full</button>
            </div>
            <button class="bk-item-del" title="Remove from AI Context">✕</button>
          </div>
          ${previewHtml}
        </div>`;
    })
    .join('');
}

bkList.addEventListener('click', (ev) => {
  const target = ev.target as Element;
  const nameEl = target.closest('.bk-item-name');
  if (nameEl) {
    const itemEl = nameEl.closest('.bk-item');
    const id = itemEl?.getAttribute('data-id');
    const item = currentBucketSummary?.items.find((x) => x.id === id);
    if (item) {
      vscode.postMessage({ command: 'openFile', file: item.file, line: item.signature?.line ?? item.line ?? 0, character: 0 });
    }
    return;
  }
  const lvlBtn = target.closest('.bk-lvl-btn');
  if (lvlBtn) {
    const itemEl = lvlBtn.closest('.bk-item');
    const id = itemEl?.getAttribute('data-id');
    const level = lvlBtn.getAttribute('data-lvl') as DetailLevel;
    if (id && level) {
      vscode.postMessage({ command: 'updateBucketLevel', id, level });
    }
    return;
  }
  const delBtn = target.closest('.bk-item-del');
  if (delBtn) {
    const itemEl = delBtn.closest('.bk-item');
    const id = itemEl?.getAttribute('data-id');
    if (id) {
      vscode.postMessage({ command: 'removeFromBucket', id });
    }
    return;
  }
});

document.getElementById('bk-add-trace')?.addEventListener('click', (ev) => {
  const itemsToAdd: BucketItemRef[] = [];
  const seen = new Set<string>();

  const addItem = (symId: string, parentId?: string) => {
    if (seen.has(symId)) return;
    seen.add(symId);
    const info = latestSymInfoAll.get(symId);
    if (info) {
      itemsToAdd.push({
        id: info.row.id,
        file: info.file.file,
        name: info.row.name,
        line: info.row.line,
        character: info.row.character,
        kind: info.row.kind,
        level: 'signature',
        parentId,
      });
    }
  };

  if (flowTrail.length > 0) {
    for (let i = 0; i < flowTrail.length; i++) {
      const step = flowTrail[i];
      const parentId = i > 0 ? flowTrail[i - 1].symId : undefined;
      addItem(step.symId, parentId);
    }
  }

  if (activeId) {
    addItem(activeId);
    if (currentData) {
      // Traverse all reachable edges across all hops (downstream callees and upstream callers)
      const queue: string[] = [activeId];
      const visitedHops = new Set<string>([activeId]);
      while (queue.length > 0) {
        const curr = queue.shift()!;
        for (const edge of currentData.edges) {
          if (edge.source === curr && !visitedHops.has(edge.target)) {
            visitedHops.add(edge.target);
            addItem(edge.target, curr);
            queue.push(edge.target);
          } else if (edge.target === curr && !visitedHops.has(edge.source)) {
            visitedHops.add(edge.source);
            addItem(edge.source, undefined);
            queue.push(edge.source);
          }
        }
      }
    }
  }

  if (itemsToAdd.length === 0 && currentData) {
    for (const rootId of currentData.roots) {
      addItem(rootId);
    }
    for (const edge of currentData.edges) {
      addItem(edge.target, edge.source);
    }
  }

  if (itemsToAdd.length > 0) {
    vscode.postMessage({ command: 'addToBucket', items: itemsToAdd });
    const btn = ev.currentTarget as HTMLButtonElement;
    const oldText = btn.textContent;
    btn.textContent = `+${itemsToAdd.length} Added!`;
    setTimeout(() => {
      btn.textContent = oldText;
    }, 1400);
  }
});

document.getElementById('bk-clear')?.addEventListener('click', () => {
  vscode.postMessage({ command: 'clearBucket' });
});

document.getElementById('bk-copy')?.addEventListener('click', (ev) => {
  vscode.postMessage({ command: 'copyBucket' });
  const btn = ev.currentTarget as HTMLButtonElement;
  const oldText = btn.textContent;
  btn.textContent = 'Copied!';
  setTimeout(() => {
    btn.textContent = oldText;
  }, 1500);
});

document.getElementById('bk-chat')?.addEventListener('click', (ev) => {
  vscode.postMessage({ command: 'sendBucketToChat' });
  const btn = ev.currentTarget as HTMLButtonElement;
  const oldText = btn.textContent;
  btn.textContent = 'Sent to Chat!';
  setTimeout(() => {
    btn.textContent = oldText;
  }, 1500);
});

function renderSignature(d: SignatureData) {
  sigCur = d;
  sgTitle.textContent = d.container ? `${d.container}.${d.name}` : d.name;
  sgTitle.title = `${d.file}:${d.line + 1}`;
  const names = d.types.map((t) => t.name);
  const withLinks = (text: string) => {
    const escaped = escapeXml(text);
    return names.length
      ? escaped.replace(new RegExp(`(?<![\\w$.])(${names.join('|')})(?![\\w$])`, 'g'), '<a class="tlink" data-t="$1" title="Jump to where $1 is declared, below">$1</a>')
      : escaped;
  };
  const chips = [
    ...d.decorators.map((x) => `<span class="sg-chip deco" title="A decorator on this method">${escapeXml(x)}</span>`),
    ...d.modifiers.map((m) => `<span class="sg-chip mod">${escapeXml(m)}</span>`),
  ].join('');

  const inputs = d.params.length
    ? d.params
        .map(
          (p) => `<div class="sg-param">
            <div class="sg-pline"><span class="sg-pname">${p.rest ? '…' : ''}${escapeXml(p.name)}</span>${
              p.optional ? '<span class="sg-flag" title="You can leave this out when calling">optional</span>' : ''
            }${p.decorators.map((x) => `<span class="sg-chip deco" title="Where this input comes from">${escapeXml(x)}</span>`).join('')}</div>
            <div class="sg-ptype">${p.type ? withLinks(p.type) : '<span class="sg-unknown">type not declared</span>'}${
              p.inferred ? '<span class="sg-flag soft" title="Not written in the code; worked out by the language server">inferred</span>' : ''
            }${p.defaultValue ? `<span class="sg-default" title="Used when the caller passes nothing">= ${escapeXml(p.defaultValue)}</span>` : ''}</div>
            ${p.doc ? `<div class="sg-pdoc">${escapeXml(p.doc)}</div>` : ''}
          </div>`
        )
        .join('')
    : '<div class="sg-none">Takes no inputs.</div>';

  const output = d.returns
    ? `<div class="sg-param"><div class="sg-ptype">${withLinks(d.returns.type)}${
        d.returns.inferred ? '<span class="sg-flag soft" title="Not written in the code; worked out by the language server">inferred</span>' : ''
      }</div>${d.returns.doc ? `<div class="sg-pdoc">${escapeXml(d.returns.doc)}</div>` : ''}</div>`
    : '<div class="sg-none">No return type could be found.</div>';

  const types = d.types.length
    ? d.types
        .map(
          (t) => `<div class="sg-type" id="sgt-${escapeAttr(t.name)}">
            <div class="sg-thead"><span class="sg-tkind">${escapeXml(t.kind)}</span><b>${escapeXml(t.name)}</b>
              <span class="sg-tfile" title="${escapeAttr(t.file)}">${escapeXml(baseName(t.file))}:${t.line + 1}</span>
              <button class="sg-topen" data-f="${escapeAttr(t.file)}" data-l="${t.line}" title="Open this type in the editor">Open</button></div>
            <pre>${escapeXml(t.declaration)}${t.truncated ? '\n…' : ''}</pre></div>`
        )
        .join('')
    : '<div class="sg-none">No types from this project are used here.</div>';

  sgBody.innerHTML = `
    <div class="sg-kind">${escapeXml(d.kind)}${d.container ? ` · in ${escapeXml(d.container)}` : ''}</div>
    <div class="sg-name">${escapeXml(d.name)}${d.typeParams ? `<span class="sg-tp">${escapeXml(d.typeParams)}</span>` : ''}</div>
    ${chips ? `<div class="sg-chips">${chips}</div>` : ''}
    ${d.description ? `<p class="sg-desc">${escapeXml(d.description)}</p>` : ''}
    <div class="sg-h">Inputs <span class="sg-count">${d.params.length}</span></div>${inputs}
    <div class="sg-h out">Output</div>${output}
    <div class="sg-h typ">Types <span class="sg-count">${d.types.length}</span></div>${types}`;
  sgBody.scrollTop = 0;
}

sgBody.addEventListener('click', (ev) => {
  const target = ev.target as Element;
  const link = target.closest('.tlink');
  if (link) {
    const card = document.getElementById(`sgt-${link.getAttribute('data-t')}`);
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    card?.classList.remove('flash');
    void (card as HTMLElement | null)?.offsetWidth;
    card?.classList.add('flash');
    return;
  }
  const open = target.closest('.sg-topen');
  if (open) {
    vscode.postMessage({ command: 'openFile', file: open.getAttribute('data-f')!, line: Number(open.getAttribute('data-l')), character: 0 });
  }
});
document.getElementById('sg-open')!.addEventListener('click', () => {
  if (sigCur) vscode.postMessage({ command: 'openFile', file: sigCur.file, line: sigCur.line, character: sigCur.character });
});
dockSplit.addEventListener('mousedown', (ev) => {
  ev.preventDefault();
  const move = (e: MouseEvent) => {
    rightDock.style.width = `${Math.max(300, Math.min(window.innerWidth * 0.75, window.innerWidth - e.clientX))}px`;
  };
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
});

let searchSeq = 0;
let searchResults: SearchResult[] = [];
let searchSel = 0;
let searchTimer: number | undefined;
const qEl = document.getElementById('q') as HTMLInputElement;
const resultsEl = document.getElementById('results')!;

function renderResults() {
  if (!qEl.value.trim()) {
    resultsEl.hidden = true;
    return;
  }
  resultsEl.hidden = false;
  if (searchResults.length === 0) {
    resultsEl.innerHTML = '<div class="rnone">No matches</div>';
    return;
  }
  let html = '';
  let lastGroup = '';
  searchResults.forEach((r, i) => {
    const groupName = r.kind === 'file' ? 'Files' : 'Symbols';
    if (groupName !== lastGroup) {
      html += `<div class="rgroup">${groupName}</div>`;
      lastGroup = groupName;
    }
    const icon = r.kind === 'file' ? '▤' : r.kind === 'class' ? 'C' : r.kind === 'method' ? 'm' : 'f';
    html += `<div class="res${i === searchSel ? ' sel' : ''}" data-i="${i}"><span class="rl">${icon}  ${escapeXml(r.label)}</span><span class="rd">${escapeXml(r.detail)}</span></div>`;
  });
  resultsEl.innerHTML = html;
  resultsEl.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}

function chooseResult(r: SearchResult) {
  if (r.kind === 'file' || r.kind === 'class') {
    vscode.postMessage({ command: 'focus', file: r.file });
  } else {
    vscode.postMessage({ command: 'focus', file: r.file, line: r.line, character: r.character, name: r.label });
  }
  vscode.postMessage({ command: 'openFile', file: r.file, line: r.line, character: r.character });
  if (r.kind === 'function' || r.kind === 'method') showSignature(r.file, r.line, r.character, r.label);
  qEl.value = '';
  searchResults = [];
  resultsEl.hidden = true;
  qEl.blur();
}

qEl.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  if (!qEl.value.trim()) {
    searchResults = [];
    renderResults();
    return;
  }
  resultsEl.hidden = false;
  if (searchResults.length === 0) resultsEl.innerHTML = '<div class="rnone">Searching…</div>';
  searchTimer = window.setTimeout(() => {
    vscode.postMessage({ command: 'search', query: qEl.value, id: ++searchSeq });
  }, 150);
});
qEl.addEventListener('keydown', (ev) => {
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    if (searchResults.length > 0) {
      searchSel = (searchSel + (ev.key === 'ArrowDown' ? 1 : -1) + searchResults.length) % searchResults.length;
      renderResults();
    }
  } else if (ev.key === 'Enter') {
    const r = searchResults[searchSel];
    if (r) chooseResult(r);
  } else if (ev.key === 'Escape') {
    qEl.value = '';
    searchResults = [];
    resultsEl.hidden = true;
    qEl.blur();
  }
});
qEl.addEventListener('focus', () => {
  if (qEl.value.trim()) renderResults();
});
qEl.addEventListener('blur', () => {
  resultsEl.hidden = true;
});
resultsEl.addEventListener('mousedown', (ev) => {
  ev.preventDefault();
  const el = (ev.target as Element).closest('.res');
  const r = el ? searchResults[Number(el.getAttribute('data-i'))] : undefined;
  if (r) chooseResult(r);
});
document.addEventListener('keydown', (ev) => {
  const tag = (ev.target as HTMLElement | null)?.tagName;
  if (ev.altKey && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && tag !== 'INPUT' && tag !== 'SELECT') {
    ev.preventDefault();
    if (!flowNav?.(ev.key === 'ArrowLeft' ? -1 : 1)) {
      vscode.postMessage({ command: ev.key === 'ArrowLeft' ? 'back' : 'forward' });
    }
    return;
  }
  if (ev.altKey && (ev.key === 's' || ev.key === 'S') && tag !== 'INPUT' && tag !== 'SELECT') {
    ev.preventDefault();
    if (dockOpen && activeDockTab === 'sig') {
      closeDock();
    } else {
      openDock('sig');
      if (sigLast) showSignature(sigLast.file, sigLast.line, sigLast.character, sigLast.name);
    }
    return;
  }
  if (ev.altKey && (ev.key === 'c' || ev.key === 'C') && tag !== 'INPUT' && tag !== 'SELECT') {
    ev.preventDefault();
    if (dockOpen && activeDockTab === 'bucket') {
      closeDock();
    } else {
      openDock('bucket');
    }
    return;
  }
  if (ev.key === '/' && tag !== 'INPUT' && tag !== 'SELECT') {
    ev.preventDefault();
    qEl.focus();
    qEl.select();
  }
});

vscode.postMessage({ command: 'getBucket' });
renderMessage('Waiting for graph data…');
