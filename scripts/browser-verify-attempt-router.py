"""限制范围内的浏览器验证：`/#/assess/:attemptId` 分流页在 320 / 390 / 1440 的**真实渲染结果**。

验的是"从入口进去，落到正确的答题页"，不是单独展示答题组件：

  - 十六型草稿：大五端点回 409 INSTRUMENT_MISMATCH → 必须看到**十六型答题页**（题干、进度）
  - 大五草稿：大五端点回 200 → 必须看到**大五答题页**
  - 不存在的 id：404 → 必须看到"没有找到这份测评"，**不能**出现答题页
  - 会话失效：401 → 必须看到错误提示，不能出现答题页
  - 版本不可用：409 PACKAGE_UNAVAILABLE → 错误提示，不能出现答题页

替身响应**不是手写的**：`backend/target/attempt-router-fixtures/` 里的 JSON 由
`PlatformAttemptDispatchIT`（H2 实跑）导出，是服务端真发过的字节。
仍然**没有数据库、没有后端进程、没有真实 AI**，所以这只是模拟接口下的界面验证。

前置：
  1. `mvn -q test -Dtest=PlatformAttemptDispatchIT`（导出夹具）
  2. 前端构建到隔离目录（不覆盖 `frontend/dist`）：
     `npx vite build --outDir %TEMP%/typeme-router-verify-dist --emptyOutDir`
  3. 静态服务：`python -m http.server 5179 --bind 127.0.0.1 --directory <上面那个目录>`

用法：python scripts/browser-verify-attempt-router.py
"""
import json
import os
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / os.environ.get(
    'TYPEME_BROWSER_EVIDENCE',
    'docs/2026-09-16/implementation/verification/2026-09-20-attempt-router')
FIXTURES = ROOT / 'backend/target/attempt-router-fixtures'
BASE = os.environ.get('TYPEME_BROWSER_BASE', 'http://127.0.0.1:5179')
OUT.mkdir(parents=True, exist_ok=True)

REQUIRED = [
    'jung-draft-platform-mismatch.json',
    'jung-attempt-detail.json',
    'bigfive-attempt-detail.json',
    'attempt-not-found.json',
    'attempt-unauthenticated.json',
    'bigfive-draft-jung-endpoint.json',
]
missing = [name for name in REQUIRED if not (FIXTURES / name).exists()]
assert not missing, (
    f'缺少真实响应夹具 {missing}：先运行 mvn test -Dtest=PlatformAttemptDispatchIT')
fixtures = {name: json.loads((FIXTURES / name).read_text(encoding='utf-8')) for name in REQUIRED}

# 夹具必须自报身份：这是"替身来自服务端"的唯一凭据，别把别的错误体当成它。
assert fixtures['jung-draft-platform-mismatch.json']['code'] == 'INSTRUMENT_MISMATCH'
assert fixtures['attempt-not-found.json']['code'] == 'NOT_FOUND'
assert fixtures['attempt-unauthenticated.json']['code'] == 'UNAUTHENTICATED'
assert fixtures['bigfive-draft-jung-endpoint.json']['code'] == 'PACKAGE_UNAVAILABLE'
assert fixtures['bigfive-attempt-detail.json']['instrumentKind'] == 'big_five'
assert fixtures['jung-attempt-detail.json']['packageId'].startswith('typeme-jung48-zh-')

JUNG_ID = 'jung-draft-1'
BIG_FIVE_ID = 'bigfive-draft-1'
MISSING_ID = 'no-such-attempt'
EXPIRED_ID = 'expired-session-draft'
UNAVAILABLE_ID = 'package-gone-draft'

checks = []
errors = []
unexpected = []


def check(ok, label):
    checks.append({'label': label, 'passed': bool(ok)})
    if not ok:
        raise AssertionError(label)


def with_ids(payload, attempt_id):
    """把夹具里的占位 id 换成这次要访问的 id（其余字节保持服务端原样）。"""
    return json.loads(json.dumps(payload, ensure_ascii=False).replace('"<attemptId>"', f'"{attempt_id}"'))


