#!/usr/bin/env python
"""图片加载体验验收：占位、淡入、切换竞态、失败兜底与懒加载边界。

隔离构建（`frontend/dist`）+ 内置静态服务器 + 全模拟 API：不连数据库、不调用 AI、不访问外网。
服务器可对指定图片注入延迟或 404，用来复现"冷缓存 + 慢网"、"图片失败"和"旧图晚到"。

用法（仓库根目录）：

    cd frontend; npm.cmd run build; cd ..
    python scripts/browser-verify-image-loading.py                 # 修复后
    TYPEME_LABEL=before python scripts/browser-verify-image-loading.py   # 修复前基线

环境变量：
    TYPEME_LABEL              证据子目录标签（默认 after）
    TYPEME_BROWSER_EVIDENCE   证据根目录（默认 docs/optimization/verification/2026-09-18-image-loading）
    TYPEME_PORT               内置静态服务器端口（默认 5198）
    TYPEME_VIDEO              1 时录制 390 宽的冷缓存与快速切换短视频（默认开）

场景：冷缓存慢网（320/390/1440）、缓存命中、图片失败、快速连续切换、减少动画偏好、报告配图。
所有判据都读页面真实状态（data-artwork-state / 计算透明度 / 布局盒子 / API 与图片请求日志）。
"""
from __future__ import annotations

import functools
import http.server
import json
import os
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
DIST = Path(os.environ.get("TYPEME_DIST", str(ROOT / "frontend" / "dist")))
FIXTURES = ROOT / "backend" / "target" / "readable-browser-fixtures"
LABEL = os.environ.get("TYPEME_LABEL", "after")
OUT = ROOT / os.environ.get(
    "TYPEME_BROWSER_EVIDENCE", "docs/optimization/verification/2026-09-18-image-loading"
) / LABEL
PORT = int(os.environ.get("TYPEME_PORT", "5198"))
BASE = f"http://127.0.0.1:{PORT}"
VIDEO = os.environ.get("TYPEME_VIDEO", "1") != "0"

VIEWPORTS = {"320": {"width": 320, "height": 720}, "390": {"width": 390, "height": 844}, "1440": {"width": 1440, "height": 900}}
# 首屏主图与默认选中人物的图都放慢，才能观察到"占位 → 淡入"全过程
SLOW_HERO = 1.8

checks: list[dict] = []
failures: list[str] = []
notes: list[str] = []
trace_dump: dict[str, object] = {}
requests_log: list[tuple[str, float]] = []
requests_lock = threading.Lock()


def check(ok: bool, label: str, detail: str = "") -> bool:
    entry = {"label": label, "passed": bool(ok), "detail": detail}
    checks.append(entry)
    if ok:
        print(f"  PASS {label}" + (f" —— {detail}" if detail else ""))
    else:
        failures.append(label + (f" —— {detail}" if detail else ""))
        print(f"  FAIL {label}" + (f" —— {detail}" if detail else ""))
    return bool(ok)


# ---------------------------------------------------------------- 静态服务器

def make_handler(root: Path, delays: dict[str, float], blocks: set[str]):
    class Handler(http.server.SimpleHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

        def log_message(self, *args):  # 静音
            pass

        def end_headers(self):
            path = urlparse(self.path).path
            self.send_header(
                "Cache-Control",
                "public, max-age=31536000, immutable" if path.startswith("/assets/") else "no-cache",
            )
            super().end_headers()

        def do_GET(self):  # noqa: N802
            path = urlparse(self.path).path
            if path.startswith("/api/"):
                self.respond_api(path)
                return
            name = os.path.basename(path)
            if name:
                with requests_lock:
                    requests_log.append((name, time.time()))
            for key in blocks:
                if key in name:
                    self.send_error(404, "blocked for image-loading verification")
                    return
            for key, delay in delays.items():
                if key in name:
                    time.sleep(delay)
                    break
            super().do_GET()

        def do_POST(self):  # noqa: N802
            path = urlparse(self.path).path
            length = int(self.headers.get("Content-Length") or 0)
            if length:
                self.rfile.read(length)
            if path.startswith("/api/"):
                self.respond_api(path)
                return
            self.send_error(405)

        def respond_api(self, path: str) -> None:
            """模拟 API 直接由同源静态服务器回答：不装 Playwright 路由，
            浏览器的 HTTP 缓存才按真实规则工作（否则"缓存命中"根本测不出来）。"""
            status, body = api_payload(path)
            payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    return Handler


class StaticServer:
    def __init__(self, port: int):
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), make_handler(DIST, DELAYS, BLOCKS))
        self.httpd.daemon_threads = True
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.httpd.shutdown()
        self.httpd.server_close()


