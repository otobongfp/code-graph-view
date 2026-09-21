// What a user does in the graph, exercised in the real webview bundle.
const assert = require('assert');
const h = require('./helpers');

async function loaded(data = h.sampleGraph(), extra = {}) {
  const view = h.createWebview();
  view.send(h.graphMessage(data, extra));
  await view.wait(500);
  return view;
}
const rowOf = (view, id) => view.$$('.row').find((r) => r.getAttribute('data-sym') === id);
const names = (view) => view.$$('.row .rname').map((e) => e.textContent).join(',');
const activeRows = (view) => view.$$('.row.active, .sub.active').map((e) => (e.querySelector('.rname, .sname') || {}).textContent);
const setSelect = (view, id, value) => {
  const el = view.$(id);
  el.value = value;
  el.dispatchEvent(new view.w.Event('change', { bubbles: true }));
};

module.exports = [
  [
    'breadcrumbs: Back steps through clicked methods first, Forward replays them, the root crumb clears them',
    async () => {
      const view = await loaded(h.sampleGraph(), { trail: ['a.ts', 'b.ts', 'c.ts'], cursor: 1 });
      const crumbs = () => view.$$('#crumbs .crumb').map((c) => c.textContent).join('|');
      assert.strictEqual(crumbs(), 'a.ts|b.ts|c.ts', 'roots after the current one stay visible');

      view.click(rowOf(view, 'a1').querySelector('.rowbg'));
      await view.wait(300);
      view.click(rowOf(view, 'a2').querySelector('.rowbg'));
      await view.wait(300);
      assert.strictEqual(crumbs(), 'a.ts|b.ts|sendEmail|saveUser|c.ts', 'clicked methods hang off the current root');

      view.click(view.$('#back'));
      await view.wait(300);
      assert.strictEqual(crumbs(), 'a.ts|b.ts|c.ts', 'Back undid the last method, not the whole root');
      assert.strictEqual(view.lastPosted('back'), undefined);
      assert.strictEqual(view.$('#fwd').disabled, false);

      view.click(view.$('#fwd'));
      await view.wait(300);
      assert.strictEqual(crumbs(), 'a.ts|b.ts|sendEmail|saveUser|c.ts', 'Forward replays it');
      assert.strictEqual(view.lastPosted('forward'), undefined);

      view.click(view.$$('#crumbs .crumb').find((c) => c.textContent === 'b.ts'));
      await view.wait(300);
      assert.strictEqual(crumbs(), 'a.ts|b.ts|c.ts', 'the root crumb clears the steps');
      assert.deepStrictEqual(activeRows(view), []);
      assert.strictEqual(view.lastPosted('goTo'), undefined, 'and stays on the same graph');

      view.click(view.$('#back'));
      assert.ok(view.lastPosted('back'), 'with no steps left, Back moves through the roots');
      assert.deepStrictEqual(view.errors, []);
    },
  ],
  [
    'progressive loading: methods appear first, relations stream in, and the final graph is complete',
    async () => {
      const view = h.createWebview();
      const g = h.sampleGraph();
      view.send(h.graphMessage({ ...g, edges: [], files: [g.files[0]] }, { partial: true }));
      await view.wait(400);
      assert.strictEqual(view.$$('.card').length, 1, 'the methods of the file show up straight away');
      assert.strictEqual(view.$$('.edge').length, 0);
      assert.strictEqual(view.$$('.chev').length, 0, 'no relations yet, so nothing to expand');

      view.send(h.graphMessage({ ...g, edges: g.edges.slice(0, 2) }, { partial: true }));
      await view.wait(400);
      assert.strictEqual(view.$$('.card').length, 2);
      assert.strictEqual(view.$$('.edge').length, 2, 'relations arrive while the crawl continues');

      view.send(h.graphMessage(g));
      await view.wait(400);
      assert.strictEqual(view.$$('.edge').length, 3);
      assert.strictEqual(view.$$('.sub').length, 3, 'each caller lists what it calls');
      assert.deepStrictEqual(view.errors, []);
    },
  ],
  [
    'the method you click is lit until you click another or press Esc, and the arrow counts as a click',
    async () => {
      const view = await loaded();
      assert.deepStrictEqual(activeRows(view), []);
      view.click(view.$$('.chev').find((c) => c.getAttribute('data-sym') === 'a2'));
      await view.wait(500);
      assert.deepStrictEqual(activeRows(view), ['saveUser']);
      assert.strictEqual(view.$('#activechip').textContent.includes('saveUser'), true, 'the toolbar shows which method is active');
      assert.strictEqual(view.$$('.card.hasactive').length, 1, 'its card is marked too');

      view.click(rowOf(view, 'a1').querySelector('.rowbg'));
      await view.wait(500);
      assert.deepStrictEqual(activeRows(view), ['sendEmail']);
      assert.ok(view.$$('.row.hashop').length >= 2, 'rows on the traced path show how many calls away they are');
      assert.deepStrictEqual(view.posted.filter((m) => m.command === 'openFile').map((m) => m.file), ['/w/a.ts'], 'clicking opens the file in the editor');

      view.w.document.onkeydown({ key: 'f', target: view.w.document.body });
      assert.strictEqual(view.$$('.row.pulse').length, 1, 'F finds the active method');
      view.w.document.onkeydown({ key: 'Escape', target: view.w.document.body });
      await view.wait(500);
      assert.deepStrictEqual(activeRows(view), []);
      assert.strictEqual(view.$('#activechip'), null);
    },
  ],
  [
    'a language server without call hierarchy shows its notice instead of "may still be loading"',
    async () => {
      const g = h.sampleGraph({ edges: [], notice: 'The language server returned no call information for these methods.' });
      const view = await loaded(g);
      assert.ok(view.$('#statusbar').textContent.includes('no call information'));
      assert.ok(!view.$('#status').textContent.includes('still loading'), 'the misleading hint is replaced');
    },
  ],
  [
    'an error after a graph is showing says so in the status bar',
    async () => {
      const view = await loaded();
      view.send({ command: 'error', message: 'boom happened' });
      await view.wait(100);
      assert.ok(view.$('#status').textContent.includes('boom happened'));
    },
  ],
  [
    'changes view: only changed methods by default; Callers and Callees reveal impact; other changes are listed',
    async () => {
      const g = h.sampleGraph({
        rootFileId: 'diff:uncommitted',
        rootLabel: 'Δ Uncommitted changes',
        roots: ['a1', 'a2'],
        maxDepth: 3,
        files: [
          { id: 'file:///w/a.ts', label: 'a.ts', file: '/w/a.ts', symbols: [h.sym('a1', 'sendEmail', 1), h.sym('a2', 'notify', 9)] },
          { id: 'file:///w/b.ts', label: 'b.ts', file: '/w/b.ts', symbols: [h.sym('b1', 'controller', 1)] },
          { id: 'file:///w/c.ts', label: 'c.ts', file: '/w/c.ts', symbols: [h.sym('c1', 'smtpSend', 1)] },
        ],
        edges: [{ id: 'b1>a1', source: 'b1', target: 'a1' }, { id: 'a1>c1', source: 'a1', target: 'c1' }],
        diff: {
          source: 'uncommitted',
          title: 'Uncommitted changes',
          summary: '2 methods changed in 1 file (1 new)',
          approximate: false,
          changes: { a1: { kind: 'modified', lines: 3 }, a2: { kind: 'added', lines: 5 } },
          other: [
            { file: '/w/util.ts', label: 'util.ts', note: 'changed outside any method', line: 0 },
            { file: '/w/x.md', label: 'x.md', note: 'not a TS/JS source file', line: 0 },
          ],
        },
      });
      const view = await loaded(g);
      assert.strictEqual(names(view), 'sendEmail,notify', 'nothing but the changed methods');
      assert.strictEqual(view.$$('.row.changed').length, 2);
      assert.strictEqual(view.$$('.row.changed.added').length, 1);
      assert.strictEqual(view.$('.dsum').textContent, '2 methods changed in 1 file (1 new)');
      assert.strictEqual(view.$('#show'), null, 'the Callers + callees dropdown is replaced by impact controls');

      setSelect(view, '#impactup', '1');
      await view.wait(500);
      assert.strictEqual(names(view), 'sendEmail,notify,controller');
      setSelect(view, '#impactdown', '1');
      await view.wait(500);
      assert.strictEqual(names(view), 'sendEmail,notify,controller,smtpSend');

      view.click(view.$('#otherbtn'));
      assert.strictEqual(view.$('#otherlist').hidden, false);
      view.click(view.$$('.oth')[0]);
      assert.deepStrictEqual(view.lastPosted('openFile'), { command: 'openFile', file: '/w/util.ts', line: 0, character: 0 });

      view.$('#diffsrc').dispatchEvent(new view.w.MouseEvent('mousedown', { bubbles: true }));
      assert.ok(view.lastPosted('diffSources'), 'opening the picker asks for recent commits');
      view.send({ command: 'diffSources', commits: [{ sha: 'abc1234', subject: 'Fix login', author: 'p', when: '2d ago' }] });
      setSelect(view, '#diffsrc', 'commit:abc1234');
      assert.deepStrictEqual(view.lastPosted('diff'), { command: 'diff', source: 'commit:abc1234' });
      setSelect(view, '#diffsrc', '__exit');
      assert.ok(view.lastPosted('back'));
      assert.deepStrictEqual(view.errors, []);
    },
  ],
  [
    'an empty changes view still shows its controls and says what happened',
    async () => {
      const g = h.sampleGraph({ files: [], edges: [], roots: [], rootFileId: 'diff:staged', rootLabel: 'Δ Staged changes',
        diff: { source: 'staged', title: 'Staged changes', summary: 'No changed methods', approximate: false, changes: {}, other: [] } });
      const view = await loaded(g);
      assert.ok(view.$('#diffsrc'), 'the source picker is still there, so you can choose something else');
      assert.ok(view.$('.emptydiff').textContent.includes('No changed methods'));
    },
  ],
  [
    'signature panel: opt-in, shows inputs, output and types, links types to their cards, and turns off',
    async () => {
      const view = await loaded();
      assert.strictEqual(view.$('#rightdock').hidden, true, 'off by default');
      view.click(view.$('#sigbtn'));
      view.click(rowOf(view, 'a1').querySelector('.rowbg'));
      await view.wait(200);
      const req = view.lastPosted('signature');
      assert.strictEqual(req.file, '/w/a.ts');
      assert.strictEqual(view.$('#sg-body').textContent, 'Loading…');

      const sig = {
        name: 'create', container: 'UserService', kind: 'method', file: '/w/a.ts', line: 12, character: 15,
        decorators: ["@Post('users')"], modifiers: ['public', 'async'], description: 'Creates a user.',
        params: [
          { name: 'dto', type: 'CreateUserDto', optional: false, rest: false, decorators: ['@Body()'], doc: 'the new user' },
          { name: 'notify', type: 'boolean', optional: true, rest: false, defaultValue: 'true', decorators: [], inferred: true },
        ],
        returns: { type: 'Promise<CreateUserDto>', inferred: true, doc: 'the stored user' },
        types: [{ name: 'CreateUserDto', kind: 'interface', file: '/w/user.dto.ts', line: 0, declaration: 'export interface CreateUserDto {\n  name: string;\n}', truncated: false }],
      };
      view.send({ command: 'signatureResult', id: req.id, data: sig });
      await view.wait(50);
      assert.strictEqual(view.$('#sg-title').textContent, 'UserService.create');
      assert.strictEqual(view.$$('.sg-chips .sg-chip').map((c) => c.textContent).join(' '), "@Post('users') public async");
      const params = view.$$('.sg-param');
      assert.ok(params[0].textContent.includes('dto') && params[0].textContent.includes('CreateUserDto') && params[0].textContent.includes('@Body()'));
      assert.ok(params[1].textContent.includes('optional') && params[1].textContent.includes('inferred'));
      assert.ok(params[2].textContent.includes('Promise<CreateUserDto>'), 'the output section');
      assert.strictEqual(view.$('.sg-type b').textContent, 'CreateUserDto');

      view.click(view.$('.tlink'));
      assert.ok(view.$('.sg-type').classList.contains('flash'), 'a type name jumps to its card');
      view.click(view.$('.sg-topen'));
      assert.deepStrictEqual(view.lastPosted('openFile'), { command: 'openFile', file: '/w/user.dto.ts', line: 0, character: 0 });

      view.click(view.$('#sigbtn'));
      assert.strictEqual(view.$('#rightdock').hidden, true);
      const before = view.posted.filter((m) => m.command === 'signature').length;
      view.click(rowOf(view, 'a2').querySelector('.rowbg'));
      await view.wait(100);
      assert.strictEqual(view.posted.filter((m) => m.command === 'signature').length, before, 'no request while it is off');
      assert.deepStrictEqual(view.errors, []);
    },
  ],
  [
    'every toolbar control explains itself, and the legend opens',
    async () => {
      const view = await loaded();
      const controls = view.$$('#toolbar button, #toolbar select');
      const untitled = controls.filter((e) => !(e.title || (e.closest('label') && e.closest('label').title) || e.closest('#zoomctl')));
      assert.deepStrictEqual(untitled.map((e) => e.id), [], 'controls without a tooltip');
      view.click(view.$('#helpbtn'));
      assert.strictEqual(view.$('#legend').hidden, false);
    },
  ],
];
