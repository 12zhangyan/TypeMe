#!/usr/bin/env node
/**
 * TypeMe 新测（登录版十六型人格测评站）端到端验收 —— 真实 HTTP 实跑。
 *
 * 为什么要有这个脚本：单元/集成测试走的是 MockMvc（不经过真实 Tomcat、真实 cookie
 * jar、真实序列化边界）。这个脚本对**打包后的 jar**发真实 HTTP，把"能跑起来"
 * 从"测试是绿的"变成"外部客户端确实走完了一整遍"。
 *
 * 覆盖：未登录 401 → CSRF → 注册 → /me → 目录 → 建测评 → 取 48 题 →
 *       批量作答 → review 覆盖检查 → 提交 → 报告字段（hash/四维/8段/3建议/cost）→
 *       报告列表 → 自我理解不覆盖问卷结论 → 导出 → 二次提交被拒 → 删报告 →
 *       旧引擎仍可用 → SPA 入口 → 登出
 *
 * 用法：node docs/2026-09-16/verification/run-e2e-smoke.mjs --base http://127.0.0.1:8099
 */

import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  if (hit.includes('=')) return hit.split('=').slice(1).join('=');
  return argv[argv.indexOf(hit) + 1] ?? fallback;
}

const BASE = arg('base', 'http://127.0.0.1:8099').replace(/\/$/, '');
const USERNAME = arg('username', `e2e_${Date.now().toString(36)}`);
const PASSWORD = arg('password', 'E2e-Passw0rd!2026');
const OUTFILE = arg('out', '');

