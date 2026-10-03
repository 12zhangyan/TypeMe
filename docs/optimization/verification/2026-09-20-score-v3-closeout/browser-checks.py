"""限制范围内的浏览器验证：v3 新边界 / 旧版同答卷快照 / TIED / NEEDS_REVIEW 在 320、390、1440 的呈现。

所有 `/api/**` 都在浏览器层被拦截：**没有数据库、没有后端、没有真实 AI 调用**。
报告 JSON 由生产计分器与报告构造器生成（`JungReportCopyBaselineTest#writeBrowserFixtures`
写到 `backend/target/score-v3-browser-fixtures/`），所以页面上看到的就是服务端会发的那份数据。

前置：
  1. `mvn -q test -Dtest=JungReportCopyBaselineTest`（生成报告夹具）
  2. 前端构建到**隔离目录**（不覆盖 `frontend/dist`）：
     `npx vite build --outDir %TEMP%/typeme-v3-verify-dist --emptyOutDir`
  3. 静态服务器：`python -m http.server 5179 --directory %TEMP%/typeme-v3-verify-dist`

用法：python scripts/browser-verify-score-v3.py
"""
import json
import os
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(os.environ['TYPEME_SNAPSHOT'])
OUT = ROOT / os.environ.get(
    'TYPEME_BROWSER_EVIDENCE', 'docs/2026-09-16/implementation/verification/2026-09-18-score-v3')
FIXTURES = ROOT / 'backend/target/score-v3-browser-fixtures'
BASE = os.environ.get('TYPEME_BROWSER_BASE', 'http://127.0.0.1:5179')
OUT.mkdir(parents=True, exist_ok=True)

reports = {path.stem: json.loads(path.read_text(encoding='utf-8')) for path in FIXTURES.glob('*.json')}
assert {'v3-boundary', 'v1-same-answers', 'v3-tied'} <= reports.keys(), sorted(reports)

# 报告夹具必须是**当前源码**生成的：踩过一次坑 —— 做"把 v3 换成 v2 报告文案"的变异验证时，
# 那次跑测试顺带用变异后的源码覆盖了这些夹具；若不再重新生成，浏览器验收会拿着过期数据通过
# （而且照样全绿）。所以这里显式断言每份夹具自报的版本，宁可当场红，也不要"验的是另一版"。
# `v1-same-answers` 是**故意**用旧包（score-v1）生成的：它就是"旧版同答卷的历史快照"，
# 但它的报告文案同样必须是 v1 —— 两版共用同一份文案正是本次要证明的事。
EXPECTED_VERSIONS = {
    'v3-boundary': ('typeme-jung48-score-v3', 'typeme-type-report-zh-v1'),
    'v3-tied': ('typeme-jung48-score-v3', 'typeme-type-report-zh-v1'),
    'v1-same-answers': ('typeme-jung48-score-v1', 'typeme-type-report-zh-v1'),
}
for name, report in reports.items():
    methodology = report['methodology']
    expected = EXPECTED_VERSIONS.get(name)
    assert expected is not None, f'{name} 不在预期的夹具清单里：{sorted(EXPECTED_VERSIONS)}'
    assert methodology['scoringVersion'] == expected[0], (
        f'{name}.json 的计分版本是 {methodology["scoringVersion"]}，期望 {expected[0]}')
    assert methodology['reportContentVersion'] == expected[1], (
        f'{name}.json 的报告文案版本是 {methodology["reportContentVersion"]}，期望 {expected[1]}：'
        ' 夹具过期了，先重新运行 mvn test -Dtest=JungReportCopyBaselineTest')

# 覆盖不足的那一份**不应该存在**（服务端不会为它落报告），所以用 404 模拟"没有报告"。
NEEDS_REVIEW_ID = 'needs-review'
assert NEEDS_REVIEW_ID not in reports, '覆盖不足的答卷不该有报告文件'
checks = []
errors = []
unexpected = []


def check(ok, label):
    checks.append({'label': label, 'passed': bool(ok)})
    if not ok:
        raise AssertionError(label)


def report_api(path):
    """按 reportId 返回报告；未定义的 id 一律 404（页面必须走"没有报告"分支）。"""
    report_id = path.split('/')[-1]
    if report_id in reports:
        return 200, {'report': reports[report_id], 'selfReflection': {},
                     'attemptId': 'synthetic-attempt', 'attemptRevision': 1}
    if report_id == NEEDS_REVIEW_ID:
        return 404, {'code': 'NOT_FOUND', 'message': '覆盖不足，没有生成报告'}
    return 404, {'code': 'NOT_FOUND', 'message': '页面验收未定义此报告'}