DELAYS: dict[str, float] = {}
BLOCKS: set[str] = set()


def set_rules(*, delays: dict[str, float] | None = None, blocks: set[str] | None = None) -> None:
    """就地改规则：服务器持有的就是这两个对象，重新赋值会让规则失效。"""
    DELAYS.clear()
    DELAYS.update(delays or {})
    BLOCKS.clear()
    BLOCKS.update(blocks or set())


def image_requests() -> list[tuple[str, float]]:
    with requests_lock:
        return list(requests_log)


# ---------------------------------------------------------------- 页面内追踪脚本

TRACE = r"""
window.__startTrace = () => {
  const t = window.__trace = { start: performance.now(), budget: window.__TRACE_BUDGET__ || 6000,
    marks: [], shifts: [], changes: [], boxes: [], imageErrors: [] };
  const describe = node => {
    if (!node) return '?';
    const cls = typeof node.className === 'string' ? node.className
      : (node.getAttribute && node.getAttribute('class')) || '';
    return ((node.tagName || '?') + ' ' + cls).trim().slice(0, 72);
  };
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) if (!e.hadRecentInput)
        t.shifts.push({ t: Math.round(e.startTime), v: +e.value.toFixed(5),
          sources: (e.sources || []).map(s => describe(s.node)).slice(0, 4) });
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (error) { t.shiftUnsupported = String(error); }
  window.addEventListener('error', e => {
    const el = e.target;
    if (el && el.tagName === 'IMG') t.imageErrors.push({ t: Math.round(performance.now() - t.start), file: short(el) });
  }, true);
  const short = el => ((el.currentSrc || el.getAttribute('src') || '').split('/').pop() || '');
  const region = f => {
    if (f.closest('.portrait-spotlight')) return 'spotlight';
    if (f.closest('.portrait-picker')) return 'picker';
    if (f.closest('.discovery-illustration')) return 'hero';
    if (f.closest('.assessment-card')) return 'card';
    if (f.closest('.atelier-reflection')) return 'reflection';
    if (f.closest('.auth-page') || f.closest('.auth-art')) return 'auth';
    if (f.closest('[data-report-character]') || f.closest('.report-character-study')) return 'report';
    return 'other';
  };
  const snapshot = f => {
    const img = f.querySelector('img');
    const svg = f.querySelector('svg');
    const style = img ? getComputedStyle(img) : null;
    const box = f.getBoundingClientRect();
    const artwork = f.dataset.artwork || '?';
    return { key: region(f) + '/' + artwork, artwork, region: region(f),
      source: f.dataset.artworkSource || null, state: f.dataset.artworkState || null,
      slot: svg ? (svg.getAttribute('class') || 'svg') : null,
      box: [Math.round(box.width), Math.round(box.height)],
      file: img ? short(img) : null, naturalWidth: img ? img.naturalWidth : -1,
      complete: img ? img.complete : null,
      opacity: style ? Math.round(Number(style.opacity) * 100) / 100 : null,
      transition: style ? style.transitionProperty + ' ' + style.transitionDuration : null };
  };
  const boxSelectors = ['.atelier-cover-art', '.assessment-card-art', '.portrait-spotlight-art',
    '.portrait-picker button', '[data-report-character]', '.report-character-study > .personality-portrait'];
  const last = new Map();
  let frame = 0;
  const step = () => {
    const now = performance.now() - t.start;
    if (now > t.budget) return;
    frame += 1;
    const stamp = Math.round(now);
    for (const f of document.querySelectorAll('.illustration-frame')) {
      const s = snapshot(f);
      const prev = last.get(s.key);
      if (!prev || prev.state !== s.state || prev.source !== s.source || prev.opacity !== s.opacity
          || prev.naturalWidth !== s.naturalWidth || prev.file !== s.file || prev.box[1] !== s.box[1]
          || prev.slot !== s.slot) {
        last.set(s.key, s);
        t.changes.push({ t: stamp, ...s });
      }
    }
    if (frame % 3 === 0) {
      for (const sel of boxSelectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        t.boxes.push({ t: stamp, sel, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top + window.scrollY) });
      }
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};
window.__startTrace();
"""


# ---------------------------------------------------------------- 模拟 API

