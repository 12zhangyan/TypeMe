"""顶栏高度与页内跳转落点验收（A154，2026-10-19）。

静态构建 + 全部 API 拦截，无数据库、无真实 AI 调用。先 `npm run build`，再在 5178 启动静态服务器
（与 browser-verify-readable.py 相同）；报告页用 ReadableReportFixturesTest 生成的合成报告。
证据写入 docs/optimization/verification/2026-10-19-header-offset/。

逐个点报告页目录、关于页目录和首页「选择测评」，断言目标区块上沿不在顶栏下面，
且离顶栏下沿不超过 48px（页面已滚到底的末尾几节除外）。
"""
import copy
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/optimization/verification/2026-10-19-header-offset'
OUT.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('TYPEME_BASE', 'http://127.0.0.1:5178')
FIXTURE = Path(os.environ.get('TYPEME_REPORT_FIXTURE', str(ROOT / 'backend/target/readable-browser-fixtures/jung-v2.json')))
SLACK = 48
checks, errors, unexpected, landings = [], [], [], []


def check(ok, label):
    checks.append({'label': label, 'passed': bool(ok)})
    print(('  PASS ' if ok else '  FAIL ') + label)


def make_api(role, snapshot):
    def api(route):
        request = route.request
        url = urlparse(request.url)
        if url.netloc != urlparse(BASE).netloc:
            return route.abort()
        path, status, body = url.path, 200, {}
        if not path.startswith('/api/'):
            return route.continue_()
        if path == '/api/v3/me':
            if role == 'anon':
                status, body = 401, {'code': 'UNAUTHENTICATED', 'message': '未登录'}
            else:
                body = {'userId': 'synthetic-' + role, 'username': 'demo_' + role, 'nickname': '演示账号'}
        elif path == '/api/v3/auth/csrf':
            body = {'token': 'synthetic-browser-only', 'headerName': 'X-XSRF-TOKEN', 'parameterName': '_csrf'}
        elif path == '/api/v3/admin/ai-settings':
            if role == 'admin':
                body = {'enabled': False, 'mockMode': True}
            else:
                status, body = 403, {'code': 'FORBIDDEN', 'message': '合成普通账号'}
        elif path == '/api/v3/platform/illustrations':
            body = {'assets': [], 'version': 'synthetic-empty', 'release': None}
        elif path == '/api/v3/platform/instruments':
            body = {'items': []}
        elif path in ('/api/v3/attempts', '/api/v3/platform/attempts', '/api/v3/platform/reports', '/api/v3/reports'):
            body = {'items': [], 'total': 0, 'page': 0, 'size': 20}
        elif path == '/api/v3/catalog/current':
            body = {'packageId': 'typeme-jung48-zh-v2', 'questionCount': 48, 'basePerDimension': 12,
                    'title': '十六型人格参考测评', 'dimensions': []}
        elif path == '/api/v3/ai/status':
            body = {'enabled': False, 'mock': True, 'model': 'mock', 'dailyLimitPerUser': 0,
                    'remainingToday': 0, 'apiKeySource': 'none', 'promptVersion': 'typeme-ai-prompt-v5'}
        elif path.endswith('/analyses'):
            body = {'items': []}
        elif path.startswith('/api/v3/reports/') and request.method == 'GET':
            report = copy.deepcopy(snapshot)
            report['reportId'] = 'report-a'
            report['attemptId'] = 'synthetic-attempt'
            body = {'report': report, 'attemptId': 'synthetic-attempt', 'attemptRevision': 1,
                    'selfReflection': {'selfSelectedTypeCode': None, 'note': '', 'updatedAt': None}}
        elif path.startswith('/api/v1/') or path.startswith('/api/v2/'):
            status, body = 503, {'code': 'NOT_CONFIGURED', 'message': '旧内容使用内置副本'}
        else:
            unexpected.append(request.method + ' ' + path)
            status, body = 404, {'code': 'NOT_FOUND', 'message': '未定义的合成接口'}
        route.fulfill(status=status, content_type='application/json', body=json.dumps(body, ensure_ascii=False))
    return api


def header_bottom(page):
    return page.evaluate("document.querySelector('.site-header').getBoundingClientRect().bottom")


def settle(page):
    # 目录跳转是平滑滚动：等 scrollY 连续两帧不变。
    page.wait_for_function("""() => new Promise(r => {
        let last = -1, still = 0;
        const tick = () => { const y = scrollY; still = y === last ? still + 1 : 0; last = y;
            still >= 3 ? r(true) : requestAnimationFrame(tick) };
        tick();
    })""", timeout=4000)