def api(route):
    path = urlparse(route.request.url).path
    status, body = 200, {}
    if path == '/api/v3/me':
        body = {'userId': 'synthetic', 'username': '页面验收示例', 'nickname': '演示用户'}
    elif path == '/api/v3/platform/instruments':
        body = {'items': []}
    elif path == '/api/v3/attempts':
        body = {'items': [], 'page': 0, 'size': 20, 'total': 0}
    elif path == '/api/v3/catalog/current':
        # 报告页用它拼"重新测一次"的入口；这里报的就是当前默认包（v3）。
        body = {'packageId': 'typeme-jung48-zh-v3', 'questionCount': 48, 'basePerDimension': 12,
                'title': '十六型人格参考测评', 'dimensions': []}
    elif path == '/api/v3/ai/status':
        # AI 关掉：本次验证的是固定报告与状态标签，不掺 AI 摘要。
        body = {'enabled': False, 'mock': True, 'model': 'mock', 'dailyLimitPerUser': 2,
                'remainingToday': 2, 'apiKeySource': 'none', 'promptVersion': 'typeme-ai-prompt-v3'}
    elif path.endswith('/analyses') and path.startswith('/api/v3/reports/'):
        body = {'items': []}
    elif path.startswith('/api/v3/platform/reports/'):
        status, body = report_api(path)
    elif path.startswith('/api/v3/reports/'):
        status, body = report_api(path)
    elif path.startswith('/api/v3/admin/'):
        status, body = 403, {'code': 'FORBIDDEN', 'message': '非管理员示例'}
    elif path in ('/api/v1/meta', '/api/v2/assessment-packages/ipip50-zh1'):
        status, body = 503, {'code': 'NOT_CONFIGURED', 'message': '旧内容使用内置副本'}
    else:
        unexpected.append(path)
        status, body = 404, {'code': 'NOT_FOUND', 'message': '页面验收未定义此接口'}
    route.fulfill(status=status, content_type='application/json', body=json.dumps(body, ensure_ascii=False))


def no_overflow(page, label):
    result = page.evaluate('''() => ({width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth})''')
    check(result['scroll'] <= result['width'] + 1,
          f'{label}: no horizontal overflow (scroll {result["scroll"]} <= {result["width"]} + 1)')


def in_viewport(page, locator, label):
    """元素真的有布局盒、有尺寸、横向不越界。

    为什么不用"看截图"：截图是给人看的证据，机器验收需要能自动判定的条件。
    这三条一起能挡住最常见的问题：元素被折叠/隐藏、宽度塌成 0、在窄屏下溢出右边界。
    """
    check(locator.count() >= 1, f'{label}: 元素存在')
    locator.first.scroll_into_view_if_needed()
    box = locator.first.bounding_box()
    check(box is not None, f'{label}: 元素有布局盒（不是 display:none / 未挂载）')
    check(box['width'] > 0 and box['height'] > 0,
          f'{label}: 元素有可见尺寸（{box["width"]:.0f}×{box["height"]:.0f}）')
    width = page.evaluate('document.documentElement.clientWidth')
    check(box['x'] >= -1 and box['x'] + box['width'] <= width + 1,
          f'{label}: 横向落在视口内（x={box["x"]:.0f}, w={box["width"]:.0f}, 视口={width}）')