catalog = []
for slug, kind, title, count, dimensions in [
    ("jung48", "jung", "十六型人格参考测评", 48, ["EI", "SN", "TF", "JP"]),
    ("bigfive50", "big_five", "大五人格倾向测评", 50, ["E", "A", "C", "ES", "O"]),
]:
    jung = kind == "jung"
    catalog.append({"slug": slug, "kind": kind, "title": title, "tagline": "合成目录示例",
        "summary": "了解四个方面的偏好，保留不确定的部分。" if jung else "五个方面各自解释，没有类型和总分。",
        "whatYouLearn": ["这次回答的倾向与不确定之处"], "notFor": ["判断能力和诊断"],
        "format": "bipolar" if jung else "agreement", "hasTypeCode": jung, "supportsClarification": jung,
        "dimensions": dimensions, "defaultPackageId": "synthetic-package", "baseItemCount": count,
        "clarificationItemCount": 16 if jung else 0, "maxClarificationItems": 16 if jung else 0,
        "estimatedMinutes": 10, "contentStatus": "draft_review_pending"})

reports = {path.stem: json.loads(path.read_text(encoding="utf-8")) for path in FIXTURES.glob("*.json")} if FIXTURES.exists() else {}
portraits = {item["code"]: item for item in json.loads((ROOT / "frontend/src/design/personalityPortraits.json").read_text(encoding="utf-8"))}
unexpected: list[str] = []


def ai_result(report_id: str) -> dict:
    return {"schemaVersion": "analysis-readable-v2", "referenceType": reports[report_id].get("computedTypeCode"),
        "summary": "这次回答反映的是当下的选择习惯。", "observations": [],
        "suggestedAction": None, "limitations": ["合成数据，未调用真实模型。"]}


def api_payload(path: str) -> tuple[int, dict]:
    """同源模拟 API：与 app 的真实调用面一一对应，未覆盖的路径会记进 unexpected。"""
    status, body = 200, {}
    if path == "/api/v3/me":
        body = {"userId": "synthetic", "username": "页面验收示例", "nickname": "演示用户"}
    elif path == "/api/v3/platform/instruments":
        body = {"items": catalog}
    elif path in ("/api/v3/attempts", "/api/v3/platform/attempts", "/api/v3/platform/reports"):
        body = {"items": [], "page": 0, "size": 20, "total": 0}
    elif path == "/api/v3/catalog/current":
        body = {"packageId": "typeme-jung48-zh-v2", "questionCount": 48, "basePerDimension": 12,
                "title": "十六型人格参考测评", "dimensions": []}
    elif path == "/api/v3/ai/status":
        body = {"enabled": True, "mock": True, "model": "mock", "dailyLimitPerUser": 2, "remainingToday": 2,
                "apiKeySource": "none", "promptVersion": "typeme-ai-prompt-v3"}
    elif path.endswith("/analyses"):
        body = {"items": []}
    elif path.startswith("/api/v3/reports/"):
        report_id = path.split("/")[-1]
        body = {"report": reports[report_id], "selfReflection": {}, "attemptId": "synthetic-attempt", "attemptRevision": 1}
    elif path.startswith("/api/v3/platform/reports/") or path.startswith("/api/v3/platform/attempts/"):
        status, body = 404, {"code": "NOT_FOUND", "message": "合成验收未定义此记录"}
    elif path.startswith("/api/v3/auth/csrf"):
        body = {"token": "synthetic-browser-only", "headerName": "X-XSRF-TOKEN", "parameterName": "_csrf"}
    elif path in ("/api/v1/meta", "/api/v2/assessment-packages/ipip50-zh1"):
        # App 的旧引擎初始化用仓库内置副本；明确模拟旧内容服务离线，不算未覆盖接口。
        status, body = 503, {"code": "NOT_CONFIGURED", "message": "旧内容使用内置副本"}
    else:
        unexpected.append(path)
        status, body = 404, {"code": "NOT_FOUND", "message": "验收未定义此接口"}
    return status, body


# ---------------------------------------------------------------- 追踪数据工具

def trace_of(page) -> dict:
    return page.evaluate("window.__trace")


def reset_trace(page) -> None:
    """同文档内换路由时重开一段追踪窗口（不刷新页面，才能测到内存/HTTP 缓存命中）。"""
    page.evaluate("window.__startTrace()")


def mark(page, label: str) -> None:
    page.evaluate("label => window.__trace.marks.push({t: Math.round(performance.now() - window.__trace.start), label})", label)


def region_changes(trace: dict, region: str, artwork: str | None = None) -> list[dict]:
    return [c for c in trace["changes"] if c["region"] == region and (artwork is None or c["artwork"] == artwork)]


def fade_samples(changes: list[dict]) -> list[dict]:
    return [c for c in changes if c["opacity"] is not None and 0.05 < c["opacity"] < 0.95]


def placeholder_window_ms(changes: list[dict]) -> float:
    """从该图片第一次出现到不透明度≥0.9 的毫秒数（占位可见时长）。"""
    if not changes:
        return -1.0
    start = changes[0]["t"]
    revealed = next((c["t"] for c in changes if (c["opacity"] or 0) >= 0.9), None)
    return float(revealed - start) if revealed is not None else -1.0


