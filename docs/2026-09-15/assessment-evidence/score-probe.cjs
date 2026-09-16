// Read-only probe: executes the CURRENT domain code against synthetic answers.
// Run from any cwd: node <path>/score-probe.cjs
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../../..');
const ts = require(path.join(root, 'frontend/node_modules/typescript'));
const cache = new Map();
function loadTs(filename) {
  filename = path.resolve(filename);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const source = fs.readFileSync(filename, 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText;
  const localRequire = (specifier) => {
    if (!specifier.startsWith('.')) throw new Error('Unexpected dependency: ' + specifier);
    return loadTs(path.resolve(path.dirname(filename), specifier + '.ts'));
  };
  new Function('require', 'module', 'exports', js)(localRequire, module, module.exports);
  return module.exports;
}
async function main() {
  const { loadQuestionnaire } = await import(pathToFileURL(path.join(root, 'scripts/lib/backend-content.mjs')).href);
  const q = loadQuestionnaire();
  const { scoreQuestionnaire } = loadTs(path.join(root, 'frontend/src/domain/scoring.ts'));
  const uniform = (n) => Object.fromEntries(q.questions.map(x => [x.id, n]));
  const balancedOpposition = {};
  for (const d of ['EI', 'SN', 'TF', 'JP']) {
    q.questions.filter(x => x.dimension === d).forEach((x, i) => {
      balancedOpposition[x.id] = 3 + x.direction * (i < 4 ? 2 : -2);
    });
  }
  const cases = [
    ['all_1', uniform(1), [28, 16, 28, 20], 'ESTJ'],
    ['all_3', uniform(3), [24, 24, 24, 24], 'ISFJ'],
    ['all_5', uniform(5), [20, 32, 20, 28], 'INFP'],
    ['all_3_except_q3_2', {...uniform(3), 3: 2}, [25, 24, 24, 24], 'ESFJ'],
    ['balanced_opposing_endpoints', balancedOpposition, [24, 24, 24, 24], 'ISFJ'],
    ['negative_extreme', Object.fromEntries(q.questions.map(x => [x.id, x.direction === 1 ? 1 : 5])), [8, 8, 8, 8], 'ISFJ'],
    ['positive_extreme', Object.fromEntries(q.questions.map(x => [x.id, x.direction === 1 ? 5 : 1])), [40, 40, 40, 40], 'ENTP'],
  ];
  const scenarios = cases.map(([id, answers, expectedScores, expectedType]) => {
    const result = scoreQuestionnaire(answers, q);
    const scores = result.dimensions.map(x => x.score);
    const passed = JSON.stringify(scores) === JSON.stringify(expectedScores) && result.typeCode === expectedType;
    if (!passed) process.exitCode = 1;
    return {id, passed, answers, scores, typeCode: result.typeCode, clarity: result.dimensions.map(x => x.clarity), neutralCount: Object.values(answers).filter(x => x === 3).length};
  });
  const sourcePaths = ['frontend/src/domain/scoring.ts', 'frontend/src/domain/clarity.ts', 'frontend/src/views/ResultView.vue', 'frontend/src/components/DimensionBar.vue', 'frontend/src/utils/shareImage.ts', 'backend/src/main/resources/content/questionnaire-quick.yml'];
  const hashes = Object.fromEntries(sourcePaths.map(p => [p, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex')]));
  console.log(JSON.stringify({generatedAt: new Date().toISOString(), purpose: 'Engineering arithmetic probe; no estimate of psychological validity or user true type.', questionCount: q.questions.length, hashes, scenarios}, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
