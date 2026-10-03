"""Visual acceptance on a static build; every API is mocked, including saves."""
import importlib.util
import json
import os
import re
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('readable', ROOT / 'scripts/browser-verify-readable.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
OUT = ROOT / os.environ.get('TYPEME_BROWSER_EVIDENCE', 'docs/optimization/verification/2026-09-18-visual')
OUT.mkdir(parents=True, exist_ok=True)
checks, errors = [], []
state = {'signed_in': False, 'save_fail': False, 'catalog_fail': False}
jung_loader = (ROOT / 'backend/src/main/java/com/typeme/jung/content/JungPackageLoader.java').read_text(encoding='utf-8')
match = re.search(r'CURRENT_PACKAGE_ID\s*=\s*"([^"]+)"', jung_loader)
assert match, 'JungPackageLoader.CURRENT_PACKAGE_ID 没找到：脚本必须跟着服务端当前默认包走'
CURRENT_JUNG_PACKAGE = match.group(1)

def jung_package(package_id):
    return json.loads((ROOT / f'backend/src/main/resources/content/{package_id}.json').read_text(encoding='utf-8'))

# 浏览器验收必须用**服务端当前默认包**（新草稿绑定的那一版）。
# 之前这里写死 v2，于是主流程实际绑定的 v3 拿不到阅读说明、页面根本不显示，
# 脚本却一直绿 —— 默认包换版时这里要跟着换，而不是继续测上一版。
jung = jung_package(CURRENT_JUNG_PACKAGE)
historical_jung = jung_package('typeme-jung48-zh-v2')
content = json.loads((ROOT / 'backend/src/main/resources/content/bigfive50-zh-v1.json').read_text(encoding='utf-8'))
items = [{**q, 'kind': 'agreement_statement', 'stage': 'base', 'statement': q['text']} for q in content['questions']]
attempt = dict(attemptId='visual-attempt', instrumentSlug='bigfive50', instrumentKind='big_five',
    instrumentTitle='大五人格倾向测评', packageId=content['packageId'], reportKind='big_five_profile',
    status='DRAFT', revision=1, currentQuestionId='Q01', clarificationDimensions=[], clarificationSkipped=False,
    startedAt='2026-09-18T00:00:00Z', updatedAt='2026-09-18T00:00:00Z', submittedAt=None,
    baseAttemptId=None, reportId=None, answers=[], items=items, answeredCount=0, requiredCount=50, answerComplete=False)

def check(value, name):
    checks.append({'label': name, 'passed': bool(value)})
    assert value, name

def respond(route, body, status=200):
    route.fulfill(status=status, content_type='application/json', body=json.dumps(body, ensure_ascii=False))

def api(route):
    path = urlparse(route.request.url).path
    if path == '/api/v3/me' and not state['signed_in']:
        respond(route, {'code': 'UNAUTHENTICATED', 'message': '请先登录'}, 401)
    elif path == '/api/v3/platform/instruments' and state['catalog_fail']:
        respond(route, {'code': 'SERVICE_UNAVAILABLE', 'message': '列表暂时不可用'}, 503)
    elif path in ('/api/v3/platform/attempts/visual-jung', '/api/v3/platform/attempts/visual-jung-v2'):
        # 分流信号必须是 409 INSTRUMENT_MISMATCH：2026-09-20 起 `404` 的含义是
        # "没有找到这份测评"（独立空态），不再代表"这是十六型草稿"。
        # 这里原来写的是 404，于是脚本根本进不了十六型答题页而一直超时。
        respond(route, {'code': 'INSTRUMENT_MISMATCH', 'message': '这是十六型草稿', 'requestId': None, 'details': {}}, 409)
    elif path in ('/api/v3/attempts/visual-jung', '/api/v3/attempts/visual-jung-v2'):
        attempt_id = path.rsplit('/', 1)[-1]
        pkg = jung if attempt_id == 'visual-jung' else historical_jung
        respond(route, {**attempt, 'attemptId': attempt_id, 'packageId': pkg['packageId'],
                       'status':'BASE_IN_PROGRESS', 'answers':[], 'currentQuestionId':None,
                       'coverage':[], 'packageContent':pkg})
    elif path == '/api/v3/auth/csrf':
        respond(route, {'token': 'synthetic-browser-only', 'headerName': 'X-XSRF-TOKEN', 'parameterName': '_csrf'})
    elif path == '/api/v3/platform/attempts/visual-attempt':
        respond(route, attempt)
    elif path == '/api/v3/platform/attempts/visual-attempt/answers':
        if state['save_fail']:
            respond(route, {'code': 'SERVICE_UNAVAILABLE', 'message': '保存暂时失败，请重试'}, 503)
            return
        data = route.request.post_data_json
        answers = {a['questionId']: a for a in attempt['answers']}
        answers.update({a['questionId']: a for a in data['responses']})
        attempt.update(answers=list(answers.values()), revision=attempt['revision']+1,
                       currentQuestionId=data['currentQuestionId'], answeredCount=len(answers))
        respond(route, {key: attempt[key] for key in ('revision','status','answeredCount','requiredCount','answerComplete','currentQuestionId')})
    elif path in ('/api/v3/platform/attempts', '/api/v3/platform/reports'):
        respond(route, {'items': [], 'page': 0, 'size': 20, 'total': 0})
    else:
        fixture.api(route)

def capture(page, name, width):
    check(page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'), name+' no overflow')
    page.evaluate('document.activeElement?.blur(); window.scrollTo({top:0, behavior:"instant"})')
    page.wait_for_timeout(450)
    page.mouse.move(0, 0)
    page.screenshot(path=str(OUT / f'{name}-{width}.png'), full_page=True)

def targets(page, selector, label):
    for i, button in enumerate(page.locator(selector).all()):
        box = button.bounding_box()
        check(box is not None and box['width'] >= 43.9 and box['height'] >= 43.9, f'{label}/{i} target >= 44px')

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    for width in (320, 390, 1440):
        state.update(signed_in=False, save_fail=False, catalog_fail=False)
        attempt.update(answers=[], answeredCount=0, revision=1, currentQuestionId='Q01')
        context = browser.new_context(viewport={'width': width, 'height': 900})
        context.route('**/api/**', api)
        page = context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(fixture.BASE)
        page.locator('[data-home-instruments]').wait_for()
        original_url = page.url
        page.get_by_role('button', name='找到适合我的测评').click()
        check(page.url == original_url, f'{width}/home CTA preserves hash route')
        check(page.locator('#available-assessments').evaluate('(el)=>el===document.activeElement'), f'{width}/home CTA transfers keyboard focus')
        page.goto(fixture.BASE+'/#/instruments')
        page.locator('[data-instrument-cards]').wait_for()
        targets(page, '[data-start]', f'{width}/directory')
        capture(page, 'instruments', width)
        page.locator('[data-start="bigfive50"]').click()
        page.locator('input[name="username"]').wait_for()
        check('login' in page.url and 'bigfive50' in page.url, f'{width}/login preserves selected instrument')
        capture(page, 'login', width)
        for route_name in ('register', 'recover'):
            page.goto(fixture.BASE+'/#/'+route_name)
            page.locator('form input').first.wait_for()
            if width == 1440:
                heading_box = page.locator('h1').bounding_box()
                form_box = page.locator('form').bounding_box()
                check(form_box['x'] > heading_box['x'] + 200, f'{route_name}/desktop split composition')
                check(form_box['y'] < heading_box['y'] + 250, f'{route_name}/desktop form alongside heading')
            capture(page, route_name, width)
        state['signed_in'] = True
        page.goto('about:blank')
        page.goto(fixture.BASE+'/#/assess/visual-attempt')
        page.locator('[data-bigfive-item="Q01"]').wait_for()
        check('主动带动气氛' in page.locator('[data-question-example]').inner_text(),f'{width}/bigfive visible reading example')
        targets(page, '[role="radio"], [data-bigfive-next], [data-bigfive-unknown]', f'{width}/quiz')
        check(not page.locator('[data-bigfive-grid]').is_visible(), f'{width}/quiz optional index collapsed')
        capture(page, 'answer', width)
        page.locator('[role="radio"]').nth(3).click()
        check(page.locator('[role="radio"]').nth(3).get_attribute('aria-checked') == 'true', f'{width}/quiz selected state')
        check('还没保存' in page.locator('[data-bigfive-save-state]').inner_text(), f'{width}/quiz truthful unsaved state')
        page.locator('[data-bigfive-next]').click()
        page.locator('[data-bigfive-item="Q02"]').wait_for()
        check('别人的处境和近况' in page.locator('[data-question-example]').inner_text(),f'{width}/bigfive reading example follows next item')
        check(attempt['answers'][0]['rating'] == 4, f'{width}/quiz simulated save has chosen rating')
        page.locator('[data-bigfive-prev]').click()
        page.locator('[data-bigfive-item="Q01"]').wait_for()
        check(page.locator('[role="radio"]').nth(3).get_attribute('aria-checked') == 'true', f'{width}/quiz back retains answer')
        state['save_fail'] = True
        page.locator('[role="radio"]').nth(1).click()
        page.locator('[data-bigfive-next]').click()
        page.locator('[data-bigfive-save-error]').wait_for()
        capture(page, 'answer-save-failed', width)
        check('刚才的改动还留在这个页面上' in page.locator('[data-bigfive-save-error]').inner_text(), f'{width}/quiz save failure visible')
        state['save_fail'] = False
        page.get_by_role('button', name='再试一次保存').click()
        page.locator('[data-bigfive-save-error]').wait_for(state='hidden')
        page.goto(fixture.BASE+'/#/reports')
        page.locator('[data-reports-empty]').wait_for()
        capture(page, 'reports-empty', width)
        for attempt_id, pkg in (('visual-jung', jung), ('visual-jung-v2', historical_jung)):
            page.goto(fixture.BASE+f'/#/assess/{attempt_id}')
            page.locator('[role="radiogroup"]').wait_for()
            example = page.locator('[data-question-example]')
            check(example.count() == 1, f'{width}/jung({pkg["packageId"]}) visible scene explanation')
            check('活动结束后' in example.inner_text(), f'{width}/jung({pkg["packageId"]}) scene text matches the item')
            targets(page, '[role="radio"]', f'{width}/jung({pkg["packageId"]}) quiz')
            capture(page, 'answer-jung' if attempt_id == 'visual-jung' else 'answer-jung-v2', width)
        state['catalog_fail'] = True
        page.goto('about:blank')
        page.goto(fixture.BASE)
        page.get_by_role('button', name='重新载入测评列表').wait_for()
        capture(page, 'home-load-failed', width)
        state['catalog_fail'] = False
        page.get_by_role('button', name='重新载入测评列表').click()
        page.locator('[data-home-instruments]').wait_for()
        check(page.locator('[data-home-instruments] > li').count() == 2, f'{width}/home recovers after retry')
        context.close()
    browser.close()
check(not errors, 'no uncaught errors: '+str(errors))
check(not fixture.unexpected, 'all API calls mocked: '+str(fixture.unexpected))
(OUT / 'visual-flow-results.json').write_text(json.dumps({'scope':'static production build + mocked APIs; no database or real AI', 'checks': checks}, ensure_ascii=False, indent=2),encoding='utf-8')
print(f'{len(checks)} visual flow checks passed')
