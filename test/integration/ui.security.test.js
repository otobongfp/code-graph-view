// Text shown in the panel comes from source code, git history and AI-generated content, so none of it may become markup.
// Hostile strings are pushed through every message the extension can send, and the page is checked for injected
// elements and event-handler attributes after each one. (A payload sitting safely inside a quoted attribute value is fine.)
const assert = require('assert');
const h = require('./helpers');

const P = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
const A = '" onmouseover="window.__pwned=3" x="';
const BOTH = P + A;

/** What a hostile string could have added: new elements, event-handler attributes, or a stray `x` on a non-SVG element. */
function injected(view) {
  const found = [];
  const d = view.w.document;
  d.querySelectorAll('img, script, iframe, object, embed, link[rel=stylesheet]').forEach((e) => found.push(`<${e.tagName.toLowerCase()}>`));
  d.querySelectorAll('*').forEach((e) => {
    for (const a of e.attributes) {
      if (/^on/i.test(a.name)) found.push(`${e.tagName.toLowerCase()}[${a.name}]`);
      if (a.name === 'x' && !(e instanceof view.w.SVGElement)) found.push(`${e.tagName.toLowerCase()}[x]`);
    }
  });
  return found;
}

const signature = {
  name: BOTH, container: BOTH, kind: BOTH, file: `/w/${BOTH}.ts`, line: 1, character: 0, decorators: [BOTH], modifiers: [BOTH], typeParams: BOTH, description: BOTH,
  params: [{ name: BOTH, type: BOTH + 'Dto', optional: true, rest: false, defaultValue: BOTH, decorators: [BOTH], doc: BOTH }],
  returns: { type: BOTH + 'Dto', inferred: true, doc: BOTH },
  types: [{ name: BOTH + 'Dto', kind: BOTH, file: '/w/' + BOTH, line: 0, declaration: BOTH, truncated: true }],
};

module.exports = [
  [
    'hostile text in every message never becomes markup and never runs',
    async () => {
      const view = h.createWebview();
      const surfaces = {};

      // The graph itself: symbol names, file labels, the breadcrumb trail, and the changes-view title, summary and lists.
      view.send({
        command: 'graphData', trail: [BOTH, 'Δ ' + BOTH], cursor: 1, notice: BOTH,
        data: {
          rootFile: '/w/' + BOTH, rootFileId: 'diff:x', rootLabel: 'Δ ' + BOTH, roots: ['a1'], maxDepth: 2, truncated: true, fetchMs: 1, notice: BOTH,
          diff: { source: BOTH, title: BOTH, summary: BOTH, approximate: true, changes: { a1: { kind: 'modified', lines: 1 } }, other: [{ file: '/w/' + BOTH, label: BOTH, note: BOTH, line: 0 }] },
          files: [{ id: 'file:///w/' + BOTH, label: BOTH + '/' + BOTH + '.ts', file: '/w/' + BOTH, symbols: [h.sym('a1', BOTH, 1), h.sym('a2', P, 5)] }],
          edges: [{ id: 'a1>a2', source: 'a1', target: 'a2' }],
        },
      });
      await view.wait(700);
      surfaces['graph, trail, changes view'] = injected(view);

      // Search results.
      const q = view.$('#q');
      q.value = 'x';
      q.dispatchEvent(new view.w.Event('input', { bubbles: true }));
      await view.wait(250);
      view.send({ command: 'searchResults', id: view.lastPosted('search').id, results: [
        { kind: 'method', label: BOTH, detail: BOTH, file: '/w/' + BOTH, line: 0, character: 0 },
        { kind: 'file', label: P, detail: A, file: '/x', line: 0, character: 0 },
      ] });
      await view.wait(50);
      surfaces['search results'] = injected(view);
      q.value = '';
      q.dispatchEvent(new view.w.Event('input', { bubbles: true }));

      // Commit picker.
      view.$('#diffsrc').dispatchEvent(new view.w.MouseEvent('mousedown', { bubbles: true }));
      const commit = { sha: BOTH, subject: BOTH, author: BOTH, when: BOTH };
      view.send({ command: 'diffSources', commits: [commit], summary: { hasHead: true, uncommittedCount: 1, unstagedCount: 1, stagedCount: 1, branchCount: 1, baseBranch: BOTH, commits: [commit] } });
      await view.wait(50);
      surfaces['commit picker'] = injected(view);

      // Signature panel and its error.
      view.click(view.$('#sigbtn'));
      view.click((view.$$('.row')[0] || {}).querySelector && view.$$('.row')[0].querySelector('.rowbg'));
      await view.wait(200);
      const req = view.lastPosted('signature');
      view.send({ command: 'signatureResult', id: req ? req.id : 1, data: signature });
      await view.wait(100);
      surfaces['signature panel'] = injected(view);
      view.send({ command: 'signatureResult', id: req ? req.id : 1, error: BOTH });
      await view.wait(50);
      surfaces['signature error'] = injected(view);

      // AI context.
      view.click(view.$('#ctxbtn'));
      const item = { id: 'a1', file: '/w/' + BOTH, name: BOTH, container: BOTH, line: 1, character: 0, kind: 'method', level: 'signature', resolvedLine: 1, rawFileSize: 100, signature, body: BOTH };
      view.send({ command: 'bucketUpdated', summary: { items: [item, { ...item, id: 'a2', name: P, parentId: 'a1' }], estTokens: 10, rawTokens: 100, markdown: BOTH } });
      await view.wait(100);
      surfaces['AI context'] = injected(view);

      // Errors and loading.
      view.send({ command: 'error', message: BOTH });
      await view.wait(100);
      surfaces['error message'] = injected(view);
      view.send({ command: 'loading' });
      await view.wait(50);
      surfaces['loading'] = injected(view);

      for (const [surface, found] of Object.entries(surfaces)) {
        assert.deepStrictEqual([...new Set(found)], [], `${surface}: injected ${[...new Set(found)].join(', ')}`);
      }
      assert.strictEqual(view.w.__pwned, undefined, 'no injected script ran');
      assert.deepStrictEqual(view.errors, [], 'hostile input must not crash the page either');
    },
  ],
];
