import { CallEdge, FileNode, GraphData, SymbolRow } from './types';

function sanitizeMermaidId(id: string): string {
  const clean = id.replace(/[^a-zA-Z0-9_]/g, '_');
  return clean.match(/^[a-zA-Z]/) ? clean : `n_${clean}`;
}

function escapeMermaidLabel(text: string): string {
  return text
    .replace(/"/g, '&quot;')
    .replace(/[[\]{}()<>]/g, (m) => `&#${m.charCodeAt(0)};`);
}

/**
 * Generates clean, GitHub-flavored Mermaid flowchart markup from graph data.
 */
export function generateMermaid(data: GraphData, mode: 'methods' | 'services' = 'methods'): string {
  const lines: string[] = ['flowchart LR'];

  if (mode === 'services') {
    // Services Mode: File/module level nodes and inter-file call aggregates
    const fileIdMap = new Map<string, string>();
    data.files.forEach((f, idx) => {
      const sanitized = `file_${idx}_${sanitizeMermaidId(f.label)}`;
      fileIdMap.set(f.file, sanitized);
      const label = escapeMermaidLabel(f.label);
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

    return lines.join('\n');
  }

  // Detailed Methods Mode: Subgraphs for files, nodes for callable methods/functions
  const symIdMap = new Map<string, string>();

  data.files.forEach((f, fIdx) => {
    const subId = `sub_${fIdx}_${sanitizeMermaidId(f.label)}`;
    const fileLabel = escapeMermaidLabel(f.label);
    lines.push(`  subgraph ${subId}["${fileLabel}"]`);
    lines.push('    direction TB');

    for (const sym of f.symbols) {
      const sId = `m_${sanitizeMermaidId(sym.id)}`;
      symIdMap.set(sym.id, sId);
      const name = escapeMermaidLabel(sym.name);
      lines.push(`    ${sId}["${name}"]`);
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
  innerSvgContent: string,
  bounds: { x: number; y: number; w: number; h: number },
  options: SvgPackagingOptions = {}
): string {
  const theme = options.theme ?? 'dark';
  const isLight = theme === 'light';
  const isTransparent = theme === 'transparent';

  const bg = isTransparent ? 'none' : isLight ? '#ffffff' : '#1e1e1e';
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

  // Static subset of webview/styles.css's real classes, with literal colors (no --vscode-* vars outside the webview).
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
  <style type="text/css">
    ${styles}
  </style>
  ${!isTransparent ? `<rect x="${vx}" y="${vy}" width="${width}" height="${height}" class="cg-bg" />` : ''}
  <g id="cg-content">
    ${innerSvgContent}
  </g>
</svg>`;
}
