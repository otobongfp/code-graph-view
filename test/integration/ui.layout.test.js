// Random call graphs rendered by the real webview: no line may run across a card and no two cards may overlap,
// including when a second load adds cards to an arrangement that already exists.
const assert = require('assert');
const h = require('./helpers');

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function makeGraph(seed, nFiles, extraEdges = 0) {
  const r = rng(seed);
  const files = [];
  const edges = [];
  const all = [];
  for (let f = 0; f < nFiles; f++) {
    const symbols = [];
    const count = 2 + Math.floor(r() * 6);
    for (let i = 0; i < count; i++) {
      const id = `f${f}m${i}`;
      symbols.push(h.sym(id, 'method' + i, i * 4));
      all.push(id);
    }
    files.push({ id: `file:///w/f${f}.ts`, label: `src/f${f}.ts`, file: `/w/f${f}.ts`, symbols });
  }
  const seen = new Set();
  for (let k = 0; k < nFiles * 4 + extraEdges; k++) {
    const a = all[Math.floor(r() * all.length)];
    const b = all[Math.floor(r() * all.length)];
    if (a === b || seen.has(`${a}>${b}`)) continue;
    seen.add(`${a}>${b}`);
    edges.push({ id: `${a}>${b}`, source: a, target: b });
  }
  return {
    rootFile: '/w/f0.ts',
    rootFileId: 'file:///w/f0.ts',
    rootLabel: 'f0.ts',
    maxDepth: 2,
    truncated: false,
    fetchMs: 1,
    roots: files.slice(0, 3).flatMap((f) => f.symbols.map((s) => s.id)),
    files,
    edges,
  };
}

/** Cards as { x, y, w, h } and how many lines cross a card or cards overlap, read from the rendered page. */
function measure(view) {
  const cards = view.$$('.card').map((c) => {
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(c.getAttribute('style') || '');
    const rect = c.querySelector('clipPath rect');
    return { x: +m[1], y: +m[2], w: +rect.getAttribute('width'), h: +rect.getAttribute('height') };
  });
  let overlaps = 0;
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i];
      const b = cards[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps++;
    }
  }
  let crossings = 0;
  const lines = view.$$('.edge .line');
  for (const line of lines) {
    const nums = (line.getAttribute('d').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const hitsCard = cards.some((c) => {
        const L = c.x + 1, R = c.x + c.w - 1, T = c.y + 1, B = c.y + c.h - 1;
        return Math.max(x0, x1) > L && Math.min(x0, x1) < R && Math.max(y0, y1) > T && Math.min(y0, y1) < B;
      });
      if (hitsCard) crossings++;
    }
  }
  return { cards: cards.length, edges: lines.length, overlaps, crossings };
}

module.exports = [
  [
    'lines never cross cards and cards never overlap, on 6 random graphs loaded twice',
    async () => {
      const totals = { cards: 0, edges: 0 };
      for (let seed = 1; seed <= 6; seed++) {
        const view = h.createWebview();
        const files = 14 + (seed % 5) * 4;
        const first = makeGraph(seed, files);
        view.send(h.graphMessage(first));
        await view.wait(600);
        const a = measure(view);
        // A second load of the same root with more cards and edges exercises "place new cards without moving old ones".
        const more = makeGraph(seed, files + 4, 6);
        more.rootFileId = first.rootFileId;
        more.roots = first.roots;
        view.send(h.graphMessage(more));
        await view.wait(600);
        const b = measure(view);
        view.close();
        for (const [label, m] of [['first load', a], ['second load', b]]) {
          assert.strictEqual(m.crossings, 0, `seed ${seed} ${label}: ${m.crossings} line segments cross a card`);
          assert.strictEqual(m.overlaps, 0, `seed ${seed} ${label}: ${m.overlaps} cards overlap`);
          totals.cards += m.cards;
          totals.edges += m.edges;
        }
        assert.deepStrictEqual(view.errors, [], `seed ${seed}: the page reported errors`);
      }
      assert.ok(totals.cards > 100 && totals.edges > 100, `the test must actually draw something (${JSON.stringify(totals)})`);
    },
  ],
];
