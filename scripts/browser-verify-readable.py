"""使用生产计分器生成的合成报告验证页面。所有 API 均拦截，无数据库/真实 AI 调用。

先运行 ReadableReportFixturesTest 和前端 build，再在 5178 启动静态服务器。
"""
import copy
import os
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / os.environ.get('TYPEME_BROWSER_EVIDENCE', 'docs/optimization/verification/2026-09-18-readable')
FIXTURES = ROOT / 'backend/target/readable-browser-fixtures'
BASE = 'http://127.0.0.1:5178'
OUT.mkdir(parents=True, exist_ok=True)
reports = {path.stem: json.loads(path.read_text(encoding='utf-8')) for path in FIXTURES.glob('*.json')}
assert {'jung-v1', 'jung-v2', 'jung-tied', 'bigfive'} <= reports.keys()
reports['bigfive-old'] = copy.deepcopy(reports['bigfive'])
reports['bigfive-old']['dimensions'][3]['rangeLow'] = 28
reports['bigfive-old']['dimensions'][3]['rangeHigh'] = 68
checks = []
errors = []
unexpected = []
mode = {'ai': 'success'}

catalog = []
for slug, kind, title, count, dimensions in [
    ('jung48', 'jung', '十六型人格参考测评', 48, ['EI', 'SN', 'TF', 'JP']),
    ('bigfive50', 'big_five', '大五人格倾向测评', 50, ['E', 'A', 'C', 'ES', 'O']),
]:
    jung = kind == 'jung'
    catalog.append({'slug': slug, 'kind': kind, 'title': title, 'tagline': '合成目录示例',
        'summary': '了解四个方面的偏好，保留不确定的部分。' if jung else '五个方面各自解释，没有类型和总分。',
        'whatYouLearn': ['这次回答的倾向与不确定之处'], 'notFor': ['判断能力和诊断'],
        'format': 'bipolar' if jung else 'agreement', 'hasTypeCode': jung, 'supportsClarification': jung,
        'dimensions': dimensions, 'defaultPackageId': 'synthetic-package', 'baseItemCount': count,
        'clarificationItemCount': 16 if jung else 0, 'maxClarificationItems': 16 if jung else 0,
        'estimatedMinutes': 10, 'contentStatus': 'draft_review_pending'})

def check(ok, label):
    checks.append({'label': label, 'passed': bool(ok)})
    if not ok:
        raise AssertionError(label)

def ai_result(report_id):
    return {
        'schemaVersion': 'analysis-readable-v2',
        'referenceType': reports[report_id].get('computedTypeCode'),
        'summary': '这次回答反映的是当下的选择习惯。差距小的方面先保留判断，不必急着给自己下结论。',
        'observations': [{'plainText': '先选一个你最想了解的方面，看看报告中的描述是否符合实际情境。',
                          'example': '例如，可以回想最近一次聊天：结束后，你更想继续交流，还是先安静一会儿？',
                          'evidenceIds': ['E:summary' if report_id.startswith('bigfive') else 'EI:summary']}],
        'suggestedAction': {'what': '记下一次具体经历。', 'when': '下次遇到类似场景之后。',
                            'observe': '看看哪些描述符合自己，哪些不符合。',
                            'evidenceIds': ['E:summary' if report_id.startswith('bigfive') else 'EI:summary']},
        'limitations': ['这是合成数据的页面示例，没有调用真实模型。']}

def api(route):
    path = urlparse(route.request.url).path
    status, body = 200, {}
    if path == '/api/v3/me':
        body = {'userId': 'synthetic', 'username': '页面验收示例', 'nickname': '演示用户'}
    elif path == '/api/v3/platform/instruments':
        body = {'items': catalog}
    elif path == '/api/v3/attempts':
        body = {'items': [], 'page': 0, 'size': 20, 'total': 0}
    elif path == '/api/v3/catalog/current':
        body = {'packageId': 'typeme-jung48-zh-v2', 'questionCount': 48, 'basePerDimension': 12,
                'title': '十六型人格参考测评', 'dimensions': []}
    elif path == '/api/v3/ai/status':
        body = {'enabled': mode['ai'] != 'off', 'mock': True, 'model': 'mock', 'dailyLimitPerUser': 2,
                'remainingToday': 2, 'apiKeySource': 'none', 'promptVersion': 'typeme-ai-prompt-v3'}
    elif path.endswith('/analyses'):
        report_id = path.split('/')[-2]
        body = {'items': [] if mode['ai'] in ('off', 'empty') else [{
            'jobId': 'demo-analysis', 'reportId': report_id,
            'status': 'FAILED' if mode['ai'] == 'failed' else 'SUCCEEDED', 'topic': 'overall',
            'promptVersion': 'typeme-ai-prompt-v3', 'mock': True,
            'errorCode': 'TIMEOUT' if mode['ai'] == 'failed' else None,
            'result': ai_result(report_id) if mode['ai'] == 'success' else None}]}
    elif path.startswith('/api/v3/platform/reports/'):
        report_id = path.split('/')[-1]
        body = {'reportId': report_id, 'attemptId': 'synthetic-attempt', 'instrumentSlug': 'bigfive50',
                'instrumentKind': 'big_five', 'instrumentTitle': '大五人格倾向测评', 'reportKind': 'big_five_profile',
                'packageId': 'typeme-bigfive50-zh-v1', 'createdAt': '2026-09-18T00:00:00Z', 'status': 'PROFILE',
                'computedTypeCode': None, 'summaryLine': reports[report_id]['summary'],
                'report': reports[report_id], 'selfReflection': {}, 'attemptRevision': 1}
    elif path.startswith('/api/v3/reports/'):
        report_id = path.split('/')[-1]
        body = {'report': reports[report_id], 'selfReflection': {}, 'attemptId': 'synthetic-attempt', 'attemptRevision': 1}
    elif path.startswith('/api/v3/admin/'):
        status, body = 403, {'code': 'FORBIDDEN', 'message': '非管理员示例'}
    elif path in ('/api/v1/meta', '/api/v2/assessment-packages/ipip50-zh1'):
        # App 的旧引擎初始化使用仓库内置副本；明确模拟旧内容服务离线。
        status, body = 503, {'code': 'NOT_CONFIGURED', 'message': '旧内容使用内置副本'}
    else:
        # 没有任何 API 请求可以落到真实后端。
        unexpected.append(path)
        status, body = 404, {'code': 'NOT_FOUND', 'message': '页面验收未定义此接口'}
    route.fulfill(status=status, content_type='application/json', body=json.dumps(body, ensure_ascii=False))

