// Read-only audit of current TypeMe scoring; no database, network, or source edits.
// Run from any directory: node docs/2026-09-18-platform-plan/scoring-audit.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(root, 'frontend/package.json'));
const ts = require('typescript');
const compile = path => ts.transpileModule(readFileSync(resolve(root, path), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const url = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const typesUrl = url(compile('frontend/src/domain/jung/types.ts'));
const model = await import(typesUrl);
const scorer = await import(url(compile('frontend/src/domain/jung/scoring.ts').replaceAll("'./types'", JSON.stringify(typesUrl))));
const pkg = JSON.parse(readFileSync(resolve(root, 'backend/src/main/resources/content/typeme-jung48-zh-v1.json'), 'utf8'));
const base = () => new Map(pkg.questions.filter(q => q.stage === 'base').map(q => [q.id, {questionId:q.id, kind:'rating', rating:3}]));
const contribute = (answers, dim, sum, n = 12) => {
  const items = pkg.questions.filter(q => q.stage === 'base' && q.dimension === dim);
  let rest = sum;
  items.forEach((q, i) => {
    if(i >= n) { answers.set(q.id, {questionId:q.id,kind:'unknown'}); return; }
    const c = Math.sign(rest) * Math.min(2, Math.abs(rest)); rest -= c;
    const direction = q.rightPole === model.POSITIVE_POLE[dim] ? 1 : -1;
    answers.set(q.id, {questionId:q.id,kind:'rating',rating:3+c*direction});
  });
  assert.equal(rest, 0);
};
const rows=[];
for(const [n,s] of [[12,1],[12,2],[12,3],[12,4],[9,1]]) {
  const answers=base();
  for(const d of model.DIMENSIONS) contribute(answers,d,d === 'JP' ? s : 12,d === 'JP' ? n : 12);
  const result=scorer.score(pkg,answers,true);
  const dim=result.dimensions.find(d=>d.dimension==='JP');
  rows.push({n,S:s,m:dim.mFinal,originalDesignTrigger:5*Math.abs(s)<=2*n,implementedTrigger:result.clarificationDimensions.includes('JP'),boundary:dim.boundary,status:result.status});
}
assert.equal(rows[1].implementedTrigger,true);
assert.equal(rows[1].status,'REFERENCE');
assert.equal(rows[2].originalDesignTrigger,true);
assert.equal(rows[2].implementedTrigger,false);
assert.equal(rows[4].status,'REFERENCE');
const jp=pkg.questions.find(q=>q.id==='JP-02');
assert.equal(model.contributionOf(jp,1),2);
let mirrorChecks=0;
for(const q of pkg.questions) for(let r=1;r<=5;r++) {
  const swapped={...q,leftPole:q.rightPole,rightPole:q.leftPole};
  assert.ok(model.contributionOf(q,r) === model.contributionOf(swapped,6-r)); mirrorChecks++;
}
const incomplete=base();
incomplete.delete('JP-12');
for(const d of ['EI','SN','TF']) contribute(incomplete,d,1);
const incompleteResult=scorer.score(pkg,incomplete,false);
assert.equal(incompleteResult.status,'NEEDS_REVIEW');
assert.deepEqual(incompleteResult.clarificationDimensions,[]);
console.log(JSON.stringify({packageId:pkg.packageId,sha256:pkg.sha256,contentStatus:pkg.contentStatus,
  mirrorChecks,thresholdCases:rows,
  semanticKeyProbe:{id:jp.id,textLeft:jp.textLeft,leftPole:jp.leftPole,stronglyLeftContribution:model.contributionOf(jp,1),computedPole:'P',note:'Semantic mismatch requires human content review; no production package changed.'},
  incompleteCoverage:{frontendScheduled:incompleteResult.clarificationDimensions,perDimensionNeeds:scorer.checkCoverage(pkg,incomplete).perDimension,javaSourceObservation:'JungScorer.score adds locally eligible dimensions before the global coverage gate; reviewClarification returns empty. No Java differential execution in this script.'}
},null,2));