def api(route):
    path = urlparse(route.request.url).path
    status, body = 200, {}
    if path == '/api/v3/me':
        body = {'userId': 'synthetic', 'username': '页面验收示例', 'nickname': '演示用户'}
    elif path == '/api/v3/platform/instruments':
        body = {'items': []}
    elif path == '/api/v3/platform/attempts' or path == '/api/v3/attempts':
        body = {'items': [], 'page': 0, 'size': 20, 'total': 0}
    elif path == '/api/v3/catalog/current':
        body = {'packageId': 'typeme-jung48-zh-v3', 'questionCount': 64, 'basePerDimension': 12,
                'title': '十六型人格参考测评', 'dimensions': []}
    elif path == '/api/v3/ai/status':
        body = {'enabled': False, 'mock': True, 'model': 'mock', 'dailyLimitPerUser': 2,
                'remainingToday': 2, 'apiKeySource': 'none', 'promptVersion': 'typeme-ai-prompt-v3'}
    elif path == '/api/v3/auth/csrf':
        # 会话失效那条会走到登录页，登录页挂载时取一次 CSRF；形状照后端回应。
        body = {'token': 'csrf-token', 'headerName': 'X-XSRF-TOKEN', 'parameterName': '_csrf'}
    elif path.startswith('/api/v3/platform/attempts/') and path.endswith('/report'):
        status, body = 404, fixtures['attempt-not-found.json']
    elif path.startswith('/api/v3/platform/attempts/'):
        attempt_id = path.split('/')[-1]
        if attempt_id == JUNG_ID:
            # 本人十六型草稿：**分流信号**，不是错误
            status, body = 409, fixtures['jung-draft-platform-mismatch.json']
        elif attempt_id == BIG_FIVE_ID:
            status, body = 200, with_ids(fixtures['bigfive-attempt-detail.json'], attempt_id)
        elif attempt_id == EXPIRED_ID:
            status, body = 401, fixtures['attempt-unauthenticated.json']
        elif attempt_id == UNAVAILABLE_ID:
            status, body = 409, fixtures['bigfive-draft-jung-endpoint.json']
        else:
            status, body = 404, fixtures['attempt-not-found.json']
    elif path.startswith('/api/v3/attempts/'):
        attempt_id = path.split('/')[-1]
        if attempt_id == JUNG_ID:
            status, body = 200, with_ids(fixtures['jung-attempt-detail.json'], attempt_id)
        elif attempt_id == BIG_FIVE_ID:
            # 十六型端点读大五草稿：按绑定包拒绝（前端不该走到这里）
            status, body = 409, fixtures['bigfive-draft-jung-endpoint.json']
        else:
            status, body = 404, fixtures['attempt-not-found.json']
    elif path.startswith('/api/v3/admin/'):
        status, body = 403, {'code': 'FORBIDDEN', 'message': '非管理员示例', 'requestId': None, 'details': {}}
    elif path in ('/api/v1/meta', '/api/v2/assessment-packages/ipip50-zh1'):
        status, body = 503, {'code': 'NOT_CONFIGURED', 'message': '旧内容使用内置副本', 'requestId': None, 'details': {}}
    else:
        unexpected.append(path)
        status, body = 404, {'code': 'NOT_FOUND', 'message': '页面验收未定义此接口', 'requestId': None, 'details': {}}
    route.fulfill(status=status, content_type='application/json', body=json.dumps(body, ensure_ascii=False))


def no_overflow(page, label):
    result = page.evaluate('''() => ({width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth})''')
    check(result['scroll'] <= result['width'] + 1,
          f'{label}: 无横向溢出（scroll {result["scroll"]} <= {result["width"]} + 1）')


