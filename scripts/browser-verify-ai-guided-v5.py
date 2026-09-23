"""AI v5 浏览器验收：生产前端、合成报告、全部 API 模拟、外网阻断。"""
import importlib.util
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault('TYPEME_BROWSER_EVIDENCE', 'docs/2026-09-23-ai-analysis/evidence')
spec = importlib.util.spec_from_file_location('readable', ROOT / 'scripts/browser-verify-readable.py')
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
BASE = os.environ.get('TYPEME_AI_BROWSER_BASE', 'http://127.0.0.1:5196')
state = {}
requests = []
external = []

def reset(report_id):
    state.clear()
    state.update(report=report_id, enabled=True, status_error=False, submit_error=False,
                 status='SUCCEEDED', empty=False, quota=2, version='typeme-ai-prompt-v5')

def result(report_id):
    big_five = report_id == 'bigfive'
    evidence = 'E:summary' if big_five else 'EI:summary'
    return {'schemaVersion': 'analysis-guided-v3',
            'referenceType': None if big_five else fixtures.reports[report_id].get('computedTypeCode'),
            'summary': '你可以先从交流的节奏认识这次回答：看一看主动讨论在什么场景帮助你，也为想安静思考的时候留出空间。',
            'observations': [{'title': '在交流和独处之间留一点选择',
                'plainText': '本次关于交流的回答偏向主动与人互动。这能帮助你在需要交换想法时更快进入讨论，但不能推断每次相处都会让你轻松。',
                'example': '如果一场讨论有熟悉的话题，试着主动分享一个想法；如果大家连续讨论很久，也可以先安静整理后再回应。两种做法并不冲突。',
                'checkQuestion': '最近哪次交流让你想继续，哪次让你想独处？当时的场景有什么不同？',
                'evidenceIds': [evidence]}],
            'suggestedAction': {'what': '下一次讨论后，记下一句话：刚才哪个环节让我更有精神，哪个环节需要暂停。',
                'why': '用一次实际经历核对交流倾向，帮助你分清自己的偏好和场景的影响。',
                'when': '下一次聊天或合作结束后，花一分钟。',
                'observe': '留意人数、话题和时长的差别；若记录没有帮助就停止，不必坚持打卡。',
                'evidenceIds': [evidence]},
            'limitations': ['这里只依据这份报告的维度摘要，场景是假设，不能说明你每次都会这样做。', '这是用于页面验收的合成示例，未调用真实模型。']}

def job():
    report_id = state['report']
    body = result(report_id)
    if state['version'] == 'typeme-ai-prompt-v3':
        body = fixtures.ai_result(report_id)
    if state.get('insufficient'):
        body['observations'] = []
        body['suggestedAction'] = None
        body['summary'] = '当前材料不足以支持针对性的解释，先保留判断。'
    return {'jobId': 'demo-v5-' + report_id, 'reportId': report_id, 'status': state['status'],
            'topic': 'communication', 'promptVersion': state['version'], 'attemptCount': 1,
            'createdAt': '2026-09-23T01:00:00Z', 'finishedAt': '2026-09-23T01:00:30Z',
            'mock': True, 'errorCode': 'TIMEOUT' if state['status'] == 'FAILED' else None, 'result': body}

def api(route):
    url = urlparse(route.request.url)
    if url.netloc != urlparse(BASE).netloc:
        external.append(url.netloc)
        route.abort()
        return
    path = url.path
    if path.startswith('/api/'):
        requests.append({'path': path, 'method': route.request.method})
    if path == '/api/v3/ai/status':
        if state['status_error']:
            route.fulfill(status=503, json={'code': 'SERVICE_UNAVAILABLE', 'message': '状态读取失败'})
        else:
            route.fulfill(json={'enabled': state['enabled'], 'mock': True, 'model': 'mock',
                'dailyLimitPerUser': 2, 'remainingToday': state['quota'], 'apiKeySource': 'none',
                'promptVersion': 'typeme-ai-prompt-v5'})
    elif path.endswith('/analyses'):
        if route.request.method == 'POST':
            payload = route.request.post_data_json
            fixtures.check(payload['consent']['scopeVersion'] == 'typeme-ai-scope-v3', 'unchanged consent scope')
            fixtures.check(payload['topic'] == 'communication', 'submitted selected topic')
            fixtures.check(payload['note'] == '想在讨论分歧时表达得更清楚。', 'submitted synthetic context')
            if state['submit_error']:
                route.fulfill(status=503, json={'code': 'AI_NOT_CONFIGURED', 'message': '模拟服务暂不可用'})
            else:
                route.fulfill(status=202, json={'jobId': job()['jobId'], 'status': 'SUCCEEDED', 'cached': True})
        else:
            route.fulfill(json={'items': [] if state['empty'] else [job()]})
    elif path.startswith('/api/v3/analyses/') and path.endswith('/retry'):
        state['status'] = 'QUEUED'
        route.fulfill(status=202, json={'jobId': job()['jobId'], 'status': 'QUEUED', 'attemptCount': 2})
    elif path.startswith('/api/v3/analyses/'):
        route.fulfill(json=job())
    elif path.startswith('/api/'):
        fixtures.api(route)
    else:
        route.continue_()

def screenshot(page, name):
    fixtures.layout(page, name)
    page.screenshot(path=str(fixtures.OUT / (name + '.png')))

