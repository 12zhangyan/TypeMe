"""Admin UI acceptance: static build, synthetic users/reports, all API requests intercepted."""
import importlib.util
import json
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/optimization/verification/2026-09-18-admin'
OUT.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/browser-verify-readable.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
checks, errors, unexpected = [], [], []
state = {}
DATE = '2026-09-18T00:00:00Z'

def check(ok, label):
    checks.append({'label': label, 'passed': bool(ok)})
    assert ok, label

def reply(route, payload, status=200):
    route.fulfill(status=status, content_type='application/json', body=json.dumps(payload, ensure_ascii=False))

def member():
    return dict(id='member', username='demo_reader', nickname='林间读者', role='USER', status='ACTIVE',
        createdAt=DATE, lastSeenAt=DATE, reportCount=2, attemptCount=3, aiDailyLimit=state['limit'],
        effectiveAiDailyLimit=state['limit'], aiUsedToday=1, aiRemainingToday=max(0, state['limit']-1), quotaDate='2026-09-18')

def page_data(items, page=0, size=10, total=None):
    return dict(items=items, page=page, size=size, total=len(items) if total is None else total)

def report_row(report_id):
    raw = fixture.reports[report_id]
    big = report_id == 'bigfive'
    return dict(reportId=report_id, attemptId='attempt-'+report_id, instrumentSlug='bigfive50' if big else 'jung48',
        instrumentKind='big_five' if big else 'jung', instrumentTitle='大五人格倾向测评' if big else '十六型人格参考测评',
        reportKind='big_five_profile' if big else 'jung_reference', packageId='synthetic', status=raw['status'],
        computedTypeCode=raw.get('computedTypeCode'), summaryLine='一份来自合成回答的参考报告。', createdAt=DATE)

def api(route):
    path = urlparse(route.request.url).path
    query = parse_qs(urlparse(route.request.url).query)
    page = int(query.get('page', ['0'])[0])
    if path == '/api/v3/me':
        return reply(route, dict(userId='admin', username='demo_admin', nickname='演示管理员')) if state['signed_in'] else reply(route, dict(code='UNAUTHENTICATED', message='请先登录'), 401)
    if path == '/api/v3/auth/csrf':
        return reply(route, dict(token='synthetic-only', headerName='X-XSRF-TOKEN', parameterName='_csrf'))
    if path == '/api/v3/platform/instruments': return reply(route, {'items': fixture.catalog})
    if path.startswith('/api/v3/admin/'):
        if state['denied']: return reply(route, dict(code='FORBIDDEN', message='仅管理员可访问'), 403)
        if state['expired']: return reply(route, dict(code='UNAUTHENTICATED', message='登录已失效'), 401)
        if state['failure']: return reply(route, dict(code='SERVICE_UNAVAILABLE', message='暂时无法读取，请重试'), 503)
        if path == '/api/v3/admin/users': return reply(route, page_data([member()] if page == 0 else [{**member(), 'id':'second', 'nickname':'另一位成员'}], page, 20, 21))
        if path.endswith('/ai-limit'):
            state['limit'] = route.request.post_data_json['aiDailyLimit']
            return reply(route, member())
        if path == '/api/v3/admin/invitations':
            if route.request.method == 'POST':
                state['invitations'].insert(0, dict(id='new', createdAt=DATE, expiresAt=route.request.post_data_json['expiresAt'], usedByUsername=None, status='AVAILABLE'))
                return reply(route, dict(id='new', code='SYNTHETIC_ONLY_INVITATION_12345678', expiresAt=state['invitations'][0]['expiresAt']))
            return reply(route, page_data(state['invitations']))
        if path.endswith('/revoke'):
            for i in state['invitations']:
                if i['id'] == path.split('/')[-2]: i['status'] = 'REVOKED'
            return reply(route, {'revoked':True})
        if path.endswith('/attempts'):
            a = dict(attemptId='draft', instrumentSlug='jung48', instrumentKind='jung', instrumentTitle='十六型人格参考测评', packageId='synthetic',
                reportContentVersion=None, status='BASE_IN_PROGRESS', revision=1, startedAt=DATE, updatedAt=DATE,
                submittedAt=None, reportId=None, reportStatus=None, computedTypeCode=None, answeredCount=12, requiredCount=48)
            return reply(route, page_data([a]))
        if path.endswith('/reports'): return reply(route, page_data([report_row('jung-v2'), report_row('bigfive'), report_row('jung-tied')]))
        if '/reports/' in path:
            report_id = path.split('/')[-1]
            return reply(route, {**report_row(report_id), 'report':fixture.reports[report_id], 'selfReflection':{}, 'attemptRevision':1})
    if path == '/api/v3/catalog/current': return fixture.api(route)
    # Legacy footer metadata uses the bundled fallback in this static acceptance server.
    if path in ('/api/v1/meta', '/api/v2/assessment-packages/ipip50-zh1'):
        return reply(route, {'code':'NOT_FOUND','message':'Use bundled legacy content'}, 404)
    unexpected.append(path)
    reply(route, {'code':'NOT_FOUND','message':'验收未定义此请求'}, 404)

