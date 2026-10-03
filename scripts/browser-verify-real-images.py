#!/usr/bin/env python
"""真实图片域名验收：浏览器真的去 COS 官方域名取图（不是本地模拟）。

和 `browser-verify-image-cdn.py` 的分工：
前者用**本地模拟图片域名**注入 404 / 挂起，覆盖失败回退、慢网、缓存、快速切换这些分支；
本脚本用**真实的 COS 域名**回答另一个问题——"线上形状能不能用"：
证书、跨域 `<img>` 加载、真实响应头、浏览器缓存、以及布局与加载体验是否仍然成立。

2026-09-20 起页面加载哪个地址由**数据库**决定（`GET /api/v3/platform/illustrations`），
不再由构建期环境变量拼出来。所以本脚本：
  - 构建产物里**不允许**出现图片域名（出现即失败）；
  - 由接口 mock 返回 21 条真实 COS 地址，页面据此去取图；
  - 其余（CDP 记账、截图、布局与淡入断言）与之前一致。

它复用前者的静态服务器、API mock、页面内 trace 与 CDP 截图工具，
另外用 CDP 的 Network 事件独立记账（请求 / 状态码 / 传输字节 / 是否命中缓存），
不依赖服务器日志——这里的图片根本不经过本地服务器。

用法（仓库根目录）：

    cd frontend; npm.cmd run build; cd ..
    node scripts/check-bundled-image-urls.mjs
    python scripts/browser-verify-real-images.py

环境变量：

    TYPEME_IMAGE_BASE_URL     真实图片域名（默认 COS 官方域名）
    TYPEME_LABEL              证据子目录名（默认 real）
    TYPEME_BROWSER_EVIDENCE   证据根目录（默认 docs/optimization/verification/2026-09-20-image-cdn）
    TYPEME_DIST               隔离构建目录（默认 frontend/dist）
    TYPEME_SITE_PORT          站点端口（默认 5197）
    TYPEME_CSP                设置后就只跑"生产 CSP 复现"：让静态服务器带上与后端相同的
                              `Content-Security-Policy` 头，观察跨域图片会不会被浏览器拦掉。
                              后端实际发的是 `default-src 'self'`（见 REPORT §12）。
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]


def load_base():
    """复用本地模拟验收脚本里的服务器、trace 与截图工具（它只在 __main__ 下才跑流程）。"""
    path = ROOT / "scripts" / "browser-verify-image-cdn.py"
    spec = importlib.util.spec_from_file_location("image_cdn_verify", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


base = load_base()

IMAGE_BASE = os.environ.get(
    "TYPEME_IMAGE_BASE_URL", "https://yan-public-1407914221.cos.ap-beijing.myqcloud.com").rstrip("/")
IMAGE_HOST = IMAGE_BASE.split("//", 1)[1]
# 设置它就只跑"生产 CSP 复现"：模拟后端曾经发出的那条头。
# 后端那个空的 contentSecurityPolicy lambda 已经删掉了（修法 A，见 REPORT §12），
# 所以这个模式现在的用途是**回归**：如果谁又把空 lambda 加回去，这里能立刻看到跨域图片被拦。
CSP = os.environ.get("TYPEME_CSP", "").strip()
SITE_PORT = int(os.environ.get("TYPEME_SITE_PORT", "5197"))
SITE = f"http://127.0.0.1:{SITE_PORT}"
OUT = ROOT / os.environ.get(
    "TYPEME_BROWSER_EVIDENCE", "docs/optimization/verification/2026-09-20-image-cdn"
) / os.environ.get("TYPEME_LABEL", "real")

# 让 base 的 new_context 把录屏放到本轮证据目录（本轮不录屏，避免与 mock 证据混淆）
base.OUT = OUT
base.VIDEO = False

checks = base.checks
failures = base.failures
notes = base.notes
trace_dump: dict[str, object] = {}
unexpected: list[str] = base.unexpected
OBJECTS: dict[str, str] = base.OBJECTS
RELEASE: str = base.RELEASE

browser_ref: list = [None]


def check(ok: bool, label: str, detail: str = "") -> bool:
    return base.check(ok, label, detail)


class NetLog:
    """用 CDP 的 Network 事件独立记账：不依赖任何本地服务器日志。"""

    def __init__(self) -> None:
        self.urls: dict[str, str] = {}
        self.status: dict[str, int] = {}
        self.bytes: dict[str, int] = {}
        self.cached: set[str] = set()
        self.failed: dict[str, str] = {}
        self.started: dict[str, float] = {}
        self.finished: dict[str, float] = {}

    def attach(self, cdp) -> None:
        cdp.on("Network.requestWillBeSent", self._on_request)
        cdp.on("Network.responseReceived", self._on_response)
        cdp.on("Network.loadingFinished", self._on_finished)
        cdp.on("Network.requestServedFromCache", self._on_cached)
        cdp.on("Network.loadingFailed", self._on_failed)

    def _on_request(self, event) -> None:
        self.urls[event["requestId"]] = event["request"]["url"]
        self.started[event["requestId"]] = event.get("timestamp", 0.0)

    def _on_response(self, event) -> None:
        self.status[event["requestId"]] = event["response"]["status"]

    def _on_finished(self, event) -> None:
        self.bytes[event["requestId"]] = int(event.get("encodedDataLength") or 0)
        self.finished[event["requestId"]] = event.get("timestamp", 0.0)

    def _on_cached(self, event) -> None:
        self.cached.add(event["requestId"])

    def _on_failed(self, event) -> None:
        self.failed[event["requestId"]] = event.get("errorText") or "?"

    # ---- 分类查询
    def illustration_ids(self) -> list[str]:
        return [rid for rid, url in self.urls.items() if f"/illustrations/{RELEASE}/" in url]

    def illustration_urls(self) -> list[str]:
        return sorted({self.urls[rid] for rid in self.illustration_ids()})

    def local_fallback_ids(self) -> list[str]:
        return [rid for rid, url in self.urls.items()
                if url.startswith(SITE) and "/assets/" in url and ".webp" in url]

    def illustration_bytes(self) -> int:
        return sum(self.bytes.get(rid, 0) for rid in self.illustration_ids())

    def illustration_cache_hits(self) -> int:
        """CDP 的 requestServedFromCache 命中数。

        实测 Chromium 在**内存缓存**命中时不会发这个事件，所以它可能一直是 0；
        真正可靠的"没重新下载"证据是 encodedDataLength 全为 0（见 zero_byte_illustrations）。
        """
        return sum(1 for rid in self.illustration_ids() if rid in self.cached)

    def zero_byte_illustrations(self) -> int:
        """传输字节为 0 的图片响应数——这是"命中缓存、没有重新下载"的硬证据。"""
        return sum(1 for rid in self.illustration_ids() if self.bytes.get(rid, 0) == 0)

    def illustration_statuses(self) -> dict[str, int]:
        table: dict[str, int] = {}
        for rid in self.illustration_ids():
            table[rid] = self.status.get(rid, -1)
        return table

    def illustration_failures(self) -> list[str]:
        return [f"{self.urls.get(rid, rid)} → {text}" for rid, text in self.failed.items()
                if rid in self.illustration_ids()]

    def durations_ms(self) -> list[tuple[str, int]]:
        rows: list[tuple[str, int]] = []
        for rid in self.illustration_ids():
            if rid in self.started and rid in self.finished:
                rows.append((self.urls[rid].split("/")[-1], int((self.finished[rid] - self.started[rid]) * 1000)))
        return sorted(rows, key=lambda row: -row[1])


def probe_page(page) -> dict:
    return page.evaluate("""() => {
      const frames = [...document.querySelectorAll('.illustration-frame')];
      const withImg = frames.filter(f => f.querySelector('img'));
      const hosts = {};
      for (const f of withImg) {
        let host = '';
        try { host = new URL(f.querySelector('img').src).host; } catch (e) { host = ''; }
        hosts[host] = (hosts[host] || 0) + 1;
      }
      const states = {}; const sources = {};
      for (const f of frames) {
        const s = f.dataset.artworkState || '?'; states[s] = (states[s] || 0) + 1;
        const src = f.dataset.artworkSource || '?'; sources[src] = (sources[src] || 0) + 1;
      }
      const visible = sel => { const el = document.querySelector(sel);
        if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
      return { total: frames.length, withImg: withImg.length, hosts, states, sources,
        heroSrc: (document.querySelector('[data-artwork="home-hero"] img') || {}).src || null,
        attempts: [...new Set(frames.map(f => f.dataset.artworkAttempt))].sort(),
        preloads: document.querySelectorAll('link[rel="preload"][as="image"]').length,
        high: [...document.querySelectorAll('.illustration-frame img')].filter(i => i.getAttribute('fetchpriority') === 'high').length,
        lazy: [...document.querySelectorAll('.illustration-frame img')].filter(i => i.getAttribute('loading') === 'lazy').length,
        cta: visible('a.btn-ghost.btn-sm') || visible('a[href="#/login"]'),
        title: visible('h1') };
    }""")


def hero_heights(trace: dict) -> list[int]:
    return [change["box"][1] for change in base.region_changes(trace, "hero", "home-hero")]


def run_cold(width: int) -> None:
    print(f"\n[真实域名冷启动 {width}]")
    context = base.new_context(browser_ref[0], width)
    page = base.open_page(context, cold=True, budget=8000)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    net = NetLog()
    net.attach(page.dsh_cdp)
    started = time.time()

    page.goto(SITE, wait_until="domcontentloaded")
    ready = base.wait_ready(page, "home-hero", timeout=40000)
    page.locator(".personality-gallery").scroll_into_view_if_needed()
    page.wait_for_timeout(3000)
    probe = probe_page(page)
    trace = base.trace_of(page)
    trace_dump[f"cold-{width}"] = trace
    base.cdp_shot(page, OUT / f"real-cold-{width}-after.png")
    page.screenshot(path=str(OUT / f"real-{width}-full.png"), full_page=True)

    urls = net.illustration_urls()
    statuses = net.illustration_statuses()
    bad = {rid: code for rid, code in statuses.items() if code != 200}
    fallback = [net.urls[rid] for rid in net.local_fallback_ids()]
    heights = hero_heights(trace)
    changes = base.region_changes(trace, "hero", "home-hero")
    fades = base.fade_samples(changes)
    window = base.placeholder_window_ms(changes)
    durations = net.durations_ms()

    notes.append(
        f"cold/{width}：图片请求 {len(urls)} 条、{net.illustration_bytes()} 字节、"
        f"本地回退请求 {len(fallback)} 条、占位窗口 {window:.0f}ms、中间帧 {len(fades)} 个、"
        f"最慢 {durations[0] if durations else ('-', 0)}")

    check(ready, f"真实域名/{width}：首屏主图加载完成（data-artwork-state=ready）")
    check(len(urls) >= 5, f"真实域名/{width}：浏览器确实向真实域名取了图", f"{len(urls)} 条")
    check(all(url.startswith(f"{IMAGE_BASE}/illustrations/{RELEASE}/") for url in urls),
          f"真实域名/{width}：请求地址都是图片域名 + 发布清单对象键",
          str(urls[:2]))
    check(not bad, f"真实域名/{width}：全部图片响应 200（无 4xx/5xx）", json.dumps(bad))
    check(not net.illustration_failures(), f"真实域名/{width}：没有加载失败的图片请求",
          str(net.illustration_failures()[:3]))
    check(not fallback, f"真实域名/{width}：没有触发本地兜底（说明真实域名这条路是通的）", str(fallback[:3]))
    check(probe["total"] > 0 and probe["withImg"] == probe["total"],
          f"真实域名/{width}：所有插画位都渲染了 <img>（没有停在兜底 SVG）",
          f"frames={probe['total']} withImg={probe['withImg']}")
    check(set(probe["hosts"]) == {IMAGE_HOST},
          f"真实域名/{width}：所有插画都来自图片域名", json.dumps(probe["hosts"], ensure_ascii=False))
    check(probe["heroSrc"] == f"{IMAGE_BASE}/{OBJECTS['home-hero']}",
          f"真实域名/{width}：首屏主图指向发布清单里的对象键", str(probe["heroSrc"]))
    check(probe["attempts"] == ["primary"],
          f"真实域名/{width}：全程在主地址上，没有发生回退", str(probe["attempts"]))
    check(len(heights) >= 1 and max(heights) - min(heights) == 0,
          f"真实域名/{width}：主图容器高度全程不变（已预留尺寸）",
          f"{min(heights) if heights else '-'}~{max(heights) if heights else '-'}px")
    check(base.shift_total(trace) < 0.01,
          f"真实域名/{width}：布局位移可忽略（CLS）", str(base.shift_total(trace)))
    check(not base.image_shift_sources(trace),
          f"真实域名/{width}：位移不来自图片容器", str(base.image_shift_sources(trace)))
    check(len(fades) > 0, f"真实域名/{width}：图片解码后有淡入过程", f"中间帧 {len(fades)} 个")
    check(probe["preloads"] == 0 and probe["high"] == 1,
          f"真实域名/{width}：不预加载全部人物，只有主图高优先级",
          f"preload={probe['preloads']} high={probe['high']} lazy={probe['lazy']}")
    check(probe["lazy"] >= 10, f"真实域名/{width}：屏外图片仍是懒加载", f"lazy={probe['lazy']}")
    check(probe["cta"] is not None and probe["cta"][0] > 0 and probe["cta"][1] > 0,
          f"真实域名/{width}：等待图片期间主要按钮仍在版面上（没有被挤出）", str(probe["cta"]))
    check(not errors, f"真实域名/{width}：无未捕获 JS 错误", str(errors[:3]))

    # ---- 同上下文再加载一次：真实响应头下的浏览器缓存
    print(f"[真实域名缓存命中 {width}]")
    warm_page = base.open_page(context, cold=False, budget=8000)
    warm_net = NetLog()
    warm_net.attach(warm_page.dsh_cdp)
    warm_page.goto(SITE, wait_until="domcontentloaded")
    warm_ready = base.wait_ready(warm_page, "home-hero", timeout=40000)
    warm_page.locator(".personality-gallery").scroll_into_view_if_needed()
    warm_page.wait_for_timeout(2000)
    warm_probe = probe_page(warm_page)
    warm_trace = base.trace_of(warm_page)
    trace_dump[f"warm-{width}"] = warm_trace
    base.cdp_shot(warm_page, OUT / f"real-warm-{width}-after.png")

    warm_hits = warm_net.illustration_cache_hits()
    warm_total = len(warm_net.illustration_ids())
    warm_bytes = warm_net.illustration_bytes()
    warm_zero = warm_net.zero_byte_illustrations()
    warm_changes = base.region_changes(warm_trace, "hero", "home-hero")
    warm_window = base.placeholder_window_ms(warm_changes)
    warm_fades = base.fade_samples(warm_changes)
    notes.append(
        f"warm/{width}：图片请求 {warm_total} 条、编码字节 {warm_bytes} 字节、零字节响应 {warm_zero} 条、"
        f"CDP 缓存事件 {warm_hits} 条、占位窗口 {warm_window:.0f}ms、中间帧 {len(warm_fades)} 个")

    check(warm_ready, f"真实域名/{width}：二次加载主图就绪")
    check(warm_bytes == 0 and warm_zero == warm_total and warm_total > 0,
          f"真实域名/{width}：二次加载完全没有重新下载图片（max-age 生效）",
          f"编码字节 {warm_bytes}；零字节响应 {warm_zero}/{warm_total} 条（CDP 缓存事件 {warm_hits} 条，"
          f"Chromium 在内存缓存命中时不发该事件）")
    check(not warm_net.local_fallback_ids(), f"真实域名/{width}：二次加载也没有触发本地兜底")
    check(0 <= warm_window <= 400 and warm_window <= window,
          f"真实域名/{width}：缓存命中时占位窗口不超过冷启动，且落在淡入时长量级内",
          f"冷启动 {window:.0f}ms → 缓存命中 {warm_window:.0f}ms（淡入本身 200ms）")
    check(warm_probe["withImg"] == warm_probe["total"] and warm_probe["total"] > 0,
          f"真实域名/{width}：二次加载所有插画位仍然有图",
          f"frames={warm_probe['total']} withImg={warm_probe['withImg']}")
    context.close()


def make_csp_site_handler(root: Path, csp: str):
    """在静态服务器上复现"后端曾经发出的那条" `Content-Security-Policy` 头。

    历史：`SecurityConfig` 里那个空的 `contentSecurityPolicy(csp -> {})` 并不等于"不加这条头"——
    Spring Security 6.3.4 会因此创建默认 writer，实际发出 `default-src 'self'`；
    `default-src` 会兜住 `img-src`，于是所有跨域图片被浏览器拦掉。
    那条空 lambda 已按修法 A 删除（回归断言在 `IllustrationAssetIT#noContentSecurityPolicyHeader`），
    所以这里现在是**回归工具**：万一有人把它加回去，用这个模式能立刻看到拦截现象。
    """
    base_handler = base.make_site_handler(root)

    class Handler(base_handler):
        def end_headers(self):
            if csp:
                self.send_header("Content-Security-Policy", csp)
            super().end_headers()

    return Handler


def run_csp_repro(width: int) -> None:
    print(f"\n[生产 CSP 复现 {width}] 站点响应带 Content-Security-Policy: {CSP}")
    context = base.new_context(browser_ref[0], width)
    page = base.open_page(context, cold=True, budget=9000)
    violations: list[str] = []
    page.on("console", lambda message: violations.append(message.text or ""))
    net = NetLog()
    net.attach(page.dsh_cdp)
    blocked: list[tuple[str, str]] = []
    page.dsh_cdp.on("Network.loadingFailed", lambda event: blocked.append(
        (net.urls.get(event["requestId"], "?"), str(event.get("blockedReason") or event.get("errorText")))))

    page.goto(SITE, wait_until="domcontentloaded")
    page.wait_for_timeout(7000)
    probe = probe_page(page)
    base.cdp_shot(page, OUT / f"csp-{width}-after.png")

    csp_messages = [text for text in violations if "Content Security Policy" in text or "Refused to" in text]
    cos_urls = net.illustration_urls()
    fallback = [net.urls[rid] for rid in net.local_fallback_ids()]
    displayed_hosts = probe["hosts"]
    site_host = SITE.split("//", 1)[1]

    print(f"  COS 请求被发出：{len(cos_urls)} 条；其中加载失败：{len(net.illustration_failures())} 条")
    print(f"  被拦原因样本：{blocked[:2]}")
    print(f"  CSP 报错样本：{(csp_messages[0][:160] if csp_messages else '（无）')}")
    print(f"  页面实际显示的图片来源：{json.dumps(displayed_hosts, ensure_ascii=False)}")
    print(f"  回退到本地资源：{len(fallback)} 条；插画位 frames={probe['total']} withImg={probe['withImg']}")

    notes.append(
        f"CSP/{width}：COS 请求 {len(cos_urls)} 条、失败 {len(net.illustration_failures())} 条、"
        f"CSP 报错 {len(csp_messages)} 条、本地回退 {len(fallback)} 条、"
        f"实际显示来源 {json.dumps(displayed_hosts, ensure_ascii=False)}、"
        f"frames={probe['total']} withImg={probe['withImg']}")

    check(bool(csp_messages) or bool(net.illustration_failures()),
          f"CSP/{width}：复现成功——跨域图片确实被 CSP 拦下",
          f"CSP 报错 {len(csp_messages)} 条、加载失败 {len(net.illustration_failures())} 条")
    check(bool(displayed_hosts) and set(displayed_hosts) == {site_host},
          f"CSP/{width}：最终显示的图片全部来自源站（迁移在生产环境不生效）",
          json.dumps(displayed_hosts, ensure_ascii=False))
    check(probe["total"] > 0 and probe["withImg"] == probe["total"],
          f"CSP/{width}：页面仍然显示图片（回退兜住了，所以肉眼很难发现）",
          f"frames={probe['total']} withImg={probe['withImg']}，本地回退 {len(fallback)} 条")
    context.close()


def main() -> int:
    if not base.DIST.exists():
        print("缺少 frontend/dist，请先执行：cd frontend && npm.cmd run build")
        return 2
    if not OBJECTS:
        print("upload-manifest.json 里没有对象键，先运行 node scripts/gen-image-publish.mjs")
        return 2
    bundle = sorted((base.DIST / "assets").glob("index-*.js"))
    if not bundle:
        print("frontend/dist/assets 里没有 index-*.js，构建产物不完整")
        return 2
    # 地址改成数据库驱动之后，产物里**不该**再有图片域名：它应当只出现在接口 mock 的响应里。
    # 产物里出现域名说明有人把地址写回了源码（换域名/换图就得重新发版），这里直接拦下。
    if IMAGE_BASE.encode() in bundle[0].read_bytes():
        print(f"构建产物里出现了图片域名 {IMAGE_BASE}：地址应当只来自运行期读到的库表")
        print("请从源码里去掉写死的域名，然后重新构建：cd frontend; npm.cmd run build")
        return 2

    # 页面会去读接口 mock 给的地址表；把它指向真实的 COS 域名（本轮要验的就是真实对象）。
    base.IMAGE_BASE = IMAGE_BASE
    base.MODE = "remote"

    OUT.mkdir(parents=True, exist_ok=True)

    if CSP:
        # 只跑"生产 CSP 复现"。地址表仍由接口 mock 给出**真实 COS 域名**：CSP 一旦生效，
        # 请求在发出前就被拦掉，不会有真实流量，所以不需要为了省钱换成假域名——
        # 用真域名反而让证据更直接（blockedReason 就是 csp）。
        print(f"隔离构建：{base.DIST}")
        print(f"站点：{SITE}（额外发送 Content-Security-Policy: {CSP}）")
        print(f"证据目录：{OUT}")
        with base.Server(SITE_PORT, make_csp_site_handler(base.DIST, CSP)):
            with sync_playwright() as pw:
                browser = pw.chromium.launch(headless=True)
                browser_ref[0] = browser
                try:
                    run_csp_repro(390)
                finally:
                    browser.close()
        passed = sum(1 for entry in checks if entry["passed"])
        summary = {
            "label": "csp", "mode": "csp-repro", "site": SITE, "imageBase": IMAGE_BASE, "csp": CSP,
            "scope": "reproduce the backend Content-Security-Policy header against cross-origin images",
            "passed": passed, "failed": len(failures), "failures": failures, "notes": notes, "checks": checks,
        }
        (OUT / "summary-csp.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nPASS {passed} / FAIL {len(failures)}；证据：{OUT}")
        for item in failures:
            print(f"  · {item}")
        return 1 if failures else 0

    print(f"隔离构建：{base.DIST}")
    print(f"站点：{SITE}（只提供页面/JS/CSS 与 API mock）")
    print(f"图片：{IMAGE_BASE}（真实 COS 官方域名，浏览器直接取图）")
    print(f"证据目录：{OUT}")

    with base.Server(SITE_PORT, base.make_site_handler(base.DIST)):
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            browser_ref[0] = browser
            try:
                for width in (320, 390, 1440):
                    run_cold(width)
            finally:
                browser.close()

    check(not unexpected, "全部 API 均被模拟", str(sorted(set(unexpected))))
    passed = sum(1 for entry in checks if entry["passed"])
    summary = {
        "label": os.environ.get("TYPEME_LABEL", "real"), "mode": "real", "site": SITE, "imageBase": IMAGE_BASE,
        "scope": "isolated build + real COS official domain + mocked API; browser fetches images from COS over HTTPS",
        "passed": passed, "failed": len(failures), "failures": failures, "notes": notes, "checks": checks,
    }
    label = summary["label"]
    (OUT / f"summary-{label}.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / f"traces-{label}.json").write_text(json.dumps(trace_dump, ensure_ascii=False), encoding="utf-8")
    print(f"\nPASS {passed} / FAIL {len(failures)}；证据：{OUT}")
    for item in failures:
        print(f"  · {item}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