/* ── cookie jar：真实会话状态，跨请求保持 ─────────────────────────────── */
const jar = new Map();
function storeCookies(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const line of raw) {
    const [pair] = line.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
function csrfToken() {
  const raw = jar.get('XSRF-TOKEN');
  return raw ? decodeURIComponent(raw) : null;
}

const steps = [];
let failures = 0;
/** 内容包 sha256，用于在落盘结果里证明内容播种正确。 */
let packageSha256 = null;

async function request(method, path, body) {
  const headers = { Cookie: cookieHeader() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = csrfToken();
  if (token && method !== 'GET') headers['X-XSRF-TOKEN'] = token;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  storeCookies(res);

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 非 JSON（例如 index.html），保持 null */
  }
  return { status: res.status, json, text, headers: res.headers };
}

/** 断言式步骤：失败即抛，由 step() 记为 FAIL 并终止。 */
async function step(name, fn) {
  try {
    const detail = await fn();
    // detail 既当"给人看的说明"也当"给后续步骤用的值"。为了让后者能用，
    // 用 { message, value } 的写法：message 上控制台，value 返回给调用方。
    // 只用字符串的话 value 就是那句说明本身 —— 早期版本因此踩过
    // "registration.userId === undefined" 的坑（字符串上没有 userId 字段）。
    const message = isMessage(detail) ? detail.message : detail ?? '';
    const value = isMessage(detail) ? detail.value : detail;
    steps.push({ step: name, result: 'PASS', detail: message });
    console.log(`  [PASS] ${name}${message ? ` -- ${message}` : ''}`);
    return value;
  } catch (err) {
    failures += 1;
    steps.push({ step: name, result: 'FAIL', detail: err.message });
    console.log(`  [FAIL] ${name} -- ${err.message}`);
    throw err;
  }
}

function isMessage(v) {
  return v !== null && typeof v === 'object' && typeof v.message === 'string' && 'value' in v;
}

/** 步骤既要在日志里显示一句说明，又要把结构化结果交给后续步骤时用这个。 */
function ok(message, value) {
  return { message, value };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** 从 cookie 里取 CSRF token（服务端下发什么就是什么，不自己编）。 */
async function refreshCsrf() {
  const r = await request('GET', '/api/v3/auth/csrf');
  assert(r.status === 200, `csrf 端点返回 HTTP ${r.status}`);
  assert(csrfToken(), '响应里没有 XSRF-TOKEN cookie');
  return csrfToken();
}

console.log(`== TypeMe E2E 冒烟：${BASE} ==`);
console.log(`   账号：${USERNAME}`);
console.log('');

try {
  /* 1. 未登录必须拒绝 —— 这是"受保护资源确实受保护"的基线 */
  await step('未登录 GET /api/v3/me 返回 401', async () => {
    const r = await request('GET', '/api/v3/me');
    assert(r.status === 401, `期望 401，实际 ${r.status}`);
    return `HTTP 401 [${r.json?.code}]`;
  });

  await step('GET /api/v3/auth/csrf 下发 token', async () => {
    const t = await refreshCsrf();
    return `token 长度 ${t.length}`;
  });

  /* 2. 注册。
   *
   * ⚠️ 原先这里带 `disclaimerAccepted: true`，我还在注释里断言"未同意免责声明不给注册"。
   * 那是**我写错了**：注册接口的 `RegisterRequest` 里没有这个字段，全仓也没有任何地方
   * 读 `disclaimer`，它是个被静默忽略的多余键。浏览器验收实测：注册页 DOM 里
   * `input[type=checkbox]` 数量为 0、页面无任何免责声明文案，不勾任何东西也能注册成功。
   * 也就是说"必须显式同意免责声明"这条产品要求**目前没有实现**（前端无此项、后端不校验），
   * 已记入验收证据的未实现项。这里不再发那个字段，以免暗示它有意义。
   */
  const registration = await step(`注册账号 ${USERNAME}`, async () => {
    const r = await request('POST', '/api/v3/auth/register', {
      username: USERNAME,
      password: PASSWORD,
    });
    assert(r.status === 200 || r.status === 201, `HTTP ${r.status} ${r.text.slice(0, 200)}`);
    // 字段是**顶层** userId/username（不是嵌在 user 里）。这里必须断言存在，
    // 否则 `${r.json?.user?.id}` 只是拼出一个 undefined 字符串，步骤照样"通过"。
    assert(r.json?.userId, `注册响应里没有 userId（顶层键：${Object.keys(r.json ?? {}).join(',')}）`);
    assert(r.json.recoveryCodes?.length > 0, '注册响应里没有恢复码 —— 那是账号找回的唯一凭据');
    return ok(`userId=${r.json.userId} 恢复码 ${r.json.recoveryCodes.length} 个`, {
      userId: r.json.userId,
      recoveryCodes: r.json.recoveryCodes,
    });
  });

  /* 3. 登录后会话必须真的可用 —— 这正是"已登录接口全部 401"那个缺陷的验收点 */
  await step('登录后 GET /api/v3/me 返回本人', async () => {
    const r = await request('GET', '/api/v3/me');
    assert(r.status === 200, `HTTP ${r.status} ${r.text.slice(0, 200)}`);
    assert(r.json?.username === USERNAME, `用户名不匹配：${r.json?.username}`);
    // /me 返回的 userId 必须与注册时一致，且**不能等于用户名** ——
    // 这正是"把 username 当 userId 用"那个真实缺陷的验收点。
    assert(r.json.userId, '/me 响应里没有 userId');
    assert(
      r.json.userId === registration.userId,
      `/me 的 userId(${r.json.userId}) 与注册时(${registration.userId})不一致`,
    );
    assert(
      r.json.userId !== USERNAME,
      `userId 竟然等于用户名（${USERNAME}）—— 说明主体没有携带真实主键`,
    );
    return `username=${r.json.username} userId=${r.json.userId}`;
  });

  /* 4. 目录：新测必须存在，且题数/维度结构对得上 */
  const catalog = await step('GET /api/v3/catalog/current 返回新测目录', async () => {
    const r = await request('GET', '/api/v3/catalog/current');
    assert(r.status === 200, `HTTP ${r.status}`);
    const c = r.json;
    assert(c.packageId === 'typeme-jung48-zh-v1', `packageId=${c.packageId}`);
    // questionCount 是**题库总量**（48 基础 + 16 补充），不是每次作答要答的题数。
    assert(c.questionCount === 64, `questionCount=${c.questionCount}，期望 64（48 基础 + 16 补充）`);
    assert(c.basePerDimension === 12, `basePerDimension=${c.basePerDimension}，期望 12`);
    assert(c.contentStatus === 'draft_review_pending', `contentStatus=${c.contentStatus}`);
    const dims = (c.dimensions ?? []).map((d) => d.dimension).join(',');
    assert(dims === 'EI,SN,TF,JP', `维度顺序=${dims}`);
    // 记下内容包哈希：它证明这次运行连的库**内容播种正确**。
    // 只记库名是不够的 —— 库名可以随便取，哈希对不上就说明内容不是这一份。
    packageSha256 = c.sha256 ?? null;
    return `${c.packageId} 题库=${c.questionCount}（48 基础 + 16 补充） 每维基础题=${c.basePerDimension} 维度=${dims} 状态=${c.contentStatus} sha256=${String(packageSha256 ?? '').slice(0, 12)}…`;
  });
  assert(catalog, '目录步骤失败');
  void catalog;

  /* 5. 建测评 + 取内容包 */
  const attempt = await step('POST /api/v3/attempts 建测评', async () => {
    const r = await request('POST', '/api/v3/attempts', {});
    assert(r.status === 200 || r.status === 201, `HTTP ${r.status} ${r.text.slice(0, 200)}`);
    assert(r.json?.attemptId, '响应里没有 attemptId');
    return r.json;
  });
  const attemptId = attempt.attemptId;

  const detail = await step('GET /api/v3/attempts/{id} 取到 48 道基础题 + 16 道补充题', async () => {
    const r = await request('GET', `/api/v3/attempts/${attemptId}`);
    assert(r.status === 200, `HTTP ${r.status}`);
    const d = r.json;
    const qs = d.packageContent?.questions ?? [];
    const byStage = {};
    for (const q of qs) byStage[q.stage] = (byStage[q.stage] ?? 0) + 1;
    // packageContent 返回的是**整份内容包**（基础 + 补充都要给前端，因为补充题要按需展示），
    // 所以这里断言的是两个 stage 的数量，而不是"总数等于 48"。
    assert(byStage.base === 48, `base 阶段题数=${byStage.base}，期望 48`);
    assert(byStage.clarification === 16, `clarification 阶段题数=${byStage.clarification}，期望 16`);
    assert(d.revision === 0, `新测评的 revision 应为 0，实际 ${d.revision}`);
    return { revision: d.revision, questions: qs.filter((q) => q.stage === 'base') };
  });
  const questions = detail.questions;

  /* 6. 作答。
   * 关键：题目是**极性镜像**的（同一维里有的 leftPole 是负极、有的是正极），
   * 所以"全填 5"会得到 S=0，不能靠它制造明确偏向。这里按 rightPole 是否等于
   * 该维正极来决定给 5 还是 1，于是每一维都稳定偏向目标 E/N/F/P。 */
  const positivePole = { EI: 'E', SN: 'N', TF: 'F', JP: 'P' };
  const responses = questions.map((q) => ({
    questionId: q.id,
    kind: 'rating',
    // rightPole 是正极 → 5 分（强烈同意右侧）；否则 1 分（强烈同意左侧）
    rating: q.rightPole === positivePole[q.dimension] ? 5 : 1,
  }));

  await step('PATCH /answers 批量提交 48 题作答', async () => {
    const r = await request('PATCH', `/api/v3/attempts/${attemptId}/answers`, {
      expectedRevision: detail.revision,
      responses,
    });
    assert(r.status === 200, `HTTP ${r.status} ${r.text.slice(0, 300)}`);
    return `revision=${r.json.revision} status=${r.json.status}`;
  });

  /* 7. review：四维覆盖必须都够（每维 RATING ≥ 9） */
  const review = await step('POST /attempts/{id}/review 预检覆盖', async () => {
    const r = await request('POST', `/api/v3/attempts/${attemptId}/review`);
    assert(r.status === 200, `HTTP ${r.status} ${r.text.slice(0, 300)}`);
    return r.json;
  });

  await step('review 显示四维 RATING 覆盖均 ≥ 9', async () => {
    const cov = review.coverage ?? [];
    assert(cov.length === 4, `维度数=${cov.length}`);
    const bad = cov.filter((c) => c.baseRatingCount < 9);
    assert(bad.length === 0, `覆盖不足：${bad.map((b) => `${b.dimension}=${b.baseRatingCount}`).join(',')}`);
    return cov.map((c) => `${c.dimension}=${c.baseRatingCount}`).join(' ');
  });

  /* 8. 提交 */
  const submit = await step('POST /attempts/{id}/submit 提交并生成报告', async () => {
    const r = await request('POST', `/api/v3/attempts/${attemptId}/submit`, {});
    assert(r.status === 200 || r.status === 201, `HTTP ${r.status} ${r.text.slice(0, 300)}`);
    return r.json;
  });
  console.log(`         状态=${submit.status} 类型=${submit.computedTypeCode}`);

  await step('提交后状态属于四种之一', async () => {
    const ok = ['REFERENCE', 'TENTATIVE', 'TIED', 'NEEDS_REVIEW'];
    assert(ok.includes(submit.status), `未知状态 ${submit.status}`);
    return submit.status;
  });

  /* 9. 报告详情 —— 契约里所有关键字段都要在
   *
   * 注意形状：GET /reports/{id} 返回的是**信封**
   *   { report: {...报告本体...}, selfReflection, attemptId, attemptRevision }
   * 报告本体在 .report 里。这里必须显式校验信封里确实有 report，
   * 否则下面所有 doc.xxx 都会是 undefined，断言会退化成
   * "undefined === undefined" 而**假通过** —— 这个坑在本脚本上真实发生过。
   */
  const detailEnvelope = await step('GET /reports/{id} 取报告（含 reportHash）', async () => {
    const r = await request('GET', `/api/v3/reports/${submit.reportId}`);
    assert(r.status === 200, `HTTP ${r.status} ${r.text.slice(0, 300)}`);
    assert(r.json?.report, `响应里没有 report 字段（顶层键：${Object.keys(r.json ?? {}).join(',')}）`);
    assert(r.json.report.reportHash, '报告里没有 reportHash');
    return r.json;
  });
  const report = detailEnvelope.report;

  await step('REFERENCE/TENTATIVE 时类型码等于目标 ENFP', async () => {
    if (submit.status === 'NEEDS_REVIEW' || submit.status === 'TIED') {
      return `跳过（状态 ${submit.status}，本步不适用）`;
    }
    assert(report.computedTypeCode === 'ENFP', `期望 ENFP，实际 ${report.computedTypeCode}`);
    return `computedTypeCode=${report.computedTypeCode}`;
  });

  await step('报告含四维、position ∈ 0..1、两端标签齐备', async () => {
    const dims = report.dimensions ?? [];
    assert(dims.length === 4, `维度数=${dims.length}`);
    assert(dims.map((d) => d.dimension).join(',') === 'EI,SN,TF,JP', `顺序=${dims.map((d) => d.dimension)}`);
    for (const d of dims) {
      assert(typeof d.position === 'number' && d.position >= 0 && d.position <= 1, `${d.dimension} position=${d.position} 越界`);
      assert(d.negativeLabel && d.positiveLabel, `${d.dimension} 缺两端标签`);
    }
    return dims.map((d) => `${d.dimension}=${d.position.toFixed(3)}`).join(' ');
  });

  await step('报告含 8 段解读 + 恰好 3 条 nextActions', async () => {
    const secs = report.typeSections ?? [];
    const acts = report.nextActions ?? [];
    assert(secs.length === 8, `段落数=${secs.length}`);
    assert(acts.length === 3, `行动建议数=${acts.length}`);
    return `段落=${secs.length} 行动=${acts.length}`;
  });

  await step('报告不含概率/准确率类禁用措辞（cost 只是"证据偏离"）', async () => {
    const banned = ['准确率', '概率', '百分位', '置信', '确诊', '命中注定', '科学证明'];
    const json = JSON.stringify(report);
    const hit = banned.filter((w) => json.includes(w));
    assert(hit.length === 0, `出现禁用措辞：${hit.join('、')}`);
    const cands = report.candidates ?? [];
    return `候选=${cands.length} 条，首条 cost=${cands[0]?.cost}`;
  });

  await step('分享三件套齐备（text/alt/filename）', async () => {
    const s = report.share;
    assert(s, '没有 share');
    assert(s.text && s.alt && s.filename, `share 缺字段：${Object.keys(s)}`);
    return `filename=${s.filename}`;
  });

  await step('报告带 methodology 与"非诊断"声明', async () => {
    assert(report.methodology, '没有 methodology');
    const fields = Object.keys(report.methodology).length;
    const json = JSON.stringify(report);
    const hasDisclaimer = json.includes('诊断') || json.includes('参考');
    assert(hasDisclaimer, '报告里找不到"参考/诊断"类声明');
    return `methodology 字段数=${fields}`;
  });

  /* 10. 自我理解不得覆盖问卷结论 */
  await step('PUT 自我理解后问卷结论不变（自我理解只是补充）', async () => {
    const put = await request('PUT', `/api/v3/reports/${submit.reportId}/self-reflection`, {
      selfSelectedTypeCode: report.computedTypeCode ?? 'INFJ',
      note: 'E2E 冒烟：我自己觉得更像另一个类型',
    });
    assert(put.status === 200, `HTTP ${put.status} ${put.text.slice(0, 200)}`);
    // PUT 的响应体就是 SelfReflectionView 本身（不带信封）。
    assert(put.json?.selfSelectedTypeCode, `PUT 响应里没有 selfSelectedTypeCode：${put.text.slice(0, 200)}`);

    const after = await request('GET', `/api/v3/reports/${submit.reportId}`);
    assert(after.json?.report, '再次取报告时响应里没有 report');
    // 自我理解在外层（与 report 平级），不是埋在报告本体里 —— 这个分层本身就是
    // "自我理解不改写问卷结论"的体现。
    const reflection = after.json.selfReflection;
    assert(reflection, '自我理解没保存（响应里没有 selfReflection）');
    assert(
      after.json.report.computedTypeCode === report.computedTypeCode,
      `自我理解把问卷结论改了：${report.computedTypeCode} -> ${after.json.report.computedTypeCode}`,
    );
    return `问卷结论=${after.json.report.computedTypeCode}（未变） 自我理解=${reflection.selfSelectedTypeCode}`;
  });

  await step('GET /api/v3/reports 列表含刚生成的报告', async () => {
    const r = await request('GET', '/api/v3/reports');
    assert(r.status === 200, `HTTP ${r.status}`);
    const items = r.json?.items ?? r.json?.reports ?? [];
    const one = items.find((x) => (x.reportId ?? x.id) === submit.reportId);
    assert(one, '列表里没有刚生成的报告');
    return `列表 ${items.length} 份`;
  });

  /* 11. 导出：账号数据可带走 */
  await step('GET /api/v3/me/export 能导出账号数据', async () => {
    const r = await request('GET', '/api/v3/me/export');
    assert(r.status === 200, `HTTP ${r.status} ${r.text.slice(0, 200)}`);
    assert(r.text.length > 200, `导出仅 ${r.text.length} 字节，可疑`);
    return `${(r.text.length / 1024).toFixed(1)} KB`;
  });

  /* 12. 报告不可变：二次提交必须**幂等**，不能产生第二份报告
   *
   * 注意这里断言的不是"第二次提交被拒绝"：服务端的设计是重复提交返回同一份报告
   * （一份 attempt 只对应一份报告），所以 HTTP 200 是正确行为 —— 我第一版脚本
   * 在这里断言 4xx，属于把"幂等"误判成"必须报错"。
   * 真正要守住的是"报告不可变"：第二次提交不能产生第二份报告、不能改动已有报告。
   */
  await step('二次提交幂等：不产生第二份报告、reportHash 不变', async () => {
    const r = await request('POST', `/api/v3/attempts/${attemptId}/submit`, {});
    assert(r.status === 200, `HTTP ${r.status} ${r.text.slice(0, 200)}`);
    assert(
      r.json?.reportId === submit.reportId,
      `二次提交返回了不同的 reportId：${submit.reportId} -> ${r.json?.reportId}（报告被重建了）`,
    );

    const list = await request('GET', '/api/v3/reports');
    const items = list.json?.items ?? list.json?.reports ?? [];
    assert(items.length === 1, `二次提交后应有且仅有 1 份报告，实际 ${items.length} 份`);

    const again = await request('GET', `/api/v3/reports/${submit.reportId}`);
    assert(
      again.json?.report?.reportHash === report.reportHash,
      `reportHash 变了：${report.reportHash} -> ${again.json?.report?.reportHash}（报告被改写了）`,
    );
    return `reportId 不变；报告仍 1 份；reportHash 未变`;
  });

  /* 13. 旧引擎不得被新测破坏（任务硬要求） */
  await step('旧只读量表端点仍可用', async () => {
    const a = await request('GET', '/api/v1/meta');
    const b = await request('GET', '/api/v2/assessment-packages/ipip50-zh1');
    assert(a.status === 200, `v1/meta HTTP ${a.status}`);
    assert(b.status === 200, `v2 包 HTTP ${b.status}`);
    return `v1/meta=${a.status} v2/package=${b.status}`;
  });

  await step('前端 SPA 入口可访问', async () => {
    const r = await request('GET', '/');
    assert(r.status === 200, `HTTP ${r.status}`);
    assert(r.text.includes('id="app"'), '首页不是前端 SPA');
    return `HTTP 200，${r.text.length} 字节`;
  });

  /* 14. 删报告：真实物理删除 */
  await step('DELETE /reports/{id} 后取不到该报告', async () => {
    const del = await request('DELETE', `/api/v3/reports/${submit.reportId}`);
    assert(del.status === 200 || del.status === 204, `HTTP ${del.status} ${del.text.slice(0, 200)}`);
    const after = await request('GET', `/api/v3/reports/${submit.reportId}`);
    assert(after.status !== 200, `删除后仍能取到（HTTP ${after.status}）`);
    return `删除后 GET 返回 HTTP ${after.status}`;
  });

  /* 15. 登出后会话失效 */
  await step('POST /auth/logout 后 /me 变 401', async () => {
    const out = await request('POST', '/api/v3/auth/logout');
    assert(out.status === 200 || out.status === 204, `logout HTTP ${out.status}`);
    const me = await request('GET', '/api/v3/me');
    assert(me.status === 401, `登出后期望 401，实际 ${me.status}`);
    return 'HTTP 401';
  });
} catch (err) {
  console.log('');
  console.log(`已中止后续步骤：${err.message}`);
}

/* ── 汇总 ──────────────────────────────────────────────────────────────── */
const passed = steps.filter((s) => s.result === 'PASS').length;
console.log('');
console.log('===== E2E 结果汇总 =====');
for (const s of steps) {
  console.log(`  ${s.result === 'PASS' ? 'PASS' : 'FAIL'}  ${s.step}${s.detail ? ` -- ${s.detail}` : ''}`);
}
console.log('');
console.log(`步骤 ${steps.length} 项：PASS ${passed} / FAIL ${failures}`);
console.log(`账号 ${USERNAME} 在库 ${BASE} 上跑完`);

if (OUTFILE) {
  // 落盘时带上环境信息，让这份结果**可审计**：
  // 没有环境记录的"全部通过"在几周后无法判断它到底验证了什么 ——
  // 尤其是数据库是哪一个、跑的是哪个 jar、Node 哪个版本。
  writeFileSync(
    OUTFILE,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        base: BASE,
        username: USERNAME,
        node: process.version,
        packageSha256,
        steps,
        failures,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`已写 ${OUTFILE}`);
}
process.exit(failures > 0 ? 1 : 0);
