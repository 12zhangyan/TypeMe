"""Picture-book UI and portrait selection, with every API request mocked."""
import importlib.util
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault('TYPEME_BROWSER_EVIDENCE', 'docs/optimization/verification/2026-09-18-generated-images')
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/browser-verify-readable.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
OUT = fixture.OUT
checks, errors, image_errors = [], [], []

def check(ok, label):
    checks.append({'label':label, 'passed':bool(ok)})
    assert ok, label

def capture(page, name, width, selector=None):
    page.locator('.illustration-frame img').evaluate_all("async items => { await Promise.all(items.map(async img => { img.loading = 'eager'; await img.decode(); })); }")
    # 插画帧改为"解码完成后淡入 200ms"（2026-09-18 图片加载体验修复）：截图前要等淡入结束，
    # 否则会拍到半透明的中间帧，把过渡误记成"图片没显示"。
    page.wait_for_function("() => [...document.querySelectorAll('.illustration-frame img')].every(img => Number(getComputedStyle(img).opacity) >= 0.99)")
    check(page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'), f'{width}/{name}: no overflow')
    page.evaluate('document.activeElement?.blur()')
    if selector:
        page.locator(selector).screenshot(path=str(OUT/f'{name}-{width}.png'))
    else:
        page.screenshot(path=str(OUT/f'{name}-{width}.png'), full_page=True)

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    for width in (320,390,1440):
        context = browser.new_context(viewport={'width':width,'height':1000})
        context.route('**/api/**',fixture.api)
        context.route('**/api/v3/auth/csrf',lambda request:request.fulfill(status=200,content_type='application/json',body='{"token":"synthetic-browser-only","headerName":"X-XSRF-TOKEN","parameterName":"_csrf"}'))
        page = context.new_page()
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('response',lambda response:image_errors.append(response.url) if response.request.resource_type=='image' and response.status >= 400 else None)
        page.goto(fixture.BASE)
        page.locator('[data-home-instruments]').wait_for()
        check(page.locator('[data-artwork="home-hero"][data-artwork-source="image"]').count()==1,f'{width}: delivered hero loaded')
        check(page.locator('.portrait-picker button').count()==16,f'{width}: all 16 portrait options')
        capture(page,'home',width)
        capture(page,'hero',width,'.discovery-hero')
        capture(page,'gallery',width,'[data-personality-gallery]')
        for code in ('INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP','ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP'):
            button = page.locator(f'.portrait-picker button[aria-label^="{code}，"]')
            button.focus()
            page.keyboard.press('Enter')
            check(button.get_attribute('aria-pressed')=='true',f'{width}/{code}: keyboard selection')
            check(page.locator(f'.portrait-spotlight [data-artwork="type-{code.lower()}"]').count()==1,f'{width}/{code}: illustration matches selection')
            portrait=page.locator('.portrait-spotlight img')
            portrait.evaluate('async img => { await img.decode(); }')
            check(portrait.evaluate('img => img.complete && img.naturalWidth > 0 && getComputedStyle(img).objectFit === "contain"'),f'{width}/{code}: real portrait decoded without cropping')
            box=button.bounding_box()
            check(box['width']>=44 and box['height']>=44,f'{width}/{code}: target size')
        check('不是测评结果' in page.locator('.portrait-spotlight').inner_text(),f'{width}: gallery not a personal result')
        page.get_by_role('button',name='找到适合我的测评').click()
        check(page.locator('#available-assessments').evaluate('(e)=>document.activeElement===e'),f'{width}: CTA transfers focus')
        if width==1440:
            # Read both positions in one frame while the CTA's smooth scroll runs.
            tops=page.locator('[data-home-instruments] > li').evaluate_all('(items)=>items.map(item=>item.getBoundingClientRect().top)')
            check(len(tops)==2 and abs(tops[0]-tops[1])<2,f'{width}: two cover cards side by side')
        for report_id in ('jung-v2','jung-tied','jung-v1'):
            page.goto(fixture.BASE+'/#/reports/'+report_id)
            page.locator('[data-report-overview]').wait_for()
            if report_id=='jung-tied':
                check(page.locator('[data-report-character]').count()==0,f'{width}: tied report never receives arbitrary portrait')
            else:
                code=fixture.reports[report_id]['computedTypeCode']
                check(page.locator(f'[data-report-character] [data-artwork="type-{code.lower()}"]').count()==1,f'{width}/{report_id}: portrait uses stored result')
                check('不是额外测量' in page.locator('[data-report-character]').inner_text(),f'{width}/{report_id}: decorative role explained')
            capture(page,report_id,width,'[data-report-overview]')
        context.route('**/api/v3/me',lambda request:request.fulfill(status=401,content_type='application/json',body='{"code":"UNAUTHENTICATED"}'))
        page.goto('about:blank')
        for route in ('login','register','recover','instruments'):
            page.goto(fixture.BASE+'/#/'+route)
            page.locator('.illustration-frame img').first.wait_for(state='attached')
            capture(page,route,width)
            check(page.locator('[data-artwork-source="vector"]').count()==0,f'{width}/{route}: all delivered images used')
        context.close()
    browser.close()
check(not errors,'No uncaught JavaScript errors')
check(not image_errors,'No missing-image requests')
check(not fixture.unexpected,'All API requests mocked: '+str(fixture.unexpected))
(OUT/'atelier-checks.json').write_text(json.dumps({'checks':checks,'errors':errors,'image_errors':image_errors},ensure_ascii=False,indent=2),encoding='utf-8')
print(f'{len(checks)} atelier checks passed; no live backend, database or AI.')