def box_range(trace: dict, selector: str) -> tuple[int, int, int]:
    heights = [b["h"] for b in trace["boxes"] if b["sel"] == selector]
    if not heights:
        return (0, 0, 0)
    return (min(heights), max(heights), max(heights) - min(heights))


def shift_total(trace: dict) -> float:
    return round(sum(entry["v"] for entry in trace["shifts"]), 5)


IMAGE_SHIFT_KEYS = ("illustration-frame", "personality-portrait", "discovery-illustration",
                    "assessment-card-art", "atelier-cover-art", "report-character-study", "portrait-spotlight")


def image_shift_sources(trace: dict) -> list[str]:
    """只挑与插画帧相关的位移来源：报告页自己流式渲染造成的位移不该算到图片头上。"""
    return sorted({source for entry in trace["shifts"] for source in entry.get("sources", [])
                   if any(key in source for key in IMAGE_SHIFT_KEYS)})


def shift_sources(trace: dict) -> list[str]:
    return [f"{source}×{sum(1 for e in trace['shifts'] for s in e.get('sources', []) if s == source)}"
            for source in sorted({s for e in trace["shifts"] for s in e.get("sources", [])})]


def image_request_names(since: float) -> list[str]:
    return [name for name, stamp in image_requests() if stamp >= since]


def wait_ready(page, artwork: str, timeout: int = 20000) -> bool:
    try:
        page.wait_for_function(
            "art => { const f = document.querySelector(`[data-artwork=\"${art}\"]`);"
            " return !!f && f.dataset.artworkState === 'ready'; }",
            arg=artwork, timeout=timeout)
        return True
    except Exception:
        return False


def open_page(context, *, cold: bool, reduced: bool = False, budget: int = 6000, video: bool = False):
    page = context.new_page()
    page.add_init_script(f"window.__TRACE_BUDGET__ = {budget};")
    page.add_init_script(TRACE)
    client = context.new_cdp_session(page)
    client.send("Network.enable")
    if cold:
        client.send("Network.setCacheDisabled", {"cacheDisabled": True})
    return page


def new_context(browser, width: int, *, reduced: bool = False, video: bool = False):
    kwargs = {"viewport": VIEWPORTS[str(width)], "device_scale_factor": 1}
    if reduced:
        kwargs["reduced_motion"] = "reduce"
    if video and VIDEO:
        (OUT / "video").mkdir(parents=True, exist_ok=True)
        kwargs["record_video_dir"] = str(OUT / "video")
        kwargs["record_video_size"] = {"width": VIEWPORTS[str(width)]["width"], "height": VIEWPORTS[str(width)]["height"]}
    context = browser.new_context(**kwargs)
    return context


# ---------------------------------------------------------------- 场景

