"""前端视觉与可用性验收：所有 API 为合成响应，不连接数据库或真实 AI。"""
import argparse
import importlib.util
import json
import os
import re
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--phase', choices=['before', 'after'], default='after')
parser.add_argument('--base', default='http://127.0.0.1:5201')
args = parser.parse_args()
OUT = ROOT / 'docs/optimization/verification/2026-10-10-visual-polish'
os.environ['TYPEME_BROWSER_EVIDENCE'] = str(OUT)
spec = importlib.util.spec_from_file_location('visual_fixtures', ROOT / 'scripts/browser-verify-readable.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
checks, errors = [], []


def check(ok, label):
    checks.append({'label': label, 'passed': bool(ok)})
    if not ok:
        raise AssertionError(label)


def api(route):
    url = urlparse(route.request.url)
    if url.netloc != urlparse(args.base).netloc:
        route.abort()
    elif not url.path.startswith('/api/'):
        route.continue_()
    elif url.path.startswith('/api/v3/admin/'):
        route.fulfill(status=403, content_type='application/json', body=json.dumps({'code': 'FORBIDDEN', 'message': '合成普通账号'}))
    else:
        fixture.api(route)


def layout(page, label):
    geometry = page.evaluate('''() => ({
        viewport: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth
    })''')
    check(geometry['scroll'] <= geometry['viewport'] + 1, label + ': no horizontal overflow')
    for link in page.locator('.site-header nav a').all():
        if not link.is_visible():
            continue
        box = link.bounding_box()
        check(box['width'] >= 40 and box['height'] >= 40, label + ': navigation touch target ' + link.inner_text())


def capture(page, name):
    page.screenshot(path=str(OUT / (args.phase + '-' + name + '.png')))


with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    try:
        for width in (320, 390, 1440):
            for name, path in [('home', '/'), ('catalog', '/instruments'), ('login', '/login'), ('report', '/reports/jung-v2')]:
                context = browser.new_context(viewport={'width': width, 'height': 900}, reduced_motion='reduce')
                context.route('**/*', api)
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                fixture.mode.update({'anonymous': name != 'report', 'ai': 'off'})
                page.goto(args.base + '/#' + path)
                page.locator('main h1').wait_for()
                page.wait_for_load_state('networkidle')
                label = f'{width}/{name}'
                capture(page, label.replace('/', '-'))
                if args.phase == 'after':
                    layout(page, label)
                if name == 'home':
                    choices = page.locator('.discovery-choices a')
                    expect(choices).to_have_count(2)
                    if args.phase == 'after':
                        check(all(choice.bounding_box()['y'] + choice.bounding_box()['height'] <= 900 for choice in choices.all()), label + ': both assessment shortcuts visible in first viewport')
                    page.get_by_role('button', name='选择测评', exact=False).first.click()
                    expect(page.locator('#available-assessments')).to_be_focused()
                    if args.phase == 'after':
                        check(page.locator('#available-assessments').bounding_box()['y'] >= page.locator('.site-header').bounding_box()['height'], label + ': section heading not hidden behind sticky header')
                    page.locator('[data-home-instruments]').screenshot(path=str(OUT / f'{args.phase}-cards-{width}.png'))
                    picker = page.locator('.portrait-picker button').filter(has_text='ENFP')
                    picker.click()
                    expect(picker).to_have_attribute('aria-pressed', 'true')
                    expect(page.locator('.portrait-spotlight')).to_contain_text('ENFP')
                    page.locator('.personality-gallery').screenshot(path=str(OUT / f'{args.phase}-gallery-{width}.png'))
                    if args.phase == 'after':
                        layout(page, label + '/gallery')
                elif name == 'catalog':
                    expect(page.locator('[data-instrument-cards] > li')).to_have_count(2)
                    if args.phase == 'after':
                        page.locator('[data-start="jung48"]').click()
                        expect(page).to_have_url(re.compile(r'/login.*jung48'))
                        check(True, label + ': start preserves selected instrument through login')
                elif name == 'login' and args.phase == 'after':
                    fields = page.locator('form input:not([type=hidden])')
                    fields.first.focus()
                    page.keyboard.press('Tab')
                    check(page.evaluate('document.activeElement.tagName') in ('INPUT', 'BUTTON'), label + ': form remains keyboard accessible')
                elif name == 'report' and args.phase == 'after':
                    expect(page.locator('[data-report-overview] h1')).to_contain_text('ENFP')
                    check(True, label + ': fixed report remains readable')
                context.close()
        if args.phase == 'after':
            context = browser.new_context(viewport={'width': 390, 'height': 900}, reduced_motion='reduce')
            context.route('**/*', api)
            page = context.new_page()
            fixture.mode['anonymous'] = True
            def unavailable(route):
                route.fulfill(status=503, content_type='application/json', body=json.dumps({'code': 'SERVICE_UNAVAILABLE', 'message': '合成目录暂时不可用'}))
            page.route('**/api/v3/platform/instruments', unavailable)
            page.goto(args.base + '/#/instruments')
            expect(page.locator('[data-instruments-error]')).to_be_visible()
            capture(page, 'catalog-error-390')
            page.unroute('**/api/v3/platform/instruments', unavailable)
            page.locator('[data-instruments-retry]').click()
            expect(page.locator('[data-instrument-cards] > li')).to_have_count(2)
            check(True, 'catalog: failure is visible and retry restores cards')
            page.goto(args.base + '/#/')
            page.evaluate("document.documentElement.style.zoom = '2'")
            layout(page, '390/home/200-percent-zoom')
            context.close()
        check(not errors, 'no uncaught browser errors')
        check(not fixture.unexpected, 'all APIs handled by synthetic fixtures')
    finally:
        browser.close()
        (OUT / f'{args.phase}-results.json').write_text(json.dumps({'checks': checks, 'errors': errors, 'unexpectedApis': fixture.unexpected, 'mode': 'synthetic APIs; external network blocked'}, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'{args.phase}: PASS {len(checks)} checks; screenshots saved at {OUT}')
