// Runs every test/integration/*.test.js. Each file exports a list of [name, async function]; a thrown error fails the test.
// These need `git` on the PATH and take a few seconds: they use real repositories and the real webview bundle.
const fs = require('fs');
const path = require('path');

async function main() {
  const dir = path.join(__dirname, 'integration');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort();
  let passed = 0;
  const failures = [];
  const started = Date.now();

  for (const file of files) {
    console.log(`\n\x1b[1m\x1b[36m=== ${file.replace('.test.js', '')} ===\x1b[0m`);
    for (const [name, run] of require(path.join(dir, file))) {
      const t0 = Date.now();
      try {
        await run();
        passed++;
        console.log(`  \x1b[32m✓\x1b[0m ${name} \x1b[2m(${Date.now() - t0} ms)\x1b[0m`);
      } catch (err) {
        failures.push([`${file}: ${name}`, err]);
        console.log(`  \x1b[31m✗\x1b[0m ${name}`);
        console.log(String((err && err.stack) || err).split('\n').slice(0, 8).map((l) => '      ' + l).join('\n'));
      }
    }
  }

  console.log(`\n\x1b[1mIntegration tests: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failures.length} failed\x1b[0m \x1b[2m(${((Date.now() - started) / 1000).toFixed(1)} s)\x1b[0m\n`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