def scenario_cold_slow(browser, width: int) -> None:
    print(f"\n[冷缓存 + 慢网 首屏 {width}]")
    set_rules(delays={"home-hero": SLOW_HERO, "type-infp": SLOW_HERO})
    context = new_context(browser, width, video=(width == 390))
    page = open_page(context, cold=True, budget=7000)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    started = time.time()
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_timeout(900)
    early_requests = image_request_names(started)
    early = page.evaluate("""() => {
      const frame = document.querySelector('[data-artwork="home-hero"]');
      const cta = [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('找到适合我的测评'));
      const h1 = document.querySelector('.discovery-copy h1');
      const overlays = [...document.querySelectorAll('body *')].filter(el => {
        const s = getComputedStyle(el);
        return s.position === 'fixed' && Number(s.zIndex) > 5 && el.getBoundingClientRect().height > innerHeight * 0.5;
      }).length;
      return { heroState: frame ? frame.dataset.artworkState : null,
        heroOpacity: frame && frame.querySelector('img') ? Number(getComputedStyle(frame.querySelector('img')).opacity) : null,
        heroLoading: frame ? frame.querySelector('img')?.getAttribute('loading') : null,
        heroPriority: frame ? frame.querySelector('img')?.getAttribute('fetchpriority') : null,
        ctaEnabled: !!cta && !cta.disabled, h1Visible: !!h1 && h1.getBoundingClientRect().height > 0,
        overlays, galleryText: (document.body.innerText || '').includes('十六种倾向'),
        lazyCount: [...document.querySelectorAll('.illustration-frame img')].filter(i => i.getAttribute('loading') === 'lazy').length };
    }""")
    check(early["heroState"] == "loading", f"{width}/冷缓存：主图未到时处于明确的加载态", f"state={early['heroState']}")
    check(early["heroOpacity"] == 0, f"{width}/冷缓存：加载中不显示半成品图片", f"opacity={early['heroOpacity']}")
    check(early["heroPriority"] == "high" and early["heroLoading"] == "eager",
          f"{width}/冷缓存：首屏主图 eager + 高优先级", f"loading={early['heroLoading']} fetchpriority={early['heroPriority']}")
    check(early["lazyCount"] >= 10, f"{width}/冷缓存：屏外图片仍走懒加载", f"lazy img={early['lazyCount']}")
    check(early["ctaEnabled"] and early["h1Visible"], f"{width}/冷缓存：图片加载期间文字与按钮可用")
    check(early["overlays"] == 0, f"{width}/冷缓存：没有整页 loading 遮罩", f"overlays={early['overlays']}")
    check(early["galleryText"], f"{width}/冷缓存：正文不等待图片")
    # 注意：headless Chromium 实测在首屏布局完成后（313–348ms）就把 16 张 lazy 人物图全部请求了，
    # 不按 1250px 距离阈值延后。这是浏览器行为、且本次未改加载策略，因此只作为观察记录，
    # 真正可判定的是"谁被标成 eager/high"以及"没有额外预加载指令"（见下两条）。
    early_types = sorted({name for name in early_requests if name.startswith("type-")})
    notes.append(f"{width}/冷缓存：启动 900ms 内浏览器已请求 {len(early_types)} 张人物图（DOM 已标 loading=lazy，headless 未按距离阈值延后）")
    high_priority = page.evaluate("() => [...document.querySelectorAll('.illustration-frame img')].filter(i => i.getAttribute('fetchpriority') === 'high').length")
    preloads = page.evaluate("() => document.querySelectorAll('link[rel=\"preload\"][as=\"image\"]').length")
    check(high_priority == 1 and preloads == 0, f"{width}/冷缓存：只有首屏主图是高优先级，且没有额外 preload",
          f"high={high_priority} preload={preloads}")
    check(any(name.startswith("home-hero") for name in early_requests), f"{width}/冷缓存：首屏主图立即发起请求",
          str([name for name in early_requests if name.startswith("home-hero")]))
    page.locator(".discovery-hero").screenshot(path=str(OUT / f"cold-{width}-loading.png"))
    mark(page, "mid-load")

    check(wait_ready(page, "home-hero"), f"{width}/冷缓存：主图完成加载与解码后进入 ready")
    mark(page, "hero-ready")
    page.locator(".discovery-hero").screenshot(path=str(OUT / f"cold-{width}-fade-1.png"))
    page.locator(".discovery-hero").screenshot(path=str(OUT / f"cold-{width}-fade-2.png"))
    page.wait_for_timeout(5200)
    trace = trace_of(page)
    trace_dump[f"cold-slow-{width}"] = trace
    page.locator(".discovery-hero").screenshot(path=str(OUT / f"cold-{width}-after.png"))

    hero = region_changes(trace, "hero", "home-hero")
    check(len(hero) >= 2, f"{width}/冷缓存：记录到主图状态变化", f"changes={len(hero)}")
    check(not any(c["source"] == "vector" for c in trace["changes"]),
          f"{width}/冷缓存：已交付图片全程走位图，从不先用兜底 SVG 顶替")
    check(not any(c["slot"] for c in trace["changes"]),
          f"{width}/冷缓存：加载期间不渲染兜底 SVG 内容（避免 SVG→位图突兀替换）")
    fade = fade_samples(hero)
    check(len(fade) >= 2, f"{width}/冷缓存：主图以透明度过渡自然出现", f"中间帧={len(fade)} 帧")
    durations = {c["transition"] for c in hero if c["transition"] and (c["opacity"] or 0) > 0}
    check(bool(durations) and all("opacity" in d and ("0.2s" in d or "0.18s" in d or "0.22s" in d or "0.24s" in d) for d in durations),
          f"{width}/冷缓存：淡入只改透明度且时长在 180–240ms", f"transition={sorted(durations)}")
    check(shift_total(trace) <= 0.02, f"{width}/冷缓存：图片出现不引起布局位移", f"CLS={shift_total(trace)}")
    check(not image_shift_sources(trace), f"{width}/冷缓存：没有任何位移来自图片容器",
          f"来源={image_shift_sources(trace)}；全部位移来源={shift_sources(trace)}")
    for selector in (".atelier-cover-art", ".portrait-spotlight-art", ".assessment-card-art"):
        low, high, span = box_range(trace, selector)
        check(span <= 1, f"{width}/冷缓存：{selector} 尺寸稳定", f"{low}–{high}px（变化 {span}px）")
    check(not errors, f"{width}/冷缓存：无未捕获 JS 错误", str(errors))
    check(not unexpected, f"{width}/冷缓存：API 全部被模拟", str(set(unexpected)))
    context.close()


