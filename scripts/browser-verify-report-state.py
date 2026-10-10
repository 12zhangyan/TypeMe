"""报告异步状态验收：真实 Chromium，全部 API 使用合成响应，阻断外部网络。

先构建 frontend/dist；默认读取 ReadableReportFixturesTest 生成的合成报告，
也可通过 TYPEME_REPORT_FIXTURE 指定同契约的合成 JSON。脚本不启动后端。
"""
import asyncio
import copy
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('TYPEME_REPORT_BASE', 'http://127.0.0.1:5199')
OUT = Path(os.environ.get('TYPEME_REPORT_OUT', str(ROOT / 'docs/optimization/verification/2026-10-10-report-state')))
FIXTURE = Path(os.environ.get('TYPEME_REPORT_FIXTURE', str(ROOT / 'backend/target/readable-browser-fixtures/jung-v2.json')))
checks, errors, unexpected = [], [], []


def check(ok, label):
    checks.append({'label': label, 'passed': bool(ok)})
    assert ok, label


async def scenario(browser, width, old_fails):
    label = f'{width}/old-{"failure" if old_fails else "success"}'
    context = await browser.new_context(viewport={'width': width, 'height': 900}, reduced_motion='reduce')
    page = await context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    snapshot = json.loads(FIXTURE.read_text(encoding='utf-8'))
    gates = {'report-a': asyncio.Event(), 'report-b': asyncio.Event()}
    entered = {'report-a': asyncio.Event(), 'report-b': asyncio.Event()}
    counts = {'report-a': 0, 'report-b': 0}

    async def api(route):
        request = route.request
        url = urlparse(request.url)
        if url.netloc != urlparse(BASE).netloc:
            await route.abort()
            return
        path, status, body = url.path, 200, {}
        if not path.startswith('/api/'):
            await route.continue_()
            return
        if path == '/api/v3/me':
            body = {'userId': 'synthetic-report-user', 'username': '页面验收示例', 'nickname': '演示用户'}
        elif path == '/api/v3/auth/csrf':
            body = {'token': 'synthetic-browser-only', 'headerName': 'X-XSRF-TOKEN', 'parameterName': '_csrf'}
        elif path == '/api/v3/platform/illustrations':
            body = {'assets': [], 'version': 'synthetic-empty', 'release': None}
        elif path.startswith('/api/v3/admin/'):
            status, body = 403, {'code': 'FORBIDDEN', 'message': '合成普通账号'}
        elif path == '/api/v3/platform/instruments':
            body = {'items': []}
        elif path in ('/api/v3/platform/attempts', '/api/v3/platform/reports', '/api/v3/reports'):
            body = {'items': [], 'total': 0, 'page': 0, 'size': 20}
        elif path == '/api/v3/catalog/current':
            body = {'packageId': 'typeme-jung48-zh-v2', 'questionCount': 48, 'basePerDimension': 12,
                    'title': '十六型人格参考测评', 'dimensions': []}
        elif path == '/api/v3/ai/status':
            body = {'enabled': False, 'mock': True, 'model': 'mock', 'dailyLimitPerUser': 0,
                    'remainingToday': 0, 'apiKeySource': 'none', 'promptVersion': 'typeme-ai-prompt-v5'}
        elif path.endswith('/analyses'):
            body = {'items': []}
        elif path.endswith('/self-reflection') and request.method == 'PUT':
            report_id = path.split('/')[-2]
            counts[report_id] += 1
            payload = request.post_data_json
            if counts[report_id] == 1:
                entered[report_id].set()
                await gates[report_id].wait()
            if (report_id == 'report-a' and old_fails) or (report_id == 'report-b' and counts[report_id] == 1):
                status, body = 503, {'code': 'SERVICE_UNAVAILABLE', 'message': '模拟保存失败，请重试'}
            else:
                body = {**payload, 'updatedAt': '2026-10-10T00:00:00Z'}
        elif path.startswith('/api/v3/reports/') and request.method == 'GET':
            report_id = path.rsplit('/', 1)[-1]
            report = copy.deepcopy(snapshot)
            report['reportId'] = report_id
            report['attemptId'] = 'synthetic-' + report_id
            body = {'report': report, 'attemptId': report['attemptId'], 'attemptRevision': 1,
                    'selfReflection': {'selfSelectedTypeCode': 'INFP',
                                       'note': '报告乙的原有理解' if report_id == 'report-b' else '报告甲的原有理解',
                                       'updatedAt': None}}
        elif path.startswith('/api/v1/') or path.startswith('/api/v2/'):
            status, body = 503, {'code': 'NOT_CONFIGURED', 'message': '旧内容使用内置副本'}
        else:
            unexpected.append(request.method + ' ' + path)
            status, body = 404, {'code': 'NOT_FOUND', 'message': '未定义的合成接口'}
        await route.fulfill(status=status, content_type='application/json', body=json.dumps(body, ensure_ascii=False))

    await context.route('**/*', api)
    try:
        await page.goto(BASE + '/#/reports/report-a')
        note = page.locator('#report-self textarea')
        save = page.locator('[data-save-reflection]')
        await expect(note).to_have_value('报告甲的原有理解')
        heading = await page.locator('h1').inner_text()
        await note.fill('报告甲的未完成保存')
        await save.click()
        await asyncio.wait_for(entered['report-a'].wait(), timeout=5)
        await expect(save).to_be_disabled()
        await page.evaluate("location.hash = '#/reports/report-b'")
        await expect(note).to_have_value('报告乙的原有理解')
        await expect(save).to_be_enabled()
        await expect(page.locator('[data-notice]')).to_have_count(0)
        check(True, label + ': switching releases save button and keeps target reflection')

        await note.fill('报告乙的新理解，失败后仍需保留')
        await note.focus()
        await page.keyboard.press('Tab')
        await expect(save).to_be_focused()
        await page.keyboard.press('Enter')
        await asyncio.wait_for(entered['report-b'].wait(), timeout=5)
        async with page.expect_request_finished(lambda request: request.url.endswith('/reports/report-a/self-reflection')) as request_info:
            gates['report-a'].set()
        await request_info.value
        await page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        await expect(save).to_be_disabled()
        await expect(note).to_have_value('报告乙的新理解，失败后仍需保留')
        await expect(page.locator('[data-notice]')).to_have_count(0)
        check(True, label + ': stale save cannot overwrite current reflection or save status')

        gates['report-b'].set()
        await expect(save).to_be_enabled()
        await expect(page.locator('[data-notice]')).to_contain_text('没有保存成功')
        await expect(note).to_have_value('报告乙的新理解，失败后仍需保留')
        await save.click()
        await expect(page.locator('[data-notice]')).to_contain_text('已保存')
        await expect(page.locator('h1')).to_have_text(heading)
        check(counts == {'report-a': 1, 'report-b': 2}, label + ': retry saves exactly once and fixed report is unchanged')

        await save.scroll_into_view_if_needed()
        await save.focus()
        await expect(save).to_be_focused()
        geometry = await save.evaluate('''button => {
            const rect = button.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return {reachable: button === hit || button.contains(hit),
                    width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth};
        }''')
        check(geometry['reachable'], label + ': save control is reachable and not covered')
        check(geometry['scroll'] <= geometry['width'] + 1, label + ': no horizontal overflow')
        await page.screenshot(path=str(OUT / f'report-{width}-old-{"failure" if old_fails else "success"}.png'))

        await page.evaluate("location.hash = '#/reports/report-a'")
        await expect(note).to_have_value('报告甲的原有理解')
        await expect(page.locator('[data-notice]')).to_have_count(0)
        await page.evaluate("location.hash = '#/reports'")
        await expect(page.locator('#report-self')).to_have_count(0)
        check(True, label + ': navigation clears previous success notice and exits detail')
    finally:
        gates['report-a'].set()
        gates['report-b'].set()
        await context.close()


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            try:
                for width in (320, 390, 1440):
                    for old_fails in (False, True):
                        await scenario(browser, width, old_fails)
            finally:
                await browser.close()
        check(not unexpected, 'all API requests matched synthetic handlers')
        check(not errors, 'no uncaught browser errors')
    finally:
        (OUT / 'browser-results.json').write_text(json.dumps({
            'checks': checks, 'pageErrors': errors, 'unexpectedApiRequests': unexpected,
            'apiMode': 'synthetic; external requests blocked; no backend/database/AI calls',
        }, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'PASS: {len(checks)} checks; widths 320/390/1440; synthetic APIs only')


if __name__ == '__main__':
    asyncio.run(main())
