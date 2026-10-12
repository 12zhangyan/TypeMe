"""两轮 skill 实用回归：Chromium + 合成 API，阻断外部网络，不启动后端或写库。"""
import argparse
import asyncio
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('TYPEME_TWO_ROUNDS_BASE', 'http://127.0.0.1:5212')
OUT = ROOT / 'docs/optimization/verification/2026-10-12-skills-two-rounds'
parser = argparse.ArgumentParser()
parser.add_argument('--round', choices=('1', '2', 'all'), default='all')
parser.add_argument('--baseline', action='store_true')
args = parser.parse_args()
PREFIX = 'round' + args.round + ('-before' if args.baseline else '')
checks, errors, unexpected = [], [], []
CATALOG = {'items': [{'slug': 'bigfive50', 'kind': 'big_five', 'title': '大五人格倾向测评',
    'tagline': '五个方面各自独立', 'summary': '五个方面各自独立，不看总分。',
    'whatYouLearn': ['五个方面的位置'], 'notFor': ['招聘筛选'], 'format': 'agreement',
    'hasTypeCode': False, 'supportsClarification': False, 'dimensions': ['E', 'A', 'C', 'ES', 'O'],
    'defaultPackageId': 'typeme-bigfive50-zh-v1', 'baseItemCount': 50,
    'clarificationItemCount': 0, 'maxClarificationItems': 0, 'estimatedMinutes': 10,
    'contentStatus': 'draft_review_pending'}]}
ATTEMPT = {'attemptId': 'synthetic-attempt', 'instrumentSlug': 'bigfive50', 'instrumentKind': 'big_five',
    'instrumentTitle': '大五人格倾向测评', 'packageId': 'typeme-bigfive50-zh-v1',
    'reportKind': 'big_five_profile', 'status': 'DRAFT', 'revision': 0, 'currentQuestionId': None,
    'clarificationDimensions': [], 'clarificationSkipped': False, 'startedAt': '2026-10-12T00:00:00Z',
    'updatedAt': '2026-10-12T00:00:00Z', 'submittedAt': None, 'baseAttemptId': None, 'reportId': None,
    'items': [], 'answers': [], 'answeredCount': 0, 'requiredCount': 50, 'answerComplete': False}


def check(ok, label):
    checks.append({'label': label, 'passed': bool(ok)})
    assert ok, label


async def geometry(page, control, label):
    await control.scroll_into_view_if_needed()
    await control.focus()
    await expect(control).to_be_focused()
    observed = await control.evaluate('''el => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return {reachable: el === hit || el.contains(hit), width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth};
    }''')
    check(observed['reachable'], label + ': control is not obscured')
    check(observed['scroll'] <= observed['width'] + 1, label + ': no horizontal overflow')