def open_report(page, report_id):
    page.goto('about:blank')
    page.goto(f'{BASE}/#/reports/{report_id}')


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        for width in (320, 390, 1440):
            context = browser.new_context(viewport={'width': width, 'height': 900}, device_scale_factor=1)
            def local_only(route):
                if route.request.url.startswith(BASE + '/'):
                    route.continue_()
                else:
                    unexpected.append('external request blocked')
                    route.abort()
            context.route('**/*', local_only)
            context.route('**/api/**', api)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))

            # ── v3 新边界：TENTATIVE + 参考类型 + 候选 ──────────────────────────
            open_report(page, 'v3-boundary')
            page.locator('[data-report-overview]').wait_for()
            overview = page.locator('[data-report-overview]')
            check(overview.get_attribute('data-status') == 'TENTATIVE',
                  f'{width}/v3-boundary: 状态徽标是 TENTATIVE')
            check('倾向较轻' in page.locator('[data-status-note]').inner_text()
                  or '差距很小' in page.locator('[data-status-note]').inner_text(),
                  f'{width}/v3-boundary: 现状说明写明"差距小、不算确定"')
            code = page.locator('[data-type-code]')
            check(code.count() == 1 and code.inner_text().strip() == 'ENFP',
                  f'{width}/v3-boundary: 仍给出参考类型 ENFP')
            candidates = page.locator('[data-candidate]')
            check(candidates.count() == 2, f'{width}/v3-boundary: 列出 2 个候选（含方向本身）')
            codes = sorted(candidates.evaluate_all('(nodes) => nodes.map((n) => n.dataset.candidate)'))
            check(codes == ['ENFP', 'INFP'], f'{width}/v3-boundary: 候选是 ENFP/INFP，实测 {codes}')
            check(page.locator('[data-boundary-note]').count() >= 1,
                  f'{width}/v3-boundary: 标出"差距小"的那一维')
            check(page.locator('[data-plain-report]').count() >= 1,
                  f'{width}/v3-boundary: 固定报告正文在（AI 关闭不影响）')
            in_viewport(page, page.locator('[data-status-note]'), f'{width}/v3-boundary: 状态说明')
            in_viewport(page, code, f'{width}/v3-boundary: 参考类型')
            in_viewport(page, candidates, f'{width}/v3-boundary: 候选列表')
            no_overflow(page, f'{width}/v3-boundary')
            page.screenshot(path=str(OUT / f'v3-boundary-{width}.png'), full_page=True)
            page.locator('#report-candidates').screenshot(path=str(OUT / f'v3-boundary-candidates-{width}.png'))

            # ── 旧版同答卷：REFERENCE、不给候选（历史快照口径） ────────────────
            open_report(page, 'v1-same-answers')
            page.locator('[data-report-overview]').wait_for()
            overview = page.locator('[data-report-overview]')
            check(overview.get_attribute('data-status') == 'REFERENCE',
                  f'{width}/v1-same-answers: 旧版同答卷仍是 REFERENCE')
            check('都有偏向' in page.locator('[data-status-note]').inner_text(),
                  f'{width}/v1-same-answers: 现状说明是"四面都有偏向"')
            check(page.locator('[data-type-code]').inner_text().strip() == 'ENFP',
                  f'{width}/v1-same-answers: 参考类型 ENFP')
            check(page.locator('[data-candidate]').count() == 0,
                  f'{width}/v1-same-answers: 不确定时才列候选，这里不该有')
            check(page.locator('[data-boundary-note]').count() == 0,
                  f'{width}/v1-same-answers: 没有"差距小"的维')
            in_viewport(page, page.locator('[data-status-note]'), f'{width}/v1-same-answers: 状态说明')
            in_viewport(page, page.locator('[data-type-code]'), f'{width}/v1-same-answers: 参考类型')
            no_overflow(page, f'{width}/v1-same-answers')
            page.screenshot(path=str(OUT / f'v1-same-answers-{width}.png'), full_page=True)

            # ── TIED：不给四字母，候选并列 ────────────────────────────────────
            open_report(page, 'v3-tied')
            page.locator('[data-report-overview]').wait_for()
            overview = page.locator('[data-report-overview]')
            check(overview.get_attribute('data-status') == 'TIED', f'{width}/v3-tied: 状态是 TIED')
            check(page.locator('[data-type-code]').count() == 0,
                  f'{width}/v3-tied: 不平分时才有四字母 —— 这里必须没有')
            check(page.locator('[data-tied-title]').count() == 1, f'{width}/v3-tied: 标题写明不选唯一类型')
            check(page.locator('[data-candidate]').count() == 4,
                  f'{width}/v3-tied: 并列候选 4 个（EI 两端 × JP 两端）')
            in_viewport(page, page.locator('[data-tied-title]'), f'{width}/v3-tied: 并列标题')
            in_viewport(page, page.locator('[data-candidate]'), f'{width}/v3-tied: 候选列表')
            no_overflow(page, f'{width}/v3-tied')
            page.screenshot(path=str(OUT / f'v3-tied-{width}.png'), full_page=True)
            page.locator('#report-candidates').screenshot(path=str(OUT / f'v3-tied-candidates-{width}.png'))

            # ── NEEDS_REVIEW：没有报告，不能被当成有效报告 ────────────────────
            open_report(page, NEEDS_REVIEW_ID)
            page.locator('[data-report-not-found]').wait_for()
            check(page.locator('[data-report-not-found]').is_visible(),
                  f'{width}/needs-review: 显示"没有报告"而不是报告')
            check(page.locator('[data-report-overview]').count() == 0,
                  f'{width}/needs-review: 不渲染报告骨架')
            check(page.locator('[data-type-code]').count() == 0,
                  f'{width}/needs-review: 不给四字母')
            check(page.locator('[data-candidate]').count() == 0,
                  f'{width}/needs-review: 不给候选')
            in_viewport(page, page.locator('[data-report-not-found]'), f'{width}/needs-review: 空态卡片')
            no_overflow(page, f'{width}/needs-review')
            page.screenshot(path=str(OUT / f'needs-review-{width}.png'), full_page=True)

            context.close()
        browser.close()

    check(not errors, 'no uncaught browser errors: ' + str(errors))
    check(not unexpected, 'all APIs intercepted and accounted for: ' + str(unexpected))
    (OUT / 'browser-results.json').write_text(json.dumps({
        'scope': ('synthetic reports from the production scorer/report builder + fully mocked API; '
                  'no live database, no backend, no real AI call'),
        'base': BASE,
        'widths': [320, 390, 1440],
        'reports': {name: {'status': report.get('status'), 'computedTypeCode': report.get('computedTypeCode'),
                           'candidates': len(report.get('candidates', [])),
                           'scoringVersion': report.get('methodology', {}).get('scoringVersion'),
                           'reportContentVersion': report.get('methodology', {}).get('reportContentVersion')}
                    for name, report in reports.items()},
        'checks': checks,
        'errors': errors,
        'unexpectedApis': unexpected,
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'{len(checks)} browser checks passed; evidence: {OUT}')


if __name__ == '__main__':
    main()