def capture(page, name, width):
    check(page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'), f'{name}/{width}: no overflow')
    page.screenshot(path=str(OUT / f'{name}-{width}.png'), full_page=True)

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    for width in (320, 390, 1440):
        state.update(signed_in=True, limit=3, denied=False, expired=False, failure=False,
            invitations=[dict(id='old', createdAt=DATE, expiresAt='2027-01-01T00:00:00Z', usedByUsername=None, status='AVAILABLE')])
        context = browser.new_context(viewport={'width':width, 'height':900})
        context.route('**/api/**', api)
        page = context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(fixture.BASE + '/#/admin/members')
        page.get_by_role('heading', name='从一份邀请开始').wait_for()
        capture(page, 'members', width)
        page.get_by_role('button', name='生成邀请码').click()
        page.get_by_test_id('new-invitation').wait_for()
        check(page.get_by_test_id('new-invitation').inner_text().startswith('SYNTHETIC'), f'{width}: one-time invite shown')
        check(page.evaluate("!JSON.stringify(localStorage).includes('SYNTHETIC_ONLY') && !JSON.stringify(sessionStorage).includes('SYNTHETIC_ONLY')"), f'{width}: invite never persisted')
        page.get_by_role('button', name='我已保存，隐藏').click()
        page.get_by_role('button', name='撤销', exact=True).first.click()
        page.get_by_text('邀请码已撤销。', exact=True).wait_for()
        check(page.get_by_text('已撤销', exact=True).count() == 1, f'{width}: revoke updates state')
        page.locator('.member-card').first.click()
        page.get_by_role('heading', name='林间读者', exact=True).wait_for()
        check('12 / 48' in page.locator('.member-detail').inner_text(), f'{width}: progress shown')
        page.get_by_label('每日 AI 额度', exact=True).fill('0')
        page.get_by_role('button', name='保存额度', exact=True).click()
        page.get_by_text('每日额度已保存。今天已经使用的次数保留。', exact=True).wait_for()
        check('今日已用 1 次，剩余 0 次' in page.locator('.quota-form').inner_text(), f'{width}: zero quota preserves usage')
        for index, name in enumerate(('jung', 'bigfive', 'tied')):
            page.get_by_role('button', name='阅读报告 →', exact=True).nth(index).click()
            page.locator('.admin-readout h3').wait_for()
            check(page.locator('.admin-readout [role=alert]').count() == 0, f'{width}/{name}: snapshot parsed')
            if name == 'tied': check('几个类型' in page.locator('.admin-readout h3').inner_text(), f'{width}: tied remains uncertain')
            capture(page, 'report-'+name, width)
        page.get_by_role('navigation', name='成员翻页').get_by_role('button', name='下一页').click()
        page.get_by_text('另一位成员', exact=True).wait_for()
        check(True, f'{width}: member pagination works')
        state['expired'] = True
        page.get_by_role('navigation', name='成员翻页').get_by_role('button', name='上一页').click()
        page.locator('.member-card').first.wait_for(state='detached')
        check(page.locator('.member-card').count() == 0 and page.locator('.admin-readout').count() == 0, f'{width}: session expiry clears sensitive UI')
        state.update(expired=False, denied=True)
        page.reload()
        page.get_by_text('此页面仅对管理员开放。', exact=False).wait_for()
        check(page.locator('.member-card').count() == 0, f'{width}: forbidden hides admin data')
        capture(page, 'forbidden', width)
        state.update(denied=False, failure=True)
        page.reload()
        page.get_by_role('button', name='重试', exact=True).wait_for()
        state['failure'] = False
        page.get_by_role('button', name='重试', exact=True).click()
        page.locator('.member-card').first.wait_for()
        check(True, f'{width}: failed load can retry')
        state['signed_in'] = False
        page.close()
        page = context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(fixture.BASE + '/#/register')
        page.reload()
        page.get_by_label('邀请码', exact=True).wait_for()
        check('管理员可查看账号状态' in page.locator('form').inner_text(), f'{width}: registration disclosure')
        page.get_by_label('邀请码', exact=True).focus()
        check(page.get_by_label('邀请码', exact=True).evaluate('el => el === document.activeElement'), f'{width}: invite field keyboard focus')
        capture(page, 'register', width)
        context.close()
    browser.close()
check(not errors, 'No browser JS errors')
if unexpected: print('Unexpected API paths:', sorted(set(unexpected)))
check(not unexpected, 'No unexpected API requests')
(OUT/'browser-checks.json').write_text(json.dumps({'checks':checks, 'errors':errors, 'unexpected':unexpected}, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'{len(checks)} checks passed; API entirely mocked; no database or external AI calls.')
