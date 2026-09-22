"""TypeMe 持续优化验收：账号页 / 对比页的**间距节奏**是否一致（A40）。

用法（项目根目录，Windows 侧 Python —— WSL 的 python3 没有 playwright）：

    set TYPEME_BROWSER_DIST=frontend/dist
    C:\\Python314\\python.exe scripts\\browser-verify-spacing.py

背景：A40 记的是「账号页与对比页的提示/按钮间距不统一」（账号页 mt-3 = 12px、对比页 mt-4 = 16px）。
本轮把对比页的操作组与其结果提示统一到账号页的节奏（mt-3），这个脚本把「统一」变成可复核的数字。

为什么用**打桩 API + 真实构建产物**，而不是真后端：
    本项只关心布局与 CSS 是否生效（Tailwind 有没有把这个类产出到产物里、窄屏会不会溢出），
    与后端行为无关；A34 那部分的后端行为由 `SubmitReportIT#skipChoiceIsNotPersistedWhenTheSubmitProducesNoReport`
    在真实 HTTP 链路上覆盖。真后端跑这一页需要注册账号 + 走两份完整测评，成本高而判别力不增。

判据：
    1. 320 / 390 / 1440 三个宽度下两页都没有横向溢出；
    2. 对比页「操作组」与「它的错误提示」的上外边距 = 12px；
    3. 账号页「提示 → 按钮」的上外边距 = 12px；
    4. 2 与 3 必须**相等**（这才是 A40 说的"节奏一致"）。

产出：<TYPEME_BROWSER_EVIDENCE>/*.png 与 result.json。
"""

from __future__ import annotations

import json
import os
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / os.environ.get(
    'TYPEME_BROWSER_EVIDENCE', 'docs/optimization/verification/2026-09-22-a34-a40')
RHYTHM_PX = 12.0  # Tailwind mt-3 = 0.75rem；A40 统一到这个节奏

checks: list[dict] = []
failures: list[str] = []
unexpected: list[str] = []
console_errors: list[str] = []
page_errors: list[str] = []


def check(ok: bool, label: str, detail: str = '') -> None:
    checks.append({'label': label, 'passed': bool(ok), 'detail': detail})
    if not ok:
        failures.append(f'{label}{(" —— " + detail) if detail else ""}')


