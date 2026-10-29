"""Admin member quota UI acceptance (2026-10-28): exhausted filter, batch set, restore default.

Serves the existing frontend/dist build on 127.0.0.1:5179 and intercepts every API request with
synthetic members; no backend, database or external AI is involved. Run `npm run build` in frontend first.
"""
import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'frontend/dist'
OUT = ROOT / 'docs/2026-10-28/verification/admin-quota'
OUT.mkdir(parents=True, exist_ok=True)
BASE = 'http://127.0.0.1:5179'
DATE = '2026-10-28T00:00:00Z'
SITE_DEFAULT = 2
checks, errors, unexpected, writes = [], [], [], []
state = {}


def check(ok, label):
    checks.append({'label': label, 'passed': bool(ok)})
    assert ok, label


def reply(route, payload, status=200):
    route.fulfill(status=status, content_type='application/json', body=json.dumps(payload, ensure_ascii=False))


def reset_state():
    members = []
    for i in range(1, 26):
        limit = None if i % 3 == 0 else (0 if i == 5 else 2)
        used = 2 if i % 2 == 1 else 1
        if i == 5:
            used = 0
        members.append(dict(id=f'm{i:02d}', username=f'reader_{i:02d}', nickname=f'成员{i:02d}号', limit=limit, used=used))
    state.update(members=members, deleted={'m03'})


def view(m):
    effective = SITE_DEFAULT if m['limit'] is None else m['limit']
    return dict(id=m['id'], username=m['username'], nickname=m['nickname'], role='USER', status='ACTIVE',
                createdAt=DATE, lastSeenAt=DATE, reportCount=1, attemptCount=2, aiDailyLimit=m['limit'],
                effectiveAiDailyLimit=effective, aiUsedToday=m['used'], aiRemainingToday=max(0, effective - m['used']),
                quotaDate='2026-10-28')


def exhausted(m):
    effective = SITE_DEFAULT if m['limit'] is None else m['limit']
    return effective > 0 and m['used'] >= effective


def api(route):
    url = urlparse(route.request.url)
    path, query = url.path, parse_qs(url.query)
    if path == '/api/v3/me':
        return reply(route, dict(userId='admin', username='demo_admin', nickname='演示管理员', role='ADMIN'))
    if path == '/api/v3/auth/csrf':
        return reply(route, dict(token='synthetic-only', headerName='X-XSRF-TOKEN', parameterName='_csrf'))
    if path == '/api/v3/admin/users':
        page, size = int(query.get('page', ['0'])[0]), int(query.get('size', ['20'])[0])
        rows = [m for m in state['members'] if m['id'] not in state['deleted']]
        if query.get('aiExhausted') == ['true']:
            rows = [m for m in rows if exhausted(m)]
        return reply(route, dict(items=[view(m) for m in rows[page * size:(page + 1) * size]], page=page, size=size, total=len(rows)))
    if path == '/api/v3/admin/users/ai-limits' and route.request.method == 'PUT':
        body = route.request.post_data_json
        writes.append(body)
        results = []
        for user_id in body['userIds']:
            m = next((x for x in state['members'] if x['id'] == user_id), None)
            if m is None or user_id in state['deleted']:
                results.append(dict(userId=user_id, ok=False, code='NOT_FOUND', message='成员不存在或已删除。'))
                continue
            m['limit'] = None if body['action'] == 'RESET_DEFAULT' else body['aiDailyLimit']
            results.append(dict(userId=user_id, ok=True, member=view(m)))
        updated = sum(1 for r in results if r['ok'])
        return reply(route, dict(updated=updated, failed=len(results) - updated, results=results))
    unexpected.append(f'{route.request.method} {path}')
    reply(route, {'code': 'NOT_FOUND', 'message': '验收未定义此请求'}, 404)