def open_attempt(page, attempt_id):
    page.goto('about:blank')
    page.goto(f'{BASE}/#/assess/{attempt_id}')


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        for width in (320, 390, 1440):
            context = browser.new_context(viewport={'width': width, 'height': 900}, device_scale_factor=1)
            context.route('**/api/**', api)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            try:
                run_scenarios(page, width)
            except Exception as error:
                # 失败也要留现场：这条路径正是用来复现"修复前"的样子的
                # （旧代码在这里会显示「这份测评不是大五倾向测评」而不是答题页）。
                dump = f'{type(error).__name__}: {error}\n\n=== 当时页面可见文案 ===\n{page.inner_text("body")}'
                (OUT / f'FAILED-{width}.txt').write_text(dump, encoding='utf-8')
                page.screenshot(path=str(OUT / f'FAILED-{width}.png'), full_page=True)
                context.close()
                browser.close()
                raise
            context.close()
        browser.close()

    check(not errors, '没有未捕获的前端异常: ' + str(errors))
    check(not unexpected, '所有 /api/** 都被显式处理: ' + str(unexpected))
    (OUT / 'browser-results.json').write_text(json.dumps({
        'scope': ('隔离构建 + 全量模拟接口；替身由 PlatformAttemptDispatchIT 从 H2 实跑导出，'
                  '不是手写通用草稿。无数据库、无后端进程、无真实 AI。'),
        'base': BASE,
        'widths': [320, 390, 1440],
        'scenarios': {
            JUNG_ID: '平台端点 409 INSTRUMENT_MISMATCH → 十六型答题页',
            BIG_FIVE_ID: '平台端点 200 instrumentKind=big_five → 大五答题页',
            MISSING_ID: '404 → 没有找到这份测评',
            EXPIRED_ID: '401 → 会话失效提示',
            UNAVAILABLE_ID: '409 PACKAGE_UNAVAILABLE → 版本不可用提示',
        },
        'checks': checks,
        'errors': errors,
        'unexpectedApis': unexpected,
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'{len(checks)} 项浏览器检查通过；证据：{OUT}')


def run_scenarios(page, width):
            # ── 十六型草稿：必须落到十六型答题页（本次要修的 bug）────────────────
            open_attempt(page, JUNG_ID)
            page.locator('[data-question-card]').wait_for(timeout=15000)
            check(page.locator('[data-attempt-route-error]').count() == 0,
                  f'{width}/十六型草稿: 不再显示「不是大五倾向测评」这类致命错误')
            check('不是大五' not in page.inner_text('body'),
                  f'{width}/十六型草稿: 整页文案里没有那句误导提示')
            check(page.locator('[data-bigfive-item]').count() == 0,
                  f'{width}/十六型草稿: 没有渲染成大五答题页')
            # 真实题干来自内容包（q 的题面），不是空壳
            first_item = page.locator('[data-question-card]').inner_text()
            check(len(first_item.strip()) > 20, f'{width}/十六型草稿: 答题页有实际内容')
            no_overflow(page, f'{width}/十六型草稿')
            page.screenshot(path=str(OUT / f'jung-draft-{width}.png'), full_page=True)

            # ── 大五草稿：必须落到大五答题页 ──────────────────────────────────
            open_attempt(page, BIG_FIVE_ID)
            page.locator('[data-bigfive-item]').wait_for(timeout=15000)
            check(page.locator('[data-question-card]').count() == 0,
                  f'{width}/大五草稿: 没有渲染成十六型答题页')
            check(page.locator('[data-attempt-route-error]').count() == 0,
                  f'{width}/大五草稿: 没有错误提示')
            no_overflow(page, f'{width}/大五草稿')
            page.screenshot(path=str(OUT / f'bigfive-draft-{width}.png'), full_page=True)

            # ── 不存在的 id：不能渲染答题页 ──────────────────────────────────
            open_attempt(page, MISSING_ID)
            page.locator('[data-attempt-route-not-found]').wait_for(timeout=15000)
            check(page.locator('[data-question-card]').count() == 0,
                  f'{width}/不存在的 id: 不渲染十六型答题页')
            check(page.locator('[data-bigfive-item]').count() == 0,
                  f'{width}/不存在的 id: 不渲染大五答题页')
            no_overflow(page, f'{width}/不存在的 id')
            page.screenshot(path=str(OUT / f'not-found-{width}.png'), full_page=True)

            # ── 会话失效：错误提示或退回登录页，但绝不是答题页 ────────────────
            # 401 会走全局 `onSessionExpired` 桥接：清成匿名，又因为本路由要求登录而跳登录页。
            # 两种表现都算合格；唯一不合格的是"被当成十六型草稿，渲染出答题页"。
            open_attempt(page, EXPIRED_ID)
            page.wait_for_function(
                "() => window.location.hash.includes('/login')"
                " || document.querySelector('[data-attempt-route-error]') !== null",
                timeout=15000)
            check(page.locator('[data-question-card]').count() == 0,
                  f'{width}/会话失效: 不渲染十六型答题页')
            check(page.locator('[data-bigfive-item]').count() == 0,
                  f'{width}/会话失效: 不渲染大五答题页')
            check('不是大五' not in page.inner_text('body'),
                  f'{width}/会话失效: 没有那句误导提示')
            no_overflow(page, f'{width}/会话失效')
            page.screenshot(path=str(OUT / f'session-expired-{width}.png'), full_page=True)

            # ── 版本不可用：错误提示，不是答题页 ──────────────────────────────
            open_attempt(page, UNAVAILABLE_ID)
            page.locator('[data-attempt-route-error]').wait_for(timeout=15000)
            check('不是大五' not in page.inner_text('body'),
                  f'{width}/版本不可用: 不被当成"这是十六型草稿"')
            check(page.locator('[data-question-card]').count() == 0,
                  f'{width}/版本不可用: 不渲染答题页')
            no_overflow(page, f'{width}/版本不可用')
            page.screenshot(path=str(OUT / f'package-unavailable-{width}.png'), full_page=True)

            # ── 同一页面换 id：从十六型切到大五，页面必须跟着换 ────────────────
            open_attempt(page, JUNG_ID)
            page.locator('[data-question-card]').wait_for(timeout=15000)
            page.evaluate(
                "id => { window.location.hash = '#/assess/' + id }", BIG_FIVE_ID)
            page.locator('[data-bigfive-item]').wait_for(timeout=15000)
            check(page.locator('[data-question-card]').count() == 0,
                  f'{width}/换 id: 切到大五草稿后不再残留十六型答题页')
            no_overflow(page, f'{width}/换 id')
            page.screenshot(path=str(OUT / f'switch-to-bigfive-{width}.png'), full_page=True)


if __name__ == '__main__':
    main()
