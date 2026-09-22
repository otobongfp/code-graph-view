import { strict as assert } from 'assert';
import { generateMermaid, packageStandaloneSvg } from '../src/diagramExport';
import { GraphData } from '../src/types';

describe('Feature: Diagram Export Engine', () => {
  const sampleGraph: GraphData = {
    rootFile: 'src/authService.ts',
    rootFileId: 'f0',
    rootLabel: 'login (src/authService.ts)',
    roots: ['src/authService.ts:login'],
    maxDepth: 2,
    truncated: false,
    files: [
      {
        id: 'f0',
        file: 'src/authService.ts',
        label: 'authService.ts',
        symbols: [
          { id: 'src/authService.ts:login', name: 'login(credentials: AuthDto): Promise<Token>', line: 10, character: 2, kind: 'method' },
          { id: 'src/authService.ts:validate', name: 'validate(token: string): boolean', line: 25, character: 2, kind: 'method' },
        ],
      },
      {
        id: 'f1',
        file: 'src/userRepo.ts',
        label: 'userRepo.ts',
        symbols: [
          { id: 'src/userRepo.ts:findUser', name: 'findUser(id: string): User', line: 15, character: 2, kind: 'method' },
        ],
      },
    ],
    edges: [
      { id: 'e1', source: 'src/authService.ts:login', target: 'src/userRepo.ts:findUser' },
      { id: 'e2', source: 'src/authService.ts:login', target: 'src/authService.ts:validate' },
    ],
    fetchMs: 10,
  };

  describe('Mermaid Diagram Generation', () => {
    it('generates structured flowchart with subgraphs for methods mode', () => {
      const mermaid = generateMermaid(sampleGraph, 'methods');

      assert.match(mermaid, /^flowchart TD/);
      assert.match(mermaid, /subgraph sub_0\["authService\.ts"\]/);
      assert.match(mermaid, /subgraph sub_1\["userRepo\.ts"\]/);
      assert.match(mermaid, /n0\["login\(credentials: AuthDto\): Promise<Token>"\]/);
      assert.match(mermaid, /n0 --> n2/);
      assert.match(mermaid, /n0 --> n1/);
      assert.match(mermaid, /style n0 fill:#d18616/);
    });

    it('generates file-level flowchart with call count edge labels for services mode', () => {
      const mermaid = generateMermaid(sampleGraph, 'services');

      assert.match(mermaid, /^flowchart TD/);
      assert.match(mermaid, /f0\["authService\.ts"\]/);
      assert.match(mermaid, /f1\["userRepo\.ts"\]/);
      assert.match(mermaid, /f0 -->\|"1 call"\| f1/);
      assert.match(mermaid, /style f0 fill:#d18616/);
    });

    it('properly sanitizes special characters, quotes, and punctuation in labels and IDs', () => {
      const complexGraph: GraphData = {
        rootFile: 'pkg/foo-bar/baz.go',
        rootFileId: 'f0',
        rootLabel: 'DoWork',
        roots: ['pkg/foo-bar/baz.go:DoWork<T>'],
        maxDepth: 1,
        truncated: false,
        files: [
          {
            id: 'f0',
            file: 'pkg/foo-bar/baz.go',
            label: 'pkg/foo-bar/baz.go',
            symbols: [
              { id: 'pkg/foo-bar/baz.go:DoWork<T>', name: 'DoWork[T any](ctx "context.Context")', line: 5, character: 0, kind: 'function' },
            ],
          },
        ],
        edges: [],
        fetchMs: 5,
      };

      const mermaid = generateMermaid(complexGraph, 'methods');
      assert.match(mermaid, /n0\["DoWork\[T any\]\(ctx 'context\.Context'\)"\]/);
    });
  });

  describe('Standalone SVG Packaging', () => {
    it('wraps inner SVG elements in standalone valid SVG with dark theme', () => {
      // Shaped like the real graph markup: its own <defs>, and classes like .rowbg rather than cg-*.
      const innerSvg =
        '<defs><marker id="arrow"></marker></defs><g id="world"><g class="card"><rect class="rowbg" x="10" y="10" width="100" height="50" /></g></g>';
      const bounds = { x: 0, y: 0, w: 200, h: 100 };
      const svg = packageStandaloneSvg(innerSvg, bounds, { theme: 'dark' });

      assert.match(svg, /<\?xml version="1.0" encoding="UTF-8"\?>/);
      assert.match(svg, /<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 200 100" width="200" height="100">/);
      assert.match(svg, /<rect x="0" y="0" width="200" height="100" class="cg-bg" \/>/);
      assert.match(svg, /\.cg-bg \{ fill: #1e1e1e; \}/);
      assert.match(svg, /\.rowbg \{ fill: transparent; \}/);
      assert.match(svg, /<g id="cg-content">/);
      assert.match(svg, /<marker id="arrow">/);
    });

    it('wraps inner SVG elements with light theme styling', () => {
      const innerSvg = '<g class="card"><rect x="0" y="0" width="80" height="40" /></g>';
      const bounds = { x: 10, y: 20, w: 150, h: 90 };
      const svg = packageStandaloneSvg(innerSvg, bounds, { theme: 'light' });

      assert.match(svg, /viewBox="10 20 150 90"/);
      assert.match(svg, /\.cg-bg \{ fill: #ffffff; \}/);
      assert.match(svg, /\.rname, \.sname \{ font-size: 12px; fill: #333333; \}/);
    });

    it('omits background rect when theme is transparent', () => {
      const innerSvg = '<g></g>';
      const bounds = { x: 0, y: 0, w: 100, h: 80 };
      const svg = packageStandaloneSvg(innerSvg, bounds, { theme: 'transparent' });

      assert.ok(!svg.includes('class="cg-bg"'));
    });
  });
});
