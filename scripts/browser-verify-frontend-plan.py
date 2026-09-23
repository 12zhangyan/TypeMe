"""Front-end plan assessment smoke checks; every API request is intercepted."""
import importlib.util
import json
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('readable_fixture', ROOT / 'scripts/browser-verify-readable.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
OUT = fixture.OUT
checks = []
unexpected = []
errors = []
console_messages = []


def check(ok, label):
    checks.append({'label': label, 'passed': bool(ok)})
    assert ok, label


def jung_attempt():
    dimensions = []
    for name in ('EI', 'SN', 'TF', 'JP'):
        dimensions.append({'dimension': name, 'name': f'维度 {name}', 'question': '这一维问什么',
                           'negativePole': {'pole': 'I', 'label': '左', 'description': '左边的说明。', 'dailySigns': []},
                           'positivePole': {'pole': 'E', 'label': '右', 'description': '右边的说明。', 'dailySigns': []},
                           'balanced': {'summary': '接近。', 'reading': '两边都可读。'}, 'tiedNotice': '两边接近。'})
    questions = [{'id': f'j{i}', 'stage': 'base', 'dimension': ('EI', 'SN', 'TF', 'JP')[(i-1)//12],
                  'scenario': f'日常场景 {i}', 'textLeft': f'先观察情况 {i}', 'textRight': f'先开始尝试 {i}',
                  'leftPole': 'I', 'rightPole': 'E', 'help': '按平时经历判断。', 'facet': '日常',
                  'order': i, 'reviewStatus': 'reviewed'} for i in range(1, 49)]
    package = {'schemaVersion': 1, 'packageId': 'synthetic-jung-package',
               'instrument': {'id': 'typeme-jung48', 'revision': 'r1', 'scoringVersion': 'typeme-jung48-score-v1',
                              'reportContentVersion': 'synthetic-report', 'format': 'bipolar', 'hasTypeCode': True,
                              'baseItemsPerDimension': 12, 'clarificationItemsPerDimension': 4, 'maxClarificationItems': 16},
               'title': '十六型人格参考测评', 'contentStatus': 'draft_review_pending',
               'scoringPolicy': {'version': 'typeme-jung48-score-v1', 'minBaseRatingsPerDimension': 9,
                                 'boundaryNumerator': 2, 'boundaryDenominator': 10,
                                 'ratingMin': 1, 'ratingMax': 5, 'ratingNeutral': 3},
               'dimensions': dimensions, 'questions': questions, 'sha256': 'c' * 64}
    return {'attemptId': 'synthetic-jung', 'packageId': package['packageId'], 'status': 'BASE_IN_PROGRESS',
            'revision': 7, 'currentQuestionId': 'j1', 'clarificationDimensions': [], 'clarificationSkipped': False,
            'startedAt': '2026-09-23T00:00:00Z', 'updatedAt': '2026-09-23T00:00:00Z',
            'submittedAt': None, 'reportId': None, 'baseAttemptId': None, 'answers': [], 'coverage': [],
            'packageContent': package}


def bigfive_attempt():
    items = [{'id': f'B{i:02}', 'kind': 'agreement_statement', 'stage': 'base',
              'dimension': ('E', 'A', 'C', 'ES', 'O')[(i-1)//10], 'order': i, 'scenario': None,
              'left': None, 'right': None, 'statement': f'陈述句 {i}', 'leftPole': None, 'rightPole': None,
              'direction': 1, 'help': '按平时经历判断。'} for i in range(1, 51)]
    return {'attemptId': 'synthetic-bigfive', 'instrumentSlug': 'bigfive50', 'instrumentKind': 'big_five',
            'instrumentTitle': '大五人格倾向测评', 'packageId': 'synthetic-bigfive-package',
            'reportKind': 'big_five_profile', 'status': 'DRAFT', 'revision': 3, 'currentQuestionId': 'B01',
            'clarificationDimensions': [], 'clarificationSkipped': False,
            'startedAt': '2026-09-23T00:00:00Z', 'updatedAt': '2026-09-23T00:00:00Z',
            'submittedAt': None, 'baseAttemptId': None, 'reportId': None,
            'answers': [], 'items': items, 'answeredCount': 0, 'requiredCount': 50, 'answerComplete': False}


def main():
    jung = jung_attempt()
    bigfive = bigfive_attempt()
    scenario = {'error': None}
    requests = []

    def api(route):
        path = urlparse(route.request.url).path
        method = route.request.method
        requests.append(f'{method} {path}')
        body = None
        status = 200
        if path == '/api/v3/platform/attempts/synthetic-jung/metadata':
            body = {'attemptId': 'synthetic-jung', 'instrumentKind': 'jung', 'status': 'BASE_IN_PROGRESS'}
        elif path == '/api/v3/platform/attempts/synthetic-bigfive/metadata':
            body = {'attemptId': 'synthetic-bigfive', 'instrumentKind': 'big_five', 'status': 'DRAFT'}
        elif path == '/api/v3/attempts/synthetic-jung' and method == 'GET':
            body = jung
        elif path == '/api/v3/platform/attempts/synthetic-bigfive' and method == 'GET':
            body = bigfive
        elif path.endswith('/answers') and method == 'PATCH':
            if scenario['error']:
                status = scenario['error']
                body = {'code': 'CONFLICT_REVISION' if status == 409 else 'UNAUTHENTICATED' if status == 401 else 'SAVE_FAILED',
                        'message': '模拟保存失败'}
            elif 'bigfive' in path:
                body = {'revision': 4, 'status': 'DRAFT', 'answeredCount': 1, 'requiredCount': 50,
                        'answerComplete': False, 'currentQuestionId': 'B01'}
            else:
                body = {'revision': 8, 'status': 'BASE_IN_PROGRESS', 'clarificationDimensions': []}
        elif method == 'POST' or method == 'DELETE':
            unexpected.append(f'{method} {path}')
            status, body = 405, {'code': 'NOT_ALLOWED', 'message': 'Browser test never submits or deletes'}
        else:
            fixture.api(route)
            return
        route.fulfill(status=status, content_type='application/json', body=json.dumps(body, ensure_ascii=False))

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for width, height in ((320, 720), (390, 844), (1440, 900)):
            for kind in ('jung', 'bigfive'):
                for error in (None, 500, 409, 401):
                    scenario['error'] = error
                    context = browser.new_context(viewport={'width': width, 'height': height})
                    context.route('**/api/**', api)
                    page = context.new_page()
                    page.on('pageerror', lambda err: errors.append(str(err)))
                    page.on('console', lambda message: console_messages.append(message.text) if message.type == 'error' else None)
                    slug = 'synthetic-jung' if kind == 'jung' else 'synthetic-bigfive'
                    page.goto(f'{fixture.BASE}/#/assess/{slug}')
                    selector = '[data-rating="3"]' if kind == 'jung' else '[data-bigfive-item]'
                    try:
                        page.locator(selector).first.wait_for(timeout=6000)
                    except Exception:
                        print(f'{width}/{kind}/{error} url={page.url} body={page.locator("body").inner_text()[:900]} main={page.locator("main").inner_html()[:1200]} requests={requests} unexpected={fixture.unexpected} errors={errors} console={console_messages}')
                        raise
                    check(page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'),
                          f'{width}/{kind}/{error}: no overflow')
                    if error is None:
                        page.screenshot(path=str(OUT / f'assess-{kind}-initial-{width}.png'), full_page=True)
                    if kind == 'jung':
                        check(page.locator('[data-rating]').count() == 5, f'{width}/jung: five choices')
                        page.locator('[data-rating="3"]').first.focus()
                        page.keyboard.press('Enter')
                    else:
                        check(page.locator('[data-bigfive-unknown]').count() == 1, f'{width}/bigfive: unknown separate')
                        page.locator('[data-bigfive-unknown]').focus()
                        page.keyboard.press('Enter')
                        # Big Five persists on navigation, not on selection.
                        if page.locator('[data-bigfive-next]').count():
                            page.locator('[data-bigfive-next]').focus()
                            page.keyboard.press('Enter')
                    page.wait_for_timeout(300)
                    if error == 409:
                        check(page.locator('[data-conflict-banner]' if kind == 'jung' else '[data-bigfive-conflict]').is_visible(),
                              f'{width}/{kind}: conflict visible')
                    if error == 500:
                        check(page.locator('[data-save-failed]' if kind == 'jung' else '[data-bigfive-save-error]').is_visible(),
                              f'{width}/{kind}: save failure visible')
                    if error == 401:
                        check('登录' in page.locator('body').inner_text(), f'{width}/{kind}: session failure visible')
                    check(page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'),
                          f'{width}/{kind}/{error}: interaction no overflow')
                    page.evaluate('window.scrollTo(0, 0)')
                    page.wait_for_timeout(150)
                    page.screenshot(path=str(OUT / f'assess-{kind}-{error or "normal"}-{width}.png'), full_page=True)
                    context.close()
        browser.close()
    check(not unexpected, f'No unmocked writes: {unexpected}')
    check(not errors, f'No uncaught browser errors: {errors}')
    (OUT / 'assessment-results.json').write_text(json.dumps({'checks': checks, 'unexpected': unexpected,
                                                              'errors': errors}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'{len(checks)} assessment browser checks passed')


if __name__ == '__main__':
    main()