def capture(page, name, width):
    check(page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'), f'{width}/{name}: no horizontal overflow')
    page.screenshot(path=str(OUT / f'{name}-{width}.png'), full_page=True)


def min_height(locator):
    return min(box['height'] for box in (locator.nth(i).bounding_box() for i in range(locator.count())))


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 5179), partial(QuietHandler, directory=str(DIST)))
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        for width in (320, 390, 1440):
            reset_state()
            context = browser.new_context(viewport={'width': width, 'height': 800})
            context.route('**/api/**', api)
            page = context.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(BASE + '/#/admin/members')
            page.locator('.member-card').first.wait_for()
            check(page.locator('.member-card').count() == 20, f'{width}: first page shows 20 members')
            check(min_height(page.locator('.member-pick')) >= 44, f'{width}: pick targets are at least 44px tall')
            capture(page, 'list', width)

            # 筛选：只看今日额度已用完（服务端计数）。
            page.get_by_label('只看今日额度已用完').check()
            page.get_by_text('位今日额度已用完').wait_for()
            expected = sum(1 for m in state['members'] if m['id'] not in state['deleted'] and exhausted(m))
            count_text = page.locator('.members-section .section-top').inner_text()
            check(f'{expected} 位今日额度已用完' in count_text, f'{width}: filtered count from server ({expected}: {count_text!r})')
            check(page.locator('.member-card').count() == expected, f'{width}: only exhausted members listed')
            capture(page, 'filtered', width)

            # 全选本页 → 批量设定 → 确认。
            page.get_by_label('全选本页').check()
            bar = page.locator('[data-batch-bar]')
            bar.wait_for()
            page.locator('.member-item').last.scroll_into_view_if_needed()
            box = bar.bounding_box()
            check(box['y'] + box['height'] <= 800 + 1 and box['y'] >= 0, f'{width}: batch bar stays inside the viewport while scrolling')
            page.locator('[data-member-pick]').last.uncheck()   # 最后一张卡片的勾选框不能被底部操作区挡住
            page.locator('[data-member-pick]').last.check()
            heights = {bar.locator('button').nth(i).inner_text(): round(bar.locator('button').nth(i).bounding_box()['height'])
                       for i in range(bar.locator('button').count())}
            check(min(heights.values()) >= 44, f'{width}: batch buttons are at least 44px tall {heights}')
            bar.get_by_label('每日 AI 额度').fill('10')
            bar.get_by_role('button', name='设为该额度').click()
            page.locator('[data-batch-confirm]').wait_for()
            check(f'将修改 {expected} 位成员的每日额度为 10' in page.locator('[data-batch-confirm]').inner_text(), f'{width}: set confirmation names count and value')
            confirm_heights = [round(b.bounding_box()['height']) for b in page.locator('[data-batch-confirm] button').all()]
            check(min(confirm_heights) >= 44, f'{width}: confirm buttons are at least 44px tall {confirm_heights}')
            capture(page, 'confirm-set', width)
            page.get_by_role('button', name='确认修改').click()
            page.get_by_text(f'已将 {expected} 位成员的每日额度设为 10。', exact=False).wait_for()
            page.get_by_text('没有今天额度已用完的成员。').wait_for()
            check(writes[-1] == {'userIds': writes[-1]['userIds'], 'action': 'SET', 'aiDailyLimit': 10} and len(writes[-1]['userIds']) == expected,
                  f'{width}: one SET request with the selected ids')
            check(page.locator('[data-batch-bar]').count() == 0, f'{width}: selection cleared after success')
            capture(page, 'after-set', width)

            # 部分失败：勾选两人后、确认前，其中一人被删除（服务端返回 NOT_FOUND）。
            page.get_by_label('只看今日额度已用完').uncheck()
            page.locator('.member-card').nth(1).wait_for()
            page.locator('[data-member-pick]').nth(0).check()
            page.locator('[data-member-pick]').nth(1).check()
            bar.get_by_label('每日 AI 额度').fill('6')
            bar.get_by_role('button', name='设为该额度').click()
            page.locator('[data-batch-confirm]').wait_for()
            state['deleted'].add('m02')
            page.get_by_role('button', name='确认修改').click()
            failures = page.locator('[data-batch-failures]')
            failures.wait_for()
            check('成员02号：成员不存在或已删除。' in failures.inner_text(), f'{width}: failed member listed with reason')
            check('已保存 1 位成员，1 位未保存' in page.locator('.notice-success').inner_text(), f'{width}: partial notice is not "all saved"')
            check(page.get_by_text('成员02号', exact=True).count() == 0, f'{width}: deleted member gone after reload')
            capture(page, 'partial', width)

            # 恢复系统默认。
            page.locator('[data-member-pick]').nth(0).check()
            page.locator('[data-member-pick]').nth(2).check()
            page.locator('[data-batch-reset]').click()
            confirm_text = page.locator('[data-batch-confirm]').inner_text()
            check('将 2 位成员恢复为沿用系统默认额度' in confirm_text and '会被清除' in confirm_text, f'{width}: reset confirmation explains clearing')
            capture(page, 'confirm-reset', width)
            page.get_by_role('button', name='确认修改').click()
            page.get_by_text('已将 2 位成员恢复为沿用系统默认额度。', exact=False).wait_for()
            check(writes[-1]['action'] == 'RESET_DEFAULT' and 'aiDailyLimit' not in writes[-1], f'{width}: reset sends no aiDailyLimit')
            capture(page, 'after-reset', width)
            context.close()
        browser.close()
finally:
    server.shutdown()

check(not errors, 'No browser JS errors')
if unexpected:
    print('Unexpected API requests:', sorted(set(unexpected)))
(OUT / 'browser-checks.json').write_text(json.dumps({'checks': checks, 'errors': errors, 'unexpected': sorted(set(unexpected))},
                                                    ensure_ascii=False, indent=2), encoding='utf-8')
print(f'{len(checks)} checks passed; API entirely mocked; no database or external AI calls.')