def scenario_cache_hit(browser, width: int) -> None:
    """缓存命中：同一文档内离开首页再回来，图片应当直接显示（不闪占位、不为动画拖延）。"""
    print(f"\n[缓存命中 {width}]")
    set_rules()
    context = new_context(browser, width)
    page = open_page(context, cold=False, budget=5000)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(BASE, wait_until="domcontentloaded")
    check(wait_ready(page, "home-hero"), f"{width}/缓存命中：首次访问完成加载")
    page.wait_for_timeout(800)
    before = len([name for name, _ in image_requests() if "home-hero" in name])

    page.goto(f"{BASE}/#/about", wait_until="domcontentloaded")
    page.wait_for_timeout(400)
    reset_trace(page)
    page.goto(f"{BASE}/#/", wait_until="domcontentloaded")
    page.wait_for_selector('[data-artwork="home-hero"]', timeout=10000)
    page.wait_for_timeout(1200)
    trace = trace_of(page)
    trace_dump[f"cache-hit-{width}"] = trace
    after = len([name for name, _ in image_requests() if "home-hero" in name])
    page.locator(".discovery-hero").screenshot(path=str(OUT / f"cache-{width}-after.png"))
    hero = region_changes(trace, "hero", "home-hero")
    window = placeholder_window_ms(hero)
    check(hero and window <= 150, f"{width}/缓存命中：命中缓存时不为演出动画拖延显示", f"占位窗口={window}ms")
    check(len(fade_samples(hero)) <= 6, f"{width}/缓存命中：命中缓存时不长时间闪占位",
          f"中间帧={len(fade_samples(hero))} 帧")
    check(after == before, f"{width}/缓存命中：回到首页没有重新下载主图", f"请求数 {before} → {after}")
    check(shift_total(trace) <= 0.02, f"{width}/缓存命中：无布局位移", f"CLS={shift_total(trace)}")
    check(not image_shift_sources(trace), f"{width}/缓存命中：位移不来自图片容器", f"来源={image_shift_sources(trace)}")
    check(not any(c["source"] == "vector" for c in trace["changes"]), f"{width}/缓存命中：不使用兜底 SVG")
    check(not errors, f"{width}/缓存命中：无未捕获 JS 错误", str(errors))
    context.close()


def scenario_failure(browser, width: int) -> None:
    print(f"\n[图片失败 {width}]")
    set_rules(blocks={"type-infp"})
    context = new_context(browser, width)
    page = open_page(context, cold=True, budget=6000)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    started = time.time()
    page.goto(BASE, wait_until="domcontentloaded")
    page.locator(".personality-gallery").scroll_into_view_if_needed()
    try:
        page.wait_for_function("""() => {
          const f = document.querySelector('.portrait-spotlight [data-artwork="type-infp"]');
          return !!f && f.dataset.artworkState === 'fallback';
        }""", timeout=15000)
        fell_back = True
    except Exception:
        fell_back = False
    check(fell_back, f"{width}/失败：加载失败后退出 loading 并显示兜底")
    fallback = page.evaluate("""() => {
      const f = document.querySelector('.portrait-spotlight [data-artwork="type-infp"]');
      if (!f) return null;
      return { source: f.dataset.artworkSource, state: f.dataset.artworkState,
        hasImg: !!f.querySelector('img'), hasVector: !!f.querySelector('svg'),
        heading: (document.querySelector('.portrait-spotlight h3') || {}).textContent || '' };
    }""")
    check(bool(fallback) and fallback["state"] == "fallback" and fallback["source"] == "vector" and fallback["hasVector"] and not fallback["hasImg"],
          f"{width}/失败：兜底 SVG 顶上且不再保留失效 img", str(fallback))
    check(bool(fallback) and fallback["heading"].strip() != "", f"{width}/失败：正文不受配图失败影响")
    page.locator(".portrait-gallery-body").screenshot(path=str(OUT / f"failure-{width}-fallback.png"))
    page.locator('.portrait-picker button[aria-label^="ENFP，"]').click()
    check(page.locator('.portrait-spotlight [data-artwork="type-enfp"]').count() == 1, f"{width}/失败：换一个人物仍可恢复显示")
    recovered = wait_ready(page, "type-enfp", timeout=10000)
    check(recovered, f"{width}/失败：失败只影响缺图的那一张，其余照常 ready")
    blocked = [name for name in image_request_names(started) if "type-infp" in name]
    check(len(blocked) <= 2, f"{width}/失败：失败不反复重试", f"请求次数={len(blocked)}")
    trace = trace_of(page)
    trace_dump[f"failure-{width}"] = trace
    check(not image_shift_sources(trace), f"{width}/失败：兜底替换不引起图片容器位移",
          f"来源={image_shift_sources(trace)}；CLS={shift_total(trace)}")
    check(not errors, f"{width}/失败：无未捕获 JS 错误", str(errors))
    set_rules()
    context.close()


