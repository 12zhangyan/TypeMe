"""成员与邀请页的错误提示验收（2026-10-19）：撤销已用邀请码的 409、服务端原话与报障编号、重新登录入口。

静态构建 + 全部 API 拦截，无数据库、无真实 AI 调用。先 `npm run build`，再在 5178 启动静态服务器
（与 browser-verify-readable.py 相同）。证据写入 docs/optimization/verification/2026-10-19-admin-members-errors/。
"""
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/optimization/verification/2026-10-19-admin-members-errors'
OUT.mkdir(parents=True, exist_ok=True)
BASE = 'http://127.0.0.1:5178'
DATE = '2026-10-19T00:00:00Z'
CONFLICT = '邀请码已经使用，不能撤销注册。请刷新列表查看使用状态。'
checks, errors, unexpected = [], [], []
state = {}


def check(ok, label):
    checks.append({'label': label, 'passed': bool(ok)})
    assert ok, label


def reply(route, payload, status=200):
    route.fulfill(status=status, content_type='application/json', body=json.dumps(payload, ensure_ascii=False))


def member():
    return dict(id='member', username='demo_reader', nickname='林间读者', role='USER', status='ACTIVE',
        createdAt=DATE, lastSeenAt=DATE, reportCount=1, attemptCount=1, aiDailyLimit=None,
        effectiveAiDailyLimit=3, aiUsedToday=0, aiRemainingToday=3, quotaDate='2026-10-19')


def api(route):
    path = urlparse(route.request.url).path
    method = route.request.method
    if path == '/api/v3/me':
        return reply(route, dict(userId='admin', username='demo_admin', nickname='演示管理员'))
    if path == '/api/v3/auth/csrf':
        return reply(route, dict(token='synthetic-only', headerName='X-XSRF-TOKEN', parameterName='_csrf'))
    if path.startswith('/api/v3/admin/'):
        if state['denied']:
            return reply(route, dict(code='FORBIDDEN', message='仅管理员可访问', requestId='req-403'), 403)
        if path == '/api/v3/admin/ai-settings':
            # 顶栏的管理员探测（useAdminProbe）；本页不读设置内容。
            return reply(route, dict(enabled=False, mockMode=True))
        if path == '/api/v3/admin/users':
            return reply(route, dict(items=[member()], page=0, size=20, total=1))
        if path == '/api/v3/admin/invitations' and method == 'GET':
            state['list_calls'] += 1
            return reply(route, dict(items=state['invitations'], page=0, size=10, total=len(state['invitations'])))
        if path.endswith('/revoke'):
            state['revoke_calls'] += 1
            # 另一位管理员刚把这份邀请码交给受邀人并完成注册：服务端已是 USED。
            state['invitations'] = [dict(state['invitations'][0], status='USED', usedByUsername='new_member')]
            return reply(route, dict(code='CONFLICT', message=CONFLICT, requestId='req-409'), 409)
    if path in ('/api/v1/meta', '/api/v2/assessment-packages/ipip50-zh1', '/api/v3/catalog/current', '/api/v3/platform/instruments', '/api/v3/platform/illustrations'):
        return reply(route, {'code': 'NOT_FOUND', 'message': 'Use bundled content'}, 404)
    unexpected.append(f'{method} {path}')
    reply(route, {'code': 'NOT_FOUND', 'message': '验收未定义此请求'}, 404)


def capture(page, name, width):
    check(page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'), f'{name}/{width}: no overflow')
    page.screenshot(path=str(OUT / f'{name}-{width}.png'), full_page=True)


with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    for width in (320, 390, 1440):
        state.update(denied=False, list_calls=0, revoke_calls=0,
            invitations=[dict(id='inv-1', createdAt=DATE, expiresAt='2026-10-26T00:00:00Z', usedByUsername=None, status='AVAILABLE')])
        context = browser.new_context(viewport={'width': width, 'height': 900})
        context.route('**/api/**', api)
        page = context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(BASE + '/#/admin/members')
        page.get_by_role('heading', name='从一份邀请开始').wait_for()

        revoke = page.get_by_role('button', name='撤销', exact=True)
        revoke.focus()
        page.keyboard.press('Enter')
        notice = page.locator('[data-admin-error]')
        notice.wait_for()
        page.get_by_text('使用人：new_member', exact=True).wait_for()
        # 页面使用平滑滚动：轮询到落点稳定，最多 2 秒。
        try:
            page.wait_for_function("""() => {
                const el = document.querySelector('[data-admin-error]'); const r = el.getBoundingClientRect();
                const top = document.elementFromPoint(r.left + r.width / 2, r.top + 4);
                return r.top >= 0 && r.bottom <= window.innerHeight && !!top && el.contains(top);
            }""", timeout=2000)
            visible = True
        except Exception:
            visible = False
        check(visible, f'{width}: failure notice scrolled into view and not covered by sticky header')
        check(state['revoke_calls'] == 1, f'{width}: revoke sent once')
        check(state['list_calls'] == 2, f'{width}: 409 refreshes invitation list once')
        check(page.get_by_role('button', name='撤销', exact=True).count() == 0, f'{width}: used invitation no longer offers revoke')
        check(page.locator('.invite-row .status-tag').first.inner_text() == '已使用', f'{width}: row shows server status')
        text = notice.inner_text()
        check(CONFLICT in text, f'{width}: server message shown')
        check('req-409' in text, f'{width}: request id shown')
        check('重新登录' not in text, f'{width}: conflict does not suggest re-login')
        check(page.get_by_text('邀请码已撤销。', exact=True).count() == 0, f'{width}: no false success')
        capture(page, 'revoke-conflict', width)

        state['denied'] = True
        page.reload()
        page.get_by_text('此页面仅对管理员开放。', exact=False).wait_for()
        check(page.locator('[data-admin-error]').get_by_role('link', name='重新登录').count() == 1, f'{width}: forbidden offers re-login')
        check('req-403' in page.locator('[data-admin-error]').inner_text(), f'{width}: forbidden shows request id')
        check(page.locator('.member-card').count() == 0, f'{width}: forbidden hides admin data')
        capture(page, 'forbidden', width)
        context.close()
    browser.close()
check(not errors, 'No browser JS errors')
if unexpected:
    print('Unexpected API paths:', sorted(set(unexpected)))
check(not unexpected, 'No unexpected API requests')
(OUT / 'browser-checks.json').write_text(json.dumps({'checks': checks, 'errors': errors, 'unexpected': unexpected}, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'{len(checks)} checks passed; API entirely mocked; no database or external AI calls.')