def focus_and_press(page, locator):
    locator.scroll_into_view_if_needed()
    locator.focus()
    fixtures.check(locator.evaluate('(el) => document.activeElement === el'), 'keyboard action reachable')
    # 中心点未被浮动导航等遮住。
    fixtures.check(locator.evaluate('''el => { const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x+r.width/2, r.y+r.height/2)); }'''), 'primary action not covered')
    page.keyboard.press('Enter')

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    for width in (320, 390, 1440):
        context = browser.new_context(viewport={'width': width, 'height': 900}, reduced_motion='reduce')
        context.route('**/*', api)
        page = context.new_page()
        page.on('pageerror', lambda error: fixtures.errors.append(str(error)))
        for report_id in ('jung-v2', 'bigfive'):
            reset(report_id)
            page.goto(BASE + '/#/reports/' + report_id)
            page.locator('[data-ai-result]').wait_for()
            fixtures.check(page.locator('[data-ai-evidence]').inner_text().endswith('外向性' if report_id == 'bigfive' else '精力方向'), 'readable source dimension')
            fixtures.check(page.locator('[data-ai-check-question]').count() == 1, 'self-check question visible')
            fixtures.check(page.locator('[data-ai-action-why]').count() == 1, 'action rationale visible')
            page.locator('[data-ai-summary]').scroll_into_view_if_needed()
            screenshot(page, 'result-' + report_id + '-' + str(width))
            page.locator('[data-ai-actions]').scroll_into_view_if_needed()
            screenshot(page, 'action-' + report_id + '-' + str(width))
            focus_and_press(page, page.locator('[data-ai-start]'))
            consent = page.locator('[data-ai-consent]')
            consent.wait_for()
            fixtures.check(consent.locator('h3').evaluate('(el) => document.activeElement === el'), 'focus moved into confirmation')
            fixtures.check('最多 5 条维度摘要' in consent.inner_text(), 'dimension-only sending range')
            submit = page.locator('[data-ai-submit]')
            fixtures.check(submit.is_disabled(), 'explicit consent required')
            textarea = consent.locator('textarea')
            textarea.fill('想在讨论分歧时表达得更清楚。')
            consent.locator('input[type=checkbox]').check()
            state['submit_error'] = True
            focus_and_press(page, submit)
            page.locator('[data-ai-create-error]').wait_for()
            fixtures.check(textarea.input_value() == '想在讨论分歧时表达得更清楚。', 'form context survives submission error')
            screenshot(page, 'form-error-' + report_id + '-' + str(width))
            state['submit_error'] = False
            focus_and_press(page, submit)
            page.locator('[data-ai-running]').wait_for()
            fixtures.check(page.locator('[data-ai-result]').count() == 1, 'last successful result remains during regeneration')
            fixtures.check('上一次成功生成' in page.locator('[data-ai-stale]').inner_text(), 'old result marked during generation')
            state['status'] = 'FAILED'
            page.locator('[data-ai-failed]').wait_for(timeout=10000)
            fixtures.check(page.locator('[data-ai-summary]').count() == 1, 'last result survives failed regeneration through real API parser')
            page.locator('[data-ai-failed]').scroll_into_view_if_needed()
            screenshot(page, 'retry-failed-' + report_id + '-' + str(width))
            state['quota'] = 0
            page.reload()
            page.locator('[data-ai-quota-empty]').wait_for()
            fixtures.check(page.locator('[data-ai-retry]').is_disabled(), 'zero quota disables retry while history remains')
            state['quota'] = 2
            state['enabled'] = False
            page.reload()
            page.locator('[data-ai-disabled]').wait_for()
            fixtures.check(page.locator('[data-ai-result]').count() == 1, 'history remains when AI disabled')
            fixtures.check(page.locator('[data-ai-retry]').is_disabled(), 'disabled service cannot retry')
            state['enabled'] = True
            state['status_error'] = True
            page.reload()
            page.locator('[data-ai-status-unavailable]').wait_for()
            page.locator('[data-ai-result]').wait_for()
            fixtures.check(page.locator('[data-ai-result]').count() == 1, 'status failure does not hide history')
            state['status_error'] = False
            focus_and_press(page, page.locator('[data-ai-status-retry]'))
            page.locator('[data-ai-quota]').wait_for()
            state['version'] = 'typeme-ai-prompt-v3'
            state['status'] = 'SUCCEEDED'
            page.reload()
            page.locator('[data-ai-result]').wait_for()
            fixtures.check('差距小' in page.locator('[data-ai-summary]').inner_text(), 'historical v3 analysis remains readable')
            state['version'] = 'typeme-ai-prompt-v5'
            state['insufficient'] = True
            page.reload()
            page.locator('[data-ai-result]').wait_for()
            fixtures.check(page.locator('[data-ai-section]').count() == 0 and page.locator('[data-ai-actions]').count() == 0, 'insufficient evidence does not invent observations or actions')
            fixtures.check('不足' in page.locator('[data-ai-summary]').inner_text(), 'insufficient evidence has honest explanation')
            state['insufficient'] = False
            state['empty'] = True
            page.reload()
            page.locator('[data-ai-start]').wait_for()
            fixtures.check(page.locator('[data-ai-result]').count() == 0, 'no history has a clear generation entry')
            fixtures.layout(page, 'empty-' + report_id + '-' + str(width))
            page.goto('about:blank')
        context.close()
    browser.close()

fixtures.check(not fixtures.errors, 'no uncaught browser errors')
fixtures.check(not fixtures.unexpected, 'all APIs explicitly mocked')
(fixtures.OUT / 'browser-results.json').write_text(json.dumps({
    'scope': 'frontend production build; synthetic reports; all APIs mocked; external network blocked',
    'checks': fixtures.checks, 'errors': fixtures.errors, 'unexpectedApis': fixtures.unexpected,
    'requests': requests, 'blockedExternalHosts': sorted(set(external)),
}, ensure_ascii=False, indent=2), encoding='utf-8')
print(str(len(fixtures.checks)) + ' browser checks passed; evidence: ' + str(fixtures.OUT))