def start_static_server():
    dist = os.environ.get('TYPEME_BROWSER_DIST')
    if not dist:
        return os.environ.get('TYPEME_BROWSER_BASE', 'http://127.0.0.1:5321'), None
    directory = (ROOT / dist).resolve()
    assert directory.is_dir(), f'前端构建目录不存在：{directory}'
    port = int(os.environ.get('TYPEME_BROWSER_PORT', '5321'))
    handler = partial(SimpleHTTPRequestHandler, directory=str(directory))
    server = ThreadingHTTPServer(('127.0.0.1', port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f'http://127.0.0.1:{port}', server.shutdown


BASE, stop_server = start_static_server()
OUT.mkdir(parents=True, exist_ok=True)

REPORT_A = 'aaaa1111-1111-1111-1111-111111111111'
REPORT_B = 'bbbb2222-2222-2222-2222-222222222222'


def summary(report_id: str, type_code: str) -> dict:
    return {
        'reportId': report_id,
        'attemptId': 'attempt-' + report_id[:4],
        'computedTypeCode': type_code,
        'status': 'REFERENCE',
        'createdAt': '2026-09-22T00:00:00Z',
        'packageId': 'typeme-jung48-zh-v4',
        'scoringVersion': 'typeme-jung48-score-v4',
        'reportContentVersion': 'typeme-type-report-zh-v1',
    }


def api(route):
    path = urlparse(route.request.url).path
    status, body = 200, {}
    if path == '/api/v3/me':
        body = {'userId': 'synthetic', 'username': '间距验收示例', 'nickname': '验收用户',
                'createdAt': '2026-09-22T00:00:00Z'}
    elif path == '/api/v3/reports':
        body = {'items': [summary(REPORT_A, 'ENFP'), summary(REPORT_B, 'ISTJ')],
                'page': 0, 'size': 100, 'total': 2}
    elif path == '/api/v3/reports/compare':
        # 故意让比较失败：这样"操作 → 它的错误提示"这一对会在同一屏里出现，可一次量完。
        status, body = 409, {'code': 'INCOMPARABLE', 'message': '这两份报告的规则版本不同，不能逐维对照。'}
    elif path == '/api/v3/ai/status':
        body = {'enabled': False, 'mock': True, 'model': 'mock', 'dailyLimitPerUser': 2,
                'remainingToday': 2, 'apiKeySource': 'none', 'promptVersion': 'typeme-ai-prompt-v4'}
    elif path == '/api/v3/admin/ai/settings' or path.startswith('/api/v3/admin/'):
        status, body = 403, {'code': 'FORBIDDEN', 'message': '非管理员示例'}
    elif path == '/api/v3/catalog/current':
        body = {'packageId': 'typeme-jung48-zh-v4', 'questionCount': 48, 'basePerDimension': 12,
                'title': '十六型人格参考测评', 'dimensions': []}
    elif path == '/api/v3/platform/instruments':
        body = {'items': []}
    elif path == '/api/v3/platform/illustrations':
        body = {'assets': [], 'release': None, 'version': 'synthetic'}
    elif path == '/api/v3/attempts':
        body = {'items': [], 'page': 0, 'size': 20, 'total': 0}
    elif path.startswith('/api/v3/reports/') and path.endswith('/analyses'):
        body = {'items': []}
    elif path.startswith('/api/v3/reports/'):
        status, body = 404, {'code': 'NOT_FOUND', 'message': '间距验收未定义此报告'}
    elif path in ('/api/v1/meta', '/api/v2/assessment-packages/ipip50-zh1'):
        status, body = 503, {'code': 'NOT_CONFIGURED', 'message': '旧内容使用内置副本'}
    else:
        unexpected.append(path)
        status, body = 404, {'code': 'NOT_FOUND', 'message': '间距验收未定义此接口'}
    route.fulfill(status=status, content_type='application/json', body=json.dumps(body, ensure_ascii=False))


def no_overflow(page, label: str) -> None:
    result = page.evaluate('''() => ({width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth})''')
    check(result['scroll'] <= result['width'] + 1,
          f'{label}: 无横向溢出（scroll {result["scroll"]} <= {result["width"]} + 1）',
          f'scroll={result["scroll"]} client={result["width"]}')


def margin_top(locator, label: str):
    """量元素的上外边距（px）。元素不存在时返回 None 并记一条失败。"""
    if locator.count() < 1:
        check(False, f'{label}: 元素存在')
        return None
    value = locator.first.evaluate("el => parseFloat(getComputedStyle(el).marginTop)")
    box = locator.first.bounding_box()
    check(box is not None and box['width'] > 0 and box['height'] > 0,
          f'{label}: 元素有可见尺寸',
          f'{box}' if box else '没有布局盒')
    return value


VIEWPORTS = {
    '320x568': {'width': 320, 'height': 568},
    '390x844': {'width': 390, 'height': 844},
    '1440x900': {'width': 1440, 'height': 900},
}


def main() -> int:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page()
        page.route('**/api/**', api)
        # 打桩接口故意返回 503/403（旧内容降级、非管理员），浏览器会在控制台记
        # "Failed to load resource" —— 那是**预期的**。真正要拦的是页面里的 JS 异常，
        # 所以只拿 pageerror 判失败，控制台 error 仍然记进 result.json 当证据。
        page.on('console', lambda message: console_errors.append(message.text)
                if message.type == 'error' else None)
        page.on('pageerror', lambda error: page_errors.append(str(error)))

        for name, viewport in VIEWPORTS.items():
            page.set_viewport_size(viewport)

            # ── 对比页：操作组 + 它的错误提示 ────────────────────────────────
            page.goto(f'{BASE}/#/reports/compare?a={REPORT_A}&b={REPORT_B}', wait_until='networkidle')
            page.wait_for_timeout(400)
            no_overflow(page, f'对比页 {name}')

            run_group_margin = margin_top(
                page.locator('[data-compare-run]').locator('xpath=..'),
                f'对比页 {name}: 操作组（[data-compare-run] 的容器）')
            error_margin = margin_top(page.locator('[data-compare-error]'),
                                      f'对比页 {name}: 比较失败的提示')
            check(run_group_margin == RHYTHM_PX,
                  f'对比页 {name}: 操作组上间距 = {RHYTHM_PX}px（与账号页同一节奏）',
                  f'实际 {run_group_margin}')
            check(error_margin == RHYTHM_PX,
                  f'对比页 {name}: 错误提示上间距 = {RHYTHM_PX}px',
                  f'实际 {error_margin}')
            page.screenshot(path=str(OUT / f'compare-{name}.png'), full_page=True)

            # ── 账号页：提示 → 按钮 ─────────────────────────────────────────
            page.goto(f'{BASE}/#/account', wait_until='networkidle')
            page.wait_for_timeout(400)
            no_overflow(page, f'账号页 {name}')

            save_button_margin = margin_top(page.get_by_role('button', name='保存昵称'),
                                            f'账号页 {name}: 「保存昵称」按钮')
            check(save_button_margin == RHYTHM_PX,
                  f'账号页 {name}: 提示→按钮上间距 = {RHYTHM_PX}px',
                  f'实际 {save_button_margin}')
            page.screenshot(path=str(OUT / f'account-{name}.png'), full_page=True)

            # ── A40 的核心断言：两页必须是同一个数字 ────────────────────────
            check(run_group_margin is not None and run_group_margin == save_button_margin,
                  f'{name}: 对比页操作组与账号页按钮的上间距**相等**（A40 的"节奏一致"）',
                  f'对比页 {run_group_margin} vs 账号页 {save_button_margin}')
            checks.append({'label': f'{name}: 量到的间距', 'passed': True,
                           'detail': {'compare_action_group': run_group_margin,
                                      'compare_error_notice': error_margin,
                                      'account_save_button': save_button_margin}})

        browser.close()

    if stop_server:
        stop_server()

    check(not unexpected, '没有未定义的接口调用（否则上面的断言可能只是"页面没渲染出来"）',
          ', '.join(sorted(set(unexpected))))
    check(not page_errors, '页面没有未捕获的 JS 异常', ' | '.join(page_errors[:3]))

    (OUT / 'result.json').write_text(json.dumps({
        'base': BASE,
        'rhythm_px': RHYTHM_PX,
        'checks': checks,
        'failures': failures,
        'unexpected_apis': sorted(set(unexpected)),
        'console_errors': console_errors,
        'page_errors': page_errors,
        'passed': len([c for c in checks if c['passed']]),
        'total': len(checks),
    }, ensure_ascii=False, indent=2), encoding='utf-8')

    print(f'间距验收：{len([c for c in checks if c["passed"]])}/{len(checks)} 通过')
    for failure in failures:
        print(f'  x {failure}')
    print(f'证据：{OUT}')
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
