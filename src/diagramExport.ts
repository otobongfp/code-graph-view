import { GraphData } from './types';

function escapeMermaidLabel(text: string): string {
  let clean = text.replace(/"/g, "'").replace(/[\\`]/g, '').trim();
  if (!clean.includes('(') && !clean.includes('[')) {
    clean += '()';
  }
  return clean;
}

/**
 * Generates clean, GitHub-flavored Mermaid flowchart markup from graph data.
 */
export function generateMermaid(data: GraphData, mode: 'methods' | 'services' = 'methods'): string {
  const lines: string[] = ['flowchart TD'];

  if (mode === 'services') {
    // Services Mode: File/module level nodes and inter-file call aggregates
    const fileIdMap = new Map<string, string>();
    data.files.forEach((f, idx) => {
      const sanitized = `f${idx}`;
      fileIdMap.set(f.file, sanitized);
      const label = f.label.replace(/"/g, "'").trim();
      lines.push(`  ${sanitized}["${label}"]`);
    });

    // Aggregate calls between files
    const fileCalls = new Map<string, number>();
    for (const e of data.edges) {
      const fromFile = e.source.slice(0, e.source.lastIndexOf(':'));
      const toFile = e.target.slice(0, e.target.lastIndexOf(':'));
      if (fromFile && toFile && fromFile !== toFile) {
        const key = `${fromFile}-->${toFile}`;
        fileCalls.set(key, (fileCalls.get(key) ?? 0) + 1);
      }
    }

    for (const [key, count] of fileCalls) {
      const [fromFile, toFile] = key.split('-->');
      const fromId = fileIdMap.get(fromFile);
      const toId = fileIdMap.get(toFile);
      if (fromId && toId) {
        const label = count === 1 ? '1 call' : `${count} calls`;
        lines.push(`  ${fromId} -->|"${label}"| ${toId}`);
      }
    }

    // Highlight root file
    const rootFileId = fileIdMap.get(data.rootFile);
    if (rootFileId) {
      lines.push(`  style ${rootFileId} fill:#d18616,stroke:#e2c541,stroke-width:2px,color:#fff`);
    }

    return lines.join('\n');
  }

  // Detailed Methods Mode: Subgraphs for files, nodes for callable methods/functions
  const symIdMap = new Map<string, string>();
  const rootSymIds: string[] = [];
  let nodeCount = 0;

  data.files.forEach((f, fIdx) => {
    const subId = `sub_${fIdx}`;
    const fileLabel = f.label.replace(/"/g, "'").trim();
    lines.push(`  subgraph ${subId}["${fileLabel}"]`);
    lines.push('    direction TB');

    for (const sym of f.symbols) {
      const sId = `n${nodeCount++}`;
      symIdMap.set(sym.id, sId);
      const name = escapeMermaidLabel(sym.name);
      lines.push(`    ${sId}["${name}"]`);

      if (data.roots?.includes(sym.id) || sym.id === data.rootSymbolId) {
        rootSymIds.push(sId);
      }
    }

    lines.push('  end');
  });

  // Directed caller -> callee edges
  const seenEdges = new Set<string>();
  for (const e of data.edges) {
    const fromId = symIdMap.get(e.source);
    const toId = symIdMap.get(e.target);
    if (fromId && toId && fromId !== toId) {
      const edgeKey = `${fromId}-->${toId}`;
      if (!seenEdges.has(edgeKey)) {
        seenEdges.add(edgeKey);
        lines.push(`  ${fromId} --> ${toId}`);
      }
    }
  }

  // Highlight root methods
  for (const rootId of rootSymIds) {
    lines.push(`  style ${rootId} fill:#d18616,stroke:#e2c541,stroke-width:2px,color:#fff`);
  }

  return lines.join('\n');
}

export interface SvgPackagingOptions {
  theme?: 'dark' | 'light' | 'transparent';
  title?: string;
}

/**
 * Packages an SVG graph fragment with inlined styles, fonts, defs, markers,
 * and theme colors so it renders standalone across all viewers and image tools.
 */
export function packageStandaloneSvg(
  rawSvgContent: string,
  bounds: { x: number; y: number; w: number; h: number },
  options: SvgPackagingOptions = {}
): string {
  const theme = options.theme ?? 'dark';
  const isLight = theme === 'light';
  const isTransparent = theme === 'transparent';

  const bg = isTransparent ? 'none' : isLight ? '#ffffff' : '#1e1e1e';
  const cardBg = isLight ? '#f3f3f3' : '#252526';
  const cardBorder = isLight ? '#d4d4d4' : '#3c3c3c';
  const textMain = isLight ? '#333333' : '#cccccc';
  const textSub = isLight ? '#717171' : '#858585';
  const calleeColor = isLight ? '#0066cc' : '#3794ff';
  const callerColor = isLight ? '#b86800' : '#d18616';
  const edgeColor = isLight ? '#a0a0a0' : '#858585';
  const labelBg = isLight ? '#ffffff' : '#1e1e1e';
  const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  const width = Math.max(100, Math.ceil(bounds.w));
  const height = Math.max(80, Math.ceil(bounds.h));
  const vx = Math.floor(bounds.x);
  const vy = Math.floor(bounds.y);

  // Sanitize inner content:
  // 1. Strip pan/zoom transform from <g id="world">
  let cleanContent = rawSvgContent.replace(
    /<g id="world"[^>]*>/i,
    '<g id="world">'
  );

  // 2. Convert CSS style transforms `style="transform:translate(10px,20px)"` to standard SVG attribute `transform="translate(10,20)"`
  cleanContent = cleanContent.replace(/style="transform:\s*translate\((-?\d+(?:\.\d+)?)(?:px)?,\s*(-?\d+(?:\.\d+)?)(?:px)?\);?"/gi, 'transform="translate($1,$2)"');

  // 3. Resolve CSS variables to concrete hex codes
  cleanContent = cleanContent
    .replace(/var\(--vscode-editorWidget-background,[^)]+\)/g, cardBg)
    .replace(/var\(--vscode-widget-border,[^)]+\)/g, cardBorder)
    .replace(/var\(--vscode-editor-foreground,[^)]+\)/g, textMain)
    .replace(/var\(--vscode-descriptionForeground,[^)]+\)/g, textSub)
    .replace(/var\(--vscode-editorLineNumber-foreground,[^)]+\)/g, edgeColor)
    .replace(/var\(--vscode-charts-blue,[^)]+\)/g, calleeColor)
    .replace(/var\(--vscode-charts-orange,[^)]+\)/g, callerColor);

  const styles = `
    .cg-bg { fill: ${bg}; }
    svg text { font-family: ${font}; }
    .rowbg { fill: transparent; }
    .rname, .sname { font-size: 12px; fill: ${textMain}; }
    .row.isroot .rname { font-weight: 700; }
    .sfile, .badge, .chev text { font-size: 10.5px; fill: ${textSub}; }
    .smore { font-size: 11px; fill: ${calleeColor}; }
    .rootbar { fill: ${callerColor}; }
    .tree { fill: none; stroke: ${cardBorder}; stroke-width: 1; }
    .port { fill: ${edgeColor}; }
    .edge .hit { display: none; }
    .edge .line { fill: none; stroke: ${edgeColor}; stroke-width: 1.4; opacity: .85; }
    .cardborder { stroke: ${cardBorder}; stroke-width: 1; fill: none; }
    .elabel rect { fill: ${labelBg}; stroke: ${edgeColor}; }
    .elabel text { font-size: 10px; fill: ${textMain}; }
    .changebar { fill: #e2c08d; }
    .row.changed.added .changebar { fill: #81b88b; }
    .riskbar.high { fill: #f14c4c; }
    .riskbar.medium { fill: ${callerColor}; }
    .activebar { display: none; fill: #e2c541; }
    .row.active .activebar, .sub.active .activebar { display: block; }
    .row.active .rowbg, .sub.active .rowbg { fill: #e2c541; fill-opacity: .3; stroke: #e2c541; stroke-width: 1.5; }
    .hopchip, .row-add-btn, .sub-add-btn, .pg-btn { display: none; }
  `;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <style type="text/css">
      ${styles}
    </style>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0 0L10 5L0 10z" fill="${edgeColor}" />
    </marker>
    <marker id="arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0 0L10 5L0 10z" fill="${calleeColor}" />
    </marker>
    <marker id="arrow-focus" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0 0L10 5L0 10z" fill="${callerColor}" />
    </marker>
    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.25" />
    </filter>
  </defs>
  ${!isTransparent ? `<rect x="${vx}" y="${vy}" width="${width}" height="${height}" class="cg-bg" />` : ''}
  <g id="cg-content">
    ${cleanContent}
  </g>
</svg>`;
}

