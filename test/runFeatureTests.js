// Feature Test Suite Runner
const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');

async function runFeatureTests() {
  const testFiles = [
    path.join(__dirname, 'contextCompressor.test.ts'),
    path.join(__dirname, 'signatureParser.test.ts'),
    path.join(__dirname, 'gitDiffParser.test.ts'),
    path.join(__dirname, 'diffReview.test.ts'),
    path.join(__dirname, 'analysis.test.ts'),
  ];

  const result = await esbuild.build({
    entryPoints: testFiles,
    bundle: true,
    platform: 'node',
    write: false,
    outdir: 'out',
  });

  let totalPassed = 0;
  let totalFailed = 0;

  global.describe = (featureName, fn) => {
    console.log(`\n\x1b[1m\x1b[36m=== ${featureName} ===\x1b[0m`);
    fn();
  };

  global.it = (testName, fn) => {
    try {
      fn();
      console.log(`  \x1b[32m✓\x1b[0m ${testName}`);
      totalPassed++;
    } catch (err) {
      console.error(`  \x1b[31m✗\x1b[0m ${testName}`);
      console.error(err);
      totalFailed++;
    }
  };

  for (const file of result.outputFiles) {
    eval(file.text);
  }

  console.log(`\n\x1b[1m--------------------------------------------------\x1b[0m`);
  console.log(`\x1b[1mTest Results: \x1b[32m${totalPassed} passed\x1b[0m, \x1b[31m${totalFailed} failed\x1b[0m`);
  console.log(`\x1b[1m--------------------------------------------------\x1b[0m\n`);

  if (totalFailed > 0) process.exit(1);
}

runFeatureTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