def scenario_rapid_switch(browser, width: int) -> None:
    print(f"\n[快速连续切换 {width}]")
    set_rules(delays={"type-intj": 2.5})
    context = new_context(browser, width, video=(width == 390))
    page = open_page(context, cold=True, budget=9000)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(BASE, wait_until="domcontentloaded")
    page.locator(".personality-gallery").scroll_into_view_if_needed()
    check(wait_ready(page, "type-infp", timeout=15000), f"{width}/切换：默认人物先就绪")
    sequence = [("INTJ", 250), ("ESFP", 150), ("INTP", 120), ("ENFP", 0)]
    for code, pause in sequence:
        page.locator(f'.portrait-picker button[aria-label^="{code}，"]').click()
        mark(page, f"click-{code}")
        if pause:
            page.wait_for_timeout(pause)
    page.wait_for_timeout(4000)
    trace = trace_of(page)
    trace_dump[f"rapid-switch-{width}"] = trace
    page.locator(".portrait-gallery-body").screenshot(path=str(OUT / f"switch-{width}-final.png"))
    spotlight = page.evaluate("""() => {
      const f = document.querySelector('.portrait-spotlight .illustration-frame');
      const img = f && f.querySelector('img');
      return { artwork: f && f.dataset.artwork, state: f && f.dataset.artworkState,
        file: img ? (img.currentSrc || img.src).split('/').pop() : null,
        opacity: img ? Number(getComputedStyle(img).opacity) : null,
        heading: (document.querySelector('.portrait-spotlight h3') || {}).textContent || '',
        pressed: [...document.querySelectorAll('.portrait-picker button[aria-pressed="true"]')].map(b => b.getAttribute('aria-label')) };
    }""")
    check(spotlight["artwork"] == "type-enfp", f"{width}/切换：插画跟随最后一次选择", str(spotlight["artwork"]))
    check(spotlight["state"] == "ready" and (spotlight["file"] or "").find("type-enfp") >= 0 and (spotlight["opacity"] or 0) >= 0.99,
          f"{width}/切换：显示的是新选择的位图", str(spotlight))
    check(spotlight["pressed"] == [f"ENFP，{portraits['ENFP']['title']}"] and spotlight["heading"].strip() == portraits["ENFP"]["title"],
          f"{width}/切换：选中态、标题与插画指的是同一个人物", json.dumps(spotlight, ensure_ascii=False))
    stale = [c for c in region_changes(trace, "spotlight") if (c["opacity"] or 0) > 0.5 and c["naturalWidth"] > 0
             and not (c["file"] or "").startswith(c["artwork"])]
    check(not stale, f"{width}/切换：可见的插画永远属于当前选择", f"不一致样本={len(stale)}")
    late = [c for c in region_changes(trace, "spotlight", "type-intj") if (c["opacity"] or 0) > 0.5 and c["naturalWidth"] > 0]
    check(not late, f"{width}/切换：晚到的旧图片不会覆盖新选择", f"晚到可见样本={len(late)}")
    check(not image_shift_sources(trace), f"{width}/切换：切换过程不引起图片容器位移",
          f"来源={image_shift_sources(trace)}；CLS={shift_total(trace)}")
    check(not errors, f"{width}/切换：无未捕获 JS 错误", str(errors))
    context.close()


def scenario_reduced_motion(browser, width: int) -> None:
    print(f"\n[减少动画偏好 {width}]")
    set_rules(delays={"home-hero": 1.2})
    context = new_context(browser, width, reduced=True)
    page = open_page(context, cold=True, budget=5000)
    page.goto(BASE, wait_until="domcontentloaded")
    media = page.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches")
    check(media, f"{width}/减少动画：浏览器偏好已生效")
    check(wait_ready(page, "home-hero", timeout=15000), f"{width}/减少动画：主图仍能正常显示")
    page.wait_for_timeout(1500)
    trace = trace_of(page)
    trace_dump[f"reduced-motion-{width}"] = trace
    page.locator(".discovery-hero").screenshot(path=str(OUT / f"reduced-{width}-after.png"))
    hero = region_changes(trace, "hero", "home-hero")
    check(not any(c["transition"] and "opacity" in c["transition"] and "0.2s" in c["transition"] for c in hero),
          f"{width}/减少动画：关掉动画时不再走 200ms 淡入", str([c["transition"] for c in hero][:3]))
    loaded = [c for c in hero if (c["opacity"] or 0) >= 0.99]
    check(bool(loaded) and loaded[0]["naturalWidth"] > 0, f"{width}/减少动画：解码完成即直接显示",
          f"首个完全不透明样本 naturalWidth={loaded[0]['naturalWidth'] if loaded else None}")
    check(len(fade_samples(hero)) == 0, f"{width}/减少动画：没有中间透明度帧", f"中间帧={len(fade_samples(hero))}")
    context.close()