def layout(page, label):
    result = page.evaluate('''() => ({width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth})''')
    check(result['scroll'] <= result['width'] + 1, label + ': no horizontal overflow')

def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        for width in (320, 390, 1440):
            context = browser.new_context(viewport={'width': width, 'height': 900}, device_scale_factor=1)
            context.route('**/api/**', api)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(BASE)
            page.locator('[data-home-instruments]').wait_for()
            check(page.locator('[data-home-instruments] > li').count() == 2, f'{width}/home: two instruments')
            check(page.locator('[data-jung-introduction]').get_attribute('open') is None, f'{width}/home: optional long tutorial')
            layout(page, f'{width}/home')
            page.screenshot(path=str(OUT / f'home-{width}.png'), full_page=True)
            for report_id in ('jung-v2', 'jung-tied', 'jung-v1', 'bigfive', 'bigfive-old'):
                mode['ai'] = 'success'
                page.goto(f'{BASE}/#/reports/{report_id}')
                page.locator('[data-ai-result]').wait_for()
                if not report_id.startswith('bigfive') and width < 1024:
                    toggle = page.get_by_role('button', name='查看报告目录')
                    check(toggle.get_attribute('aria-expanded') == 'false', f'{width}/{report_id}: compact mobile contents')
                    toggle.focus()
                    page.keyboard.press('Enter')
                    check(page.locator('[data-toc]').first.is_visible(), f'{width}/{report_id}: keyboard opens contents')
                    page.keyboard.press('Enter')

                check(page.locator('[data-ai-summary]').inner_text().find('差距小') >= 0, f'{width}/{report_id}: readable AI')
                if report_id.startswith('bigfive'):
                    check('/reports/big-five/' in page.url, f'{width}/{report_id}: generic link dispatch')
                    check(page.locator('[data-dimension]').count() == 5, f'{width}/{report_id}: five dimensions')
                    details = page.locator('[data-dimension]').first.locator('details')
                    check(details.get_attribute('open') is None, f'{width}/{report_id}: score details initially collapsed')
                    details.locator('summary').focus()
                    page.keyboard.press('Enter')
                    check(details.get_attribute('open') is not None, f'{width}/{report_id}: score details keyboard accessible')
                    page.keyboard.press('Enter')
                    check(page.locator('[data-historical-range-warning]').count() == (1 if report_id.endswith('old') else 0),
                          f'{width}/{report_id}: historical range warning')
                else:
                    check(page.locator('[data-report-overview]').get_attribute('data-status') == ('TIED' if report_id == 'jung-tied' else 'TENTATIVE'),
                          f'{width}/{report_id}: uncertainty status preserved')
                    if report_id != 'jung-tied':
                        theory = page.locator('details').filter(has=page.locator('[data-dynamics]')).first
                        check(theory.get_attribute('open') is None, f'{width}/{report_id}: theory initially collapsed')
                        summary = theory.locator(':scope > summary')
                        summary.focus()
                        page.keyboard.press('Enter')
                        check(theory.get_attribute('open') is not None, f'{width}/{report_id}: keyboard opens theory')
                        page.keyboard.press('Enter')
                    else:
                        check(page.locator('[data-type-code]').count() == 0, f'{width}/{report_id}: no forced type')
                layout(page, f'{width}/{report_id}')
                page.evaluate('document.activeElement?.blur(); window.scrollTo({top:0, behavior:"instant"})')
                page.wait_for_timeout(450)
                page.screenshot(path=str(OUT / f'{report_id}-{width}.png'), full_page=True)
            for state in ('off', 'failed', 'empty'):
                mode['ai'] = state
                page.goto('about:blank')
                page.goto(f'{BASE}/#/reports/big-five/bigfive')
                page.locator('[data-bigfive-dimensions]').wait_for()
                page.locator('[data-ai-panel]').wait_for()
                if state == 'empty':
                    page.locator('[data-ai-start]').click()
                    check('最多 5 条维度摘要' in page.locator('[data-ai-panel]').inner_text(), f'{width}: new consent range')
                    check(page.get_by_role('button', name='确认生成', exact=True).is_disabled(), f'{width}: no generation without consent')
                if state == 'failed':
                    page.locator('[data-ai-failed]').wait_for()
                check(page.locator('[data-dimension]').count() == 5, f'{width}/{state}: fixed report intact')
                layout(page, f'{width}/{state}')
            context.close()
        browser.close()

    check(not errors, 'no uncaught browser errors: ' + str(errors))
    check(not unexpected, 'all APIs intercepted and accounted for: ' + str(unexpected))
    (OUT / 'browser-results.json').write_text(json.dumps({'scope': 'synthetic reports + mocked API, no live database or AI',
        'checks': checks, 'errors': errors, 'unexpectedApis': unexpected}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'{len(checks)} browser checks passed; evidence: {OUT}')

if __name__ == '__main__':
    main()
