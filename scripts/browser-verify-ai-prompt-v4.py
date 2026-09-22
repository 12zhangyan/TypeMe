"""验证 v4 可读契约与 v3 历史结果；API 全部模拟，外部请求阻断，无数据库/AI 调用。"""
import importlib.util
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault('TYPEME_BROWSER_EVIDENCE', 'docs/optimization/verification/2026-09-21-ai-prompt-v4')
spec = importlib.util.spec_from_file_location('readable', ROOT / 'scripts/browser-verify-readable.py')
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
BASE = os.environ.get('TYPEME_PROMPT_BROWSER_BASE', 'http://127.0.0.1:5189')


def route_request(route):
    url = urlparse(route.request.url)
    if url.netloc != urlparse(BASE).netloc:
        route.abort()
    elif url.path == '/api/v3/platform/illustrations':
        route.fulfill(json={'assets': []})
    elif url.path == '/api/v3/ai/status':
        route.fulfill(json={'enabled': True, 'mock': True, 'model': 'mock',
                            'dailyLimitPerUser': 2, 'remainingToday': 2,
                            'apiKeySource': 'none', 'promptVersion': 'typeme-ai-prompt-v4'})
    elif url.path.startswith('/api/'):
        # 其他响应仍带 v3 历史任务，验证升级后可继续阅读。
        fixtures.api(route)
    else:
        route.continue_()


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for width in (320, 390, 1440):
        context = browser.new_context(viewport={'width': width, 'height': 900}, reduced_motion='reduce')
        context.route('**/*', route_request)
        page = context.new_page()
        page.on('pageerror', lambda error: fixtures.errors.append(str(error)))
        for report_id in ('jung-v2', 'bigfive'):
            fixtures.mode['ai'] = 'success'
            page.goto(f'{BASE}/#/reports/{report_id}')
            page.locator('[data-ai-result]').wait_for()
            fixtures.check('差距小' in page.locator('[data-ai-summary]').inner_text(),
                           f'{width}/{report_id}: v3 historical result remains readable')
            start = page.locator('[data-ai-start]')
            fixtures.check(start.is_enabled(), f'{width}/{report_id}: v4 generation enabled')
            start.scroll_into_view_if_needed()
            start.focus()
            page.keyboard.press('Enter')
            consent = page.locator('[data-ai-consent]')
            fixtures.check('最多 5 条维度摘要' in consent.inner_text(),
                           f'{width}/{report_id}: unchanged dimension-only consent')
            fixtures.check('最多 8 条作答片段' not in consent.inner_text(),
                           f'{width}/{report_id}: no legacy answer scope')
            confirm = page.get_by_role('button', name='确认生成', exact=True)
            fixtures.check(confirm.is_disabled(), f'{width}/{report_id}: consent required')
            consent.locator('input[type=checkbox]').check()
            fixtures.check(confirm.is_enabled(), f'{width}/{report_id}: consent enables generation')
            confirm.scroll_into_view_if_needed()
            confirm.focus()
            fixtures.check(confirm.evaluate('(el) => document.activeElement === el'),
                           f'{width}/{report_id}: main action keyboard reachable')
            fixtures.layout(page, f'{width}/{report_id}')
            page.screenshot(path=str(fixtures.OUT / f'consent-{report_id}-{width}.png'))
            page.goto('about:blank')
        context.close()
    browser.close()

fixtures.check(not fixtures.errors, 'no uncaught browser errors')
fixtures.check(not fixtures.unexpected, 'all APIs mocked and accounted for: ' + str(fixtures.unexpected))
(fixtures.OUT / 'browser-results.json').write_text(json.dumps({
    'scope': 'Vite source, synthetic reports, mocked APIs; no database or external AI',
    'checks': fixtures.checks, 'errors': fixtures.errors,
    'unexpectedApis': fixtures.unexpected,
}, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'{len(fixtures.checks)} browser checks passed; evidence: {fixtures.OUT}')