def landed(page, target_id, label):
    settle(page)
    m = page.evaluate("""(id) => { const r = document.getElementById(id).getBoundingClientRect();
        const h = document.querySelector('.site-header').getBoundingClientRect().bottom;
        const atEnd = Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 1;
        return { top: r.top, header: h, atEnd } }""", target_id)
    landings.append({'label': label, **m})
    covered = m['top'] < m['header'] - 1
    near = m['top'] <= m['header'] + SLACK or m['atEnd']
    check(not covered and near, f"{label}: top {m['top']:.0f} vs header {m['header']:.0f}{' (page end)' if m['atEnd'] else ''}")


def check_var(page, label):
    m = page.evaluate("""() => ({ h: document.querySelector('.site-header').getBoundingClientRect().height,
        v: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) })""")
    check(abs(m['h'] - m['v']) <= 1, f"{label}: --header-h {m['v']} matches header {m['h']:.1f}")


snapshot = json.loads(FIXTURE.read_text(encoding='utf-8'))
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    for role in ('anon', 'user', 'admin'):
        for width in (320, 390, 1440):
            tag = f'{role}/{width}'
            context = browser.new_context(viewport={'width': width, 'height': 800})
            context.route('**/*', make_api(role, snapshot))
            page = context.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))

            page.goto(BASE + '/#/')
            page.get_by_role('button', name='选择测评').wait_for()
            page.wait_for_timeout(300)
            check_var(page, f'{tag} home')
            page.get_by_role('button', name='选择测评').click()
            landed(page, 'available-assessments', f'{tag} home → 选择测评')

            page.goto(BASE + '/#/about')
            nav = page.get_by_role('navigation', name='页内章节')
            nav.wait_for()
            for i in range(nav.get_by_role('button').count()):
                button = nav.get_by_role('button').nth(i)
                name = button.inner_text().strip()
                target = page.evaluate("(i) => { const ids = ['how','dimensions','result','source','data','records']; return ids[i] }", i)
                page.evaluate('scrollTo(0, 0)')
                button.click()
                landed(page, target, f'{tag} about → {name}')

            if role != 'anon':
                page.goto(BASE + '/#/reports/report-a')
                page.locator('[data-toc]').first.wait_for(state='attached')
                page.wait_for_timeout(300)
                check_var(page, f'{tag} report')
                ids = page.eval_on_selector_all('[data-toc]', 'els => els.map(e => e.dataset.toc)')
                toggle = page.get_by_role('button', name='查看报告目录')
                for target in ids:
                    page.evaluate('scrollTo(0, 0)')
                    if toggle.is_visible() and not page.locator(f'[data-toc="{target}"]').is_visible():
                        toggle.click()
                    page.locator(f'[data-toc="{target}"]').click()
                    landed(page, target, f'{tag} report → {target}')
                    check(page.evaluate('(id) => document.activeElement?.id === id', target), f'{tag} report → {target}: focus moved')
                if width >= 1024:
                    page.evaluate('scrollTo(0, 1600)')
                    settle(page)
                    toc_top = page.evaluate("document.querySelector('nav[aria-label=\"报告目录\"]').getBoundingClientRect().top")
                    check(toc_top >= header_bottom(page) - 1, f'{tag} report: sticky toc top {toc_top:.0f} below header {header_bottom(page):.0f}')
                page.evaluate('scrollTo(0, 0)')
                page.screenshot(path=str(OUT / f'report-{role}-{width}.png'))

            # 宽度变化后变量跟着顶栏走（ResizeObserver）。
            page.set_viewport_size({'width': 1440 if width < 1024 else 320, 'height': 800})
            page.wait_for_timeout(300)
            check_var(page, f'{tag} after resize')
            context.close()
    browser.close()

check(not errors, 'No browser JS errors')
if unexpected:
    print('Unexpected API paths:', sorted(set(unexpected)))
check(not unexpected, 'No unexpected API requests')
(OUT / 'browser-checks.json').write_text(json.dumps({'checks': checks, 'landings': landings, 'errors': errors,
    'unexpected': sorted(set(unexpected))}, ensure_ascii=False, indent=2), encoding='utf-8')
failed = [c['label'] for c in checks if not c['passed']]
print(f'{len(checks) - len(failed)} passed, {len(failed)} failed; API entirely mocked; no database or external AI calls.')
raise SystemExit(1 if failed else 0)