def scenario_report_portrait(browser, width: int) -> None:
    print(f"\n[报告配图 {width}]")
    if "jung-v2" not in reports:
        notes.append("缺少 backend/target/readable-browser-fixtures，跳过报告配图场景")
        print("  SKIP 报告配图：缺少合成报告夹具")
        return
    code = str(reports["jung-v2"].get("computedTypeCode") or "").lower()
    set_rules(delays={f"type-{code}": 1.8})
    context = new_context(browser, width)
    page = open_page(context, cold=True, budget=6000)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(f"{BASE}/#/reports/jung-v2", wait_until="domcontentloaded")
    page.locator("[data-report-overview]").wait_for(timeout=20000)
    text_while_loading = page.evaluate("""() => {
      const study = document.querySelector('[data-report-character]');
      const frame = study && study.querySelector('.illustration-frame');
      return { state: frame ? frame.dataset.artworkState : null,
        body: (document.querySelector('[data-report-overview]') || {}).innerText ? document.querySelector('[data-report-overview]').innerText.length : 0,
        code: (document.querySelector('[data-type-code]') || {}).textContent || '' };
    }""")
    check((text_while_loading["state"] in ("loading", "ready")) and text_while_loading["body"] > 80 and bool(text_while_loading["code"].strip()),
          f"{width}/报告：配图未到时正文与类型码已可读", str(text_while_loading))
    ready = wait_ready(page, f"type-{code}", timeout=15000)
    check(ready, f"{width}/报告：配图最终显示")
    page.wait_for_timeout(4000)
    trace = trace_of(page)
    trace_dump[f"report-portrait-{width}"] = trace
    page.locator("[data-report-character]").screenshot(path=str(OUT / f"report-{width}-portrait.png"))
    portrait = region_changes(trace, "report", f"type-{code}")
    check(len(fade_samples(portrait)) >= 2, f"{width}/报告：配图以透明度过渡出现", f"中间帧={len(fade_samples(portrait))} 帧")
    for selector in ("[data-report-character]", ".report-character-study > .personality-portrait"):
        low, high, span = box_range(trace, selector)
        check(span <= 1, f"{width}/报告：{selector} 尺寸稳定", f"{low}–{high}px（变化 {span}px）")
    check(not image_shift_sources(trace), f"{width}/报告：配图出现不引起图片容器位移",
          f"来源={image_shift_sources(trace)}；CLS={shift_total(trace)}；全部来源={shift_sources(trace)}")
    if shift_total(trace) > 0.02:
        notes.append(f"{width}/报告：报告页整体 CLS={shift_total(trace)}（来源={shift_sources(trace)}），"
                     "与配图无关，属报告流式渲染，不在本轮范围")
    check(not any(c["source"] == "vector" for c in trace["changes"]), f"{width}/报告：使用已交付位图而不是兜底 SVG")
    check(not errors, f"{width}/报告：无未捕获 JS 错误", str(errors))
    context.close()


# ---------------------------------------------------------------- 主流程

def main() -> int:
    if not DIST.exists():
        print("缺少 frontend/dist，请先执行：cd frontend && npm.cmd run build")
        return 2
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"隔离构建：{DIST}\n证据目录：{OUT}\n标签：{LABEL}")

    with StaticServer(PORT), sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            for width in (320, 390, 1440):
                scenario_cold_slow(browser, width)
            for width in (390, 1440):
                scenario_cache_hit(browser, width)
            scenario_failure(browser, 390)
            for width in (390, 1440):
                scenario_rapid_switch(browser, width)
            scenario_reduced_motion(browser, 390)
            scenario_report_portrait(browser, 390)
        finally:
            browser.close()

    check(not unexpected, "全部 API 均被模拟（含其它页面顺带发起的请求）", str(sorted(set(unexpected))))
    passed = sum(1 for entry in checks if entry["passed"])
    summary = {"label": LABEL, "scope": "isolated build + mocked API; no database, no AI, no external network",
               "passed": passed, "failed": len(failures), "failures": failures, "notes": notes, "checks": checks}
    (OUT / f"summary-{LABEL}.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / f"traces-{LABEL}.json").write_text(json.dumps(trace_dump, ensure_ascii=False), encoding="utf-8")
    print(f"\nPASS {passed} / FAIL {len(failures)}；证据：{OUT}")
    for item in failures:
        print(f"  · {item}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