async def scenario(browser, width, mode):
    label = str(width) + '/' + mode
    context = await browser.new_context(viewport={'width': width, 'height': 900}, reduced_motion='reduce')
    page = await context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    entered, release = asyncio.Event(), asyncio.Event()
    state = {'catalog_calls': 0, 'creates': 0, 'report_calls': 0, 'writes': 0, 'user': 'account-a'}

    def profile():
        return {'userId': state['user'], 'username': state['user'],
                'nickname': '验收乙' if state['user'] == 'account-b' else '验收甲'}

    async def route_api(route):
        request = route.request
        url = urlparse(request.url)
        if url.netloc != urlparse(BASE).netloc:
            await route.abort()
            return
        p, status, body = url.path, 200, {}
        if not p.startswith('/api/'):
            await route.continue_()
            return
        if p == '/api/v3/me' and request.method == 'GET':
            body = profile()
        elif p == '/api/v3/me' and request.method == 'PATCH':
            state['writes'] += 1
            entered.set()
            if mode == 'session-late-csrf' and state['writes'] == 1:
                await release.wait()
                status, body = 403, {'code': 'CSRF_INVALID', 'message': '模拟旧会话校验失效'}
            else:
                body = profile()
        elif p == '/api/v3/auth/logout':
            state['user'] = None
        elif p == '/api/v3/auth/login':
            state['user'] = 'account-b'
            body = profile()
        elif p == '/api/v3/auth/csrf':
            body = {'token': 'synthetic-browser-only', 'headerName': 'X-XSRF-TOKEN', 'parameterName': '_csrf'}
        elif p == '/api/v3/platform/illustrations':
            body = {'assets': [], 'version': 'synthetic-empty', 'release': None}
        elif p.startswith('/api/v3/admin/'):
            status, body = 403, {'code': 'FORBIDDEN', 'message': '普通合成账号'}
        elif p == '/api/v3/platform/instruments':
            state['catalog_calls'] += 1
            if mode == 'catalog-retry' and state['catalog_calls'] == 1:
                status, body = 503, {'code': 'SERVICE_UNAVAILABLE', 'message': '模拟目录暂不可用'}
            else:
                body = CATALOG
        elif p == '/api/v3/platform/attempts' and request.method == 'POST':
            state['creates'] += 1
            entered.set()
            if mode == 'leave-during-create':
                await release.wait()
            status, body = 201, ATTEMPT
        elif p == '/api/v3/platform/reports' and mode == 'session-late-401':
            state['report_calls'] += 1
            if state['report_calls'] == 1:
                entered.set()
                await release.wait()
                status, body = 401, {'code': 'UNAUTHENTICATED', 'message': '模拟旧会话过期'}
            else:
                body = {'items': [], 'total': 0, 'page': 0, 'size': 20}
        elif p in ('/api/v3/platform/attempts', '/api/v3/platform/reports', '/api/v3/reports', '/api/v3/attempts'):
            body = {'items': [], 'total': 0, 'page': 0, 'size': 50}
        elif p == '/api/v3/platform/attempts/synthetic-attempt':
            body = ATTEMPT
        elif p == '/api/v3/catalog/current':
            body = {'packageId': 'typeme-jung48-zh-v2', 'questionCount': 48, 'basePerDimension': 12,
                    'title': '十六型人格参考测评', 'dimensions': []}
        elif p == '/api/v3/ai/status':
            body = {'enabled': False, 'mock': True, 'model': 'mock', 'dailyLimitPerUser': 0,
                    'remainingToday': 0, 'apiKeySource': 'none', 'promptVersion': 'typeme-ai-prompt-v5'}
        else:
            unexpected.append(request.method + ' ' + p)
            status, body = 404, {'code': 'NOT_FOUND', 'message': '未定义合成接口'}
        await route.fulfill(status=status, content_type='application/json', body=json.dumps(body, ensure_ascii=False))

    await page.route('**/*', route_api)
    try:
        initial = '/reports' if mode == 'session-late-401' else '/account' if mode == 'session-late-csrf' else '/assess?instrument=bigfive50'
        await page.goto(BASE + '/#' + initial)
        if mode.startswith('session-'):
            if mode == 'session-late-csrf':
                await page.get_by_label('昵称', exact=True).fill('只属于甲的修改')
                await page.get_by_role('button', name='保存昵称', exact=True).click()
            await asyncio.wait_for(entered.wait(), timeout=10)
            await page.get_by_role('button', name='退出', exact=True).click()
            await page.wait_for_url('**/#/login*')
            await page.get_by_label('用户名', exact=True).fill('account-b')
            await page.get_by_label('密码', exact=True).fill('synthetic-browser-password')
            await page.get_by_role('button', name='登录', exact=True).click()
            await expect(page.get_by_role('link', name='账号与数据（已登录：验收乙）')).to_be_visible()
            await expect(page.get_by_role('button', name='退出', exact=True)).to_be_enabled()
            old_path = '/platform/reports' if mode == 'session-late-401' else '/api/v3/me'
            async with page.expect_request_finished(lambda req: old_path in req.url and (mode != 'session-late-csrf' or req.method == 'PATCH')):
                release.set()
            await page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
            await expect(page.get_by_role('link', name='账号与数据（已登录：验收乙）')).to_be_visible()
            check(not '/#/login' in page.url, label + ': new session remains signed in')
            check(state['writes'] == (1 if mode == 'session-late-csrf' else 0), label + ': old write is not replayed')
            await geometry(page, page.get_by_role('button', name='退出', exact=True), label)
            await page.screenshot(path=str(OUT / (PREFIX + '-' + mode + '-' + str(width) + '.png')))
        elif mode == 'catalog-retry':
            failure = page.locator('[data-assess-catalog-error]')
            await expect(failure).to_be_visible()
            await expect(page.locator('[data-assess-start-error]')).to_have_count(0)
            check(state['creates'] == 0, label + ': failed catalog cannot create a draft')
            button = failure.get_by_role('button', name='重新载入')
            await geometry(page, button, label)
            await page.screenshot(path=str(OUT / ('round1-retry-' + str(width) + '.png')))
            await page.keyboard.press('Enter')
            await page.wait_for_url('**/#/assess/synthetic-attempt')
            check(state['creates'] == 1, label + ': keyboard retry enters original assessment once')
        else:
            await asyncio.wait_for(entered.wait(), timeout=10)
            await expect(page.locator('[data-start="bigfive50"]')).to_be_disabled()
            await page.get_by_role('navigation', name='站点导航').get_by_role('link', name='暂时离开', exact=True).click()
            await page.wait_for_url('**/#/')
            async with page.expect_request_finished(lambda req: req.method == 'POST' and '/platform/attempts' in req.url):
                release.set()
            await page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
            check(page.url.endswith('/#/'), label + ': late response cannot reverse navigation')
            check(state['creates'] == 1, label + ': no duplicate create')
            await page.screenshot(path=str(OUT / ('round1-leave-' + str(width) + '.png')))
    finally:
        release.set()
        await context.close()


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    passed = False
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch()
            try:
                for width in (320, 390, 1440):
                    modes = []
                    if args.round in ('1', 'all'):
                        modes += ['catalog-retry', 'leave-during-create']
                    if args.round in ('2', 'all'):
                        modes += ['session-late-401', 'session-late-csrf']
                    for mode in modes:
                        await scenario(browser, width, mode)
            finally:
                await browser.close()
        check(not errors, 'no page exceptions')
        check(not unexpected, 'all API calls are declared synthetic fixtures')
        passed = True
    finally:
        result = {'passed': passed, 'round': args.round, 'baseline': args.baseline,
                  'checks': checks, 'pageErrors': errors, 'unexpectedApis': unexpected,
                  'scope': 'built frontend, Chromium, synthetic network; no backend/database/AI execution'}
        (OUT / (PREFIX + '-browser.json')).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
