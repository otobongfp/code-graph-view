const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function build(options) {
  const ctx = await esbuild.context(options);
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: !production,
  minify: production,
};

const webviewConfig = {
  entryPoints: ['webview/main.ts'],
  bundle: true,
  outfile: 'out/webview/main.js',
  format: 'iife',
  platform: 'browser',
  loader: { '.css': 'text' },
  target: 'es2020',
  sourcemap: !production,
  minify: production,
};

Promise.all([build(extensionConfig), build(webviewConfig)]).catch((err) => {
  console.error(err);
  process.exit(1);
});
