"""注册页触屏点按验收（移植 PR #21，2026-10-20）：WebKit 与 Chromium，320 / 390 / 1440。

未填完时点「创建账号」应聚焦挡住提交的那一格；勾选框能点中且不被粘性顶栏盖住；填完后点按钮发出一次注册请求。
静态构建 + 全部 API 拦截（注册返回合成 400），无数据库。先 `npm run build`，再在 5178 启动静态服务器；
WebKit 需 `python -m playwright install webkit`。证据写入 docs/optimization/verification/2026-10-20-register-tap/。
"""
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
OUT = Path(__file__).resolve().parents[1] / 'docs/optimization/verification/2026-10-20-register-tap'
OUT.mkdir(parents=True, exist_ok=True)
BASE='http://127.0.0.1:5178'; res=[]
def ok(c,l): res.append((bool(c),l)); print(('PASS ' if c else 'FAIL ')+l)
with sync_playwright() as pw:
    for name in ('webkit','chromium'):
        b=getattr(pw,name).launch()
        for w in (320,390,1440):
            posts=[]
            def api(route):
                p=urlparse(route.request.url).path
                if not p.startswith('/api/'): return route.continue_()
                if p=='/api/v3/me': return route.fulfill(status=401,content_type='application/json',body='{"code":"UNAUTHENTICATED","message":"x"}')
                if p=='/api/v3/auth/csrf': return route.fulfill(status=200,content_type='application/json',body='{"token":"t","headerName":"X-XSRF-TOKEN","parameterName":"_csrf"}')
                if p=='/api/v3/auth/register':
                    posts.append(route.request.post_data_json)
                    return route.fulfill(status=400,content_type='application/json',body=json.dumps({'code':'VALIDATION_FAILED','message':'合成：邀请码无效','requestId':'req-x','details':{}},ensure_ascii=False))
                route.fulfill(status=404,content_type='application/json',body='{"code":"NOT_FOUND","message":"x"}')
            c=b.new_context(viewport={'width':w,'height':800},has_touch=(w<768),is_mobile=(w<768 and name=='chromium'))
            c.route('**/*',api); pg=c.new_page(); tag=f'{name}/{w}'
            pg.goto(BASE+'/#/register'); pg.locator("input[name='username']").wait_for()
            def tap(loc):
                loc.scroll_into_view_if_needed()
                pg.wait_for_function("() => new Promise(r => { let l=-1,n=0; const t=()=>{ n = scrollY===l ? n+1 : 0; l=scrollY; n>=3 ? r(true) : requestAnimationFrame(t) }; t() })")
                bb=loc.bounding_box()
                x,y=bb['x']+bb['width']/2, bb['y']+bb['height']/2
                hit=pg.evaluate("([x,y])=>{const e=document.elementFromPoint(x,y);return e?(e.outerHTML.slice(0,80)):null}",[x,y])
                (pg.touchscreen.tap(x,y) if w<768 else pg.mouse.click(x,y)); return hit
            hit=tap(pg.locator("button[type='submit']"))
            ok(pg.evaluate("document.activeElement?.name")=='username', f'{tag}: blank form tap focuses first blocking field (hit {hit and hit[:40]})')
            pg.fill("input[name='invitationCode']",'S'*32); pg.fill("input[name='username']",'probe_user'); pg.fill("input[name='nickname']",'探针')
            pg.fill("input[name='new-password']",'Synthetic-pass-123'); pg.fill("input[name='confirm-password']",'Synthetic-pass-123')
            tap(pg.locator('.auth-disclaimer-check'))
            ok(pg.locator('.auth-disclaimer-check').is_checked(), f'{tag}: tapping disclaimer checkbox checks it')
            hit=tap(pg.locator("button[type='submit']")); pg.wait_for_timeout(500)
            ok(len(posts)==1, f'{tag}: tapping 创建账号 sends register once (hit {hit and hit[:40]})')
            ok(pg.evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth+1"), f'{tag}: no horizontal overflow')
            pg.screenshot(path=str(OUT / f'register-{name}-{w}.png'),full_page=True)
            c.close()
        b.close()
f=[l for c,l in res if not c]; print(len(res)-len(f),'passed',len(f),'failed')
(OUT / 'browser-checks.json').write_text(json.dumps([{'label':l,'passed':c} for c,l in res],ensure_ascii=False,indent=2),encoding='utf-8')
raise SystemExit(1 if f else 0)
