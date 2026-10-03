"""Review 修复验收：真实 Chromium + 合成草稿/API 替身，阻断外部请求，不连接数据库。"""
import asyncio
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('TYPEME_REVIEW_BASE', 'http://127.0.0.1:5197')
OUT = Path(os.environ.get('TYPEME_REVIEW_OUT', str(ROOT / 'docs/optimization/verification/2026-09-21-review-fixes')))
OUT.mkdir(parents=True, exist_ok=True)
checks, errors, unexpected = [], [], []


def check(ok, label):
    checks.append({'label': label, 'passed': bool(ok)})
    assert ok, label


async def scenario(browser, width):
    context = await browser.new_context(viewport={'width': width, 'height': 900}, reduced_motion='reduce')
    items = [{'id': f'Q{i:02}', 'kind': 'agreement_statement', 'stage': 'base',
              'dimension': ['E', 'A', 'C', 'ES', 'O'][(i - 1) // 10], 'order': i,
              'statement': '与熟悉的人在一起时，我通常愿意主动分享最近的经历。',
              'direction': 1, 'help': '请回想日常生活中的实际情况。'} for i in range(1, 51)]
    answers = {'Q01': {'questionId': 'Q01', 'kind': 'UNKNOWN', 'rating': None},
               'Q02': {'questionId': 'Q02', 'kind': 'RATING', 'rating': 3}}
    revision, current, patches = 2, 'Q03', []
    mode = {'delay': False, 'fail': False, 'conflict': False}
    gate, entered = asyncio.Event(), asyncio.Event()

    async def api(route):
        nonlocal revision, current
        request = route.request
        url = urlparse(request.url)
        if url.netloc != urlparse(BASE).netloc:
            await route.abort()
            return
        path, status = url.path, 200
        if not path.startswith('/api/'):
            await route.continue_()
            return
        if path == '/api/v3/me':
            body = {'userId': 'synthetic-review', 'username': '验收示例', 'nickname': '演示用户'}
        elif path == '/api/v3/auth/csrf':
            body = {'token': 'synthetic-csrf', 'headerName': 'X-XSRF-TOKEN', 'parameterName': '_csrf'}
        elif path == '/api/v3/platform/illustrations':
            body = {'assets': []}
        elif path.startswith('/api/v3/admin/'):
            status, body = 403, {'code': 'FORBIDDEN', 'message': '示例账号不是管理员'}
        elif path == '/api/v3/platform/attempts/review-draft':
            body = {'attemptId': 'review-draft', 'instrumentSlug': 'bigfive50', 'instrumentKind': 'big_five',
                    'instrumentTitle': '大五人格倾向测评', 'packageId': 'typeme-bigfive50-zh-v1',
                    'reportKind': 'big_five_profile', 'status': 'BASE_IN_PROGRESS', 'revision': revision,
                    'currentQuestionId': current, 'clarificationDimensions': [], 'clarificationSkipped': False,
                    'startedAt': '2026-09-21T00:00:00Z', 'updatedAt': '2026-09-21T00:00:00Z',
                    'submittedAt': None, 'baseAttemptId': None, 'reportId': None,
                    'answers': list(answers.values()), 'items': items, 'answeredCount': len(answers),
                    'requiredCount': 50, 'answerComplete': len(answers) == 50}
        elif path == '/api/v3/platform/attempts/review-draft/answers' and request.method == 'PATCH':
            payload = request.post_data_json
            patches.append(payload)
            if mode['delay']:
                mode['delay'] = False
                entered.set()
                await gate.wait()
            if mode['fail']:
                mode['fail'] = False
                status, body = 503, {'code': 'SERVICE_UNAVAILABLE', 'message': '模拟保存失败'}
            elif mode['conflict'] or payload['expectedRevision'] != revision:
                status, body = 409, {'code': 'CONFLICT_REVISION', 'message': '另一台设备更新了草稿',
                                     'details': {'currentRevision': revision}}
            else:
                for answer in payload['responses']:
                    if answer['kind'] == 'CLEAR':
                        answers.pop(answer['questionId'], None)
                    else:
                        answers[answer['questionId']] = answer
                revision += 1
                current = payload.get('currentQuestionId') or current
                body = {'revision': revision, 'status': 'BASE_IN_PROGRESS', 'answeredCount': len(answers),
                        'requiredCount': 50, 'answerComplete': len(answers) == 50, 'currentQuestionId': current}
        elif path == '/api/v3/platform/instruments':
            body = {'items': []}
        elif path == '/api/v3/catalog/current':
            status, body = 503, {'code': 'PACKAGE_UNAVAILABLE', 'message': '本次只验证大五，十六型目录模拟离线'}
        elif path.startswith('/api/v1/') or path.startswith('/api/v2/'):
            status, body = 503, {'code': 'NOT_CONFIGURED', 'message': '使用内置旧量表内容'}
        else:
            unexpected.append(request.method + ' ' + path)
            status, body = 404, {'code': 'NOT_FOUND', 'message': '未定义的验收接口'}
        await route.fulfill(status=status, content_type='application/json', body=json.dumps(body, ensure_ascii=False))

    await context.route('**/*', api)
    page = await context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    await page.goto(BASE + '/#/assess/review-draft')
    await expect(page.locator('[data-bigfive-item="Q03"]')).to_be_visible()
    # 恢复后的第一个修改，保存期间再改同题；第二批必须用新 revision 串行发送。
    await page.get_by_role('radio').nth(0).click()
    mode['delay'] = True
    await page.locator('[data-bigfive-next]').click()
    await asyncio.wait_for(entered.wait(), timeout=5)
    await page.get_by_role('radio').nth(4).click()
    await expect(page.locator('[data-bigfive-next]')).to_be_disabled()
    await expect(page.locator('[data-bigfive-save-state]')).to_contain_text('正在保存')
    gate.set()
    await expect(page.locator('[data-bigfive-item="Q04"]')).to_be_visible()
    await expect(page.locator('[data-bigfive-save-state]')).to_contain_text('已保存')
    check(answers['Q03']['rating'] == 5, f'{width}: resume and edit during save persist latest answer')
    check(len(patches) == 2 and patches[1]['expectedRevision'] == 3, f'{width}: saves serialized with confirmed revision')
    # 撤销曾保存的 unknown，刷新后仍为未作答。
    await page.locator('[data-bigfive-prev]').click()
    await page.locator('[data-bigfive-prev]').click()
    await page.locator('[data-bigfive-prev]').click()
    await expect(page.locator('[data-bigfive-item="Q01"]')).to_be_visible()
    await page.locator('[data-bigfive-unknown]').click()
    await page.locator('[data-bigfive-next]').click()
    await expect(page.locator('[data-bigfive-item="Q02"]')).to_be_visible()
    check('Q01' not in answers, f'{width}: clearing persisted unknown reaches server')
    await page.reload()
    await expect(page.locator('[data-bigfive-item="Q01"]')).to_be_visible()
    await expect(page.locator('[data-bigfive-unknown]')).to_have_attribute('aria-pressed', 'false')
    check(True, f'{width}: cleared answer stays empty after refresh')
    # 保存失败保留答案，键盘可达的重试按钮恢复。
    await page.get_by_role('radio').nth(3).click()
    mode['fail'] = True
    await page.locator('[data-bigfive-next]').click()
    await expect(page.locator('[data-bigfive-save-error]')).to_be_visible()
    await expect(page.locator('[data-bigfive-save-state]')).to_contain_text('还没保存')
    retry = page.get_by_role('button', name='再试一次保存')
    await retry.scroll_into_view_if_needed()
    await retry.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-bigfive-save-error]')).to_have_count(0)
    check(answers['Q01']['rating'] == 4, f'{width}: failed save retains answer and keyboard retry succeeds')
    # 冲突暂停写入，不以新 revision 自动覆盖。
    mode['conflict'] = True
    await page.get_by_role('radio').nth(0).click()
    await page.locator('[data-bigfive-next]').click()
    await expect(page.locator('[data-bigfive-conflict]')).to_be_visible()
    count = len(patches)
    await page.locator('[data-bigfive-next]').click()
    check(len(patches) == count, f'{width}: conflict blocks further writes')
    reload_button = page.locator('[data-bigfive-reload]')
    await reload_button.scroll_into_view_if_needed()
    await reload_button.focus()
    check(await reload_button.evaluate('(el) => document.activeElement === el'), f'{width}: conflict action keyboard reachable')
    box = await reload_button.bounding_box()
    check(box['x'] >= 0 and box['x'] + box['width'] <= width + 1 and 0 <= box['y'] < 900,
          f'{width}: main action visible within viewport')
    check(await page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'),
          f'{width}: no horizontal overflow')
    await page.screenshot(path=str(OUT / f'bigfive-conflict-{width}.png'), full_page=True)
    await context.close()


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            for width in (320, 390, 1440):
                await scenario(browser, width)
            check(not errors, 'no uncaught browser errors')
            check(not unexpected, 'all API requests mocked')
        finally:
            await browser.close()
            (OUT / 'browser-results.json').write_text(json.dumps({'checks': checks, 'errors': errors,
                'unexpectedApis': unexpected, 'scope': 'Chromium, Vite source, synthetic API; no database or AI'},
                ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'{len(checks)} browser checks passed; evidence: {OUT}')


if __name__ == '__main__':
    asyncio.run(main())
