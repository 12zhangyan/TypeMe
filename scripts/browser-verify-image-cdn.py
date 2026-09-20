#!/usr/bin/env python
"""图片域名（对象存储 + CDN）接入验收：在**本地模拟图片域名**下验证切换、失败回退与加载体验。

隔离构建（`frontend/dist`）+ 同源静态服务器 + 独立的模拟图片域名服务器 + 全模拟 API：
不连数据库、不调用 AI、不访问外网、不需要任何云资源与密钥。

两个服务器分别扮演两个角色，以此证明"图片确实换了一条链路"：

    http://127.0.0.1:<站点端口>   → 页面、JS/CSS、以及**兜底用的本地图片**
    http://127.0.0.1:<图片端口>   → 模拟图片域名，按上传清单的对象键提供同一批图片

模拟图片域名可以按需注入 404 与延迟，用来复现"远端失败回退"、"慢网"与"双重失败"。

用法（仓库根目录）：

    cd frontend; npm.cmd run build; cd ..
    # 远端（默认）：接口 mock 给出"模拟图片域名 + 对象键"的地址表
    python scripts/browser-verify-image-cdn.py
    # 对照：接口 mock 给出**空表**（等价于"库里没有地址"），页面应当用本地打包资源
    $env:TYPEME_IMAGE_MODE='local'; $env:TYPEME_LABEL='local'
    python scripts/browser-verify-image-cdn.py

两种模式用的是**同一份构建产物**：2026-09-20 起地址由运行期接口
（`GET /api/v3/platform/illustrations`，本脚本的站点服务器会 mock 它）决定，
构建期不再有 `VITE_IMAGE_BASE_URL` 这种东西。

注意：本脚本用**回环地址**当图片域名，不尝试用真实域名（例如 COS 官方域名）。
原因是"把真实域名解析到本地 mock"要靠 Chromium 的 --host-resolver-rules，
而本机存在系统代理（127.0.0.1:12000）时会走代理、绕过本地解析，实测无效。
"真实域名这一轮"由 `scripts/browser-verify-real-images.py` 负责（它让接口 mock 返回真实 COS 地址）；
"产物里有没有写死的域名"由 `node scripts/check-bundled-image-urls.mjs` 单独核对。

环境变量：

    TYPEME_IMAGE_MODE         local | remote（默认 remote），决定接口 mock 返回的地址表与断言口径
    TYPEME_LABEL              证据子目录名（默认取 TYPEME_IMAGE_MODE）
    TYPEME_BROWSER_EVIDENCE   证据根目录（默认 docs/optimization/verification/2026-09-20-image-cdn）
    TYPEME_DIST               隔离构建目录（默认 frontend/dist）
    TYPEME_SITE_PORT          站点端口（默认 5196）
    TYPEME_CDN_PORT          模拟图片域名端口（默认 5199）
    TYPEME_VIDEO              置 0 关闭录屏
"""
from __future__ import annotations

import base64
import http.server
import json
import os
import shutil
import sys
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import unquote, urlparse

from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
DIST = Path(os.environ.get("TYPEME_DIST", str(ROOT / "frontend" / "dist")))
MODE = os.environ.get("TYPEME_IMAGE_MODE", "remote").strip().lower()
LABEL = os.environ.get("TYPEME_LABEL", MODE)
OUT = ROOT / os.environ.get(
    "TYPEME_BROWSER_EVIDENCE", "docs/optimization/verification/2026-09-20-image-cdn"
) / LABEL
SITE_PORT = int(os.environ.get("TYPEME_SITE_PORT", "5196"))
CDN_PORT = int(os.environ.get("TYPEME_CDN_PORT", "5199"))
SITE = f"http://127.0.0.1:{SITE_PORT}"
CDN_BASE = f"http://127.0.0.1:{CDN_PORT}"
VIDEO = os.environ.get("TYPEME_VIDEO", "1") != "0"

PUBLISH_MANIFEST = ROOT / "docs/cloud/2026-09-20-image-cos/upload-manifest.json"
ASSET_DIR = ROOT / "frontend/src/assets/illustrations"
# 对象键与哈希的事实来源是上传清单（由 `scripts/gen-image-publish.mjs` 从真实素材生成）。
# 2026-09-20 起**不再**读 `frontend/src/design/illustrationPublish.json`：地址改成数据库驱动后
# 那份映射没有消费者了，页面拿到的地址来自接口 mock（见下面的 api_payload）。
MANIFEST = json.loads(PUBLISH_MANIFEST.read_text(encoding="utf-8"))
OBJECTS: dict[str, str] = {item["name"]: item["objectKey"] for item in MANIFEST["items"]}
SHA256: dict[str, str] = {item["name"]: item["sha256"] for item in MANIFEST["items"]}
RELEASE = MANIFEST["release"]
# 页面会去加载的图片地址前缀。本地模拟验收用 5199 上的模拟域名；
# `browser-verify-real-images.py` 在起服务之前把它改成真实的 COS 域名。
IMAGE_BASE = CDN_BASE

VIEWPORTS = {"320": {"width": 320, "height": 720}, "390": {"width": 390, "height": 844},
             "1440": {"width": 1440, "height": 900}}
# 快速切换场景里"晚到的旧图"：给 INTJ 一个明确的慢速，才可能观察到它迟到
RAPID_SWITCH_DELAY = 2.5

checks: list[dict] = []
failures: list[str] = []
notes: list[str] = []
trace_dump: dict[str, object] = {}
site_log: list[tuple[str, float]] = []
cdn_log: list[tuple[str, float]] = []
requests_lock = threading.Lock()

# 模拟图片域名的可控行为（同进程直接改，不需要控制接口）
CDN_FAIL: set[str] = set()        # 名字命中即 404
CDN_DELAY: dict[str, float] = {}  # 名字 → 延迟秒数
# 站点侧：让"本地兜底资源"也失败，用来验证"双重失败 → 兜底 SVG"
SITE_BLOCK: set[str] = set()
# 站点侧延迟：local 模式下图片由站点提供，慢网要加在这条链路上
SITE_DELAY: dict[str, float] = {}
# 把指定图片的响应**挂住不返回**：用来在"确定还没拿到图"的时刻拍占位截图，
# 比"延迟 N 秒 + 正好抢在中间拍一张"可靠得多。
CDN_HOLD: dict[str, threading.Event] = {}
SITE_HOLD: dict[str, threading.Event] = {}
holds: list[tuple[str, int, bool]] = []


def check(ok: bool, label: str, detail: str = "") -> bool:
    entry = {"label": label, "passed": bool(ok), "detail": detail}
    checks.append(entry)
    if ok:
        print(f"  PASS {label}" + (f" —— {detail}" if detail else ""))
    else:
        failures.append(label + (f" —— {detail}" if detail else ""))
        print(f"  FAIL {label}" + (f" —— {detail}" if detail else ""))
    return bool(ok)


def set_cdn_rules(*, fail: set[str] | None = None, delay: dict[str, float] | None = None,
                  block_site: set[str] | None = None, site_delay: dict[str, float] | None = None) -> None:
    """就地改规则：服务器持有的就是这些对象，重新赋值会让规则失效。"""
    CDN_FAIL.clear()
    CDN_FAIL.update(fail or set())
    CDN_DELAY.clear()
    CDN_DELAY.update(delay or {})
    SITE_BLOCK.clear()
    SITE_BLOCK.update(block_site or set())
    SITE_DELAY.clear()
    SITE_DELAY.update(site_delay or {})
    CDN_HOLD.clear()
    SITE_HOLD.clear()
    holds.clear()


def set_image_delay(delay: dict[str, float]) -> None:
    """把"慢网"加在**当前真正提供图片的那条链路**上：remote 加在图片域名，local 加在站点。"""
    set_cdn_rules(delay=delay if MODE == "remote" else None,
                  site_delay=delay if MODE == "local" else None)


def hold_image(*names: str) -> threading.Event:
    """挂住这些图片的响应，直到返回的 Event 被 set；返回同一个 Event 由调用方释放。"""
    gate = threading.Event()
    target = CDN_HOLD if MODE == "remote" else SITE_HOLD
    for name in names:
        target[name] = gate
    return gate


def wait_for_hold(name: str, table: dict[str, threading.Event]) -> None:
    """等调用方释放。超时上限给得很宽：占位截图可能耗时很久，
    若在这里超时，就等于"图其实已经回来了"，占位证据会变成假的 —— 所以超时会被断言拦下。"""
    for key, gate in list(table.items()):
        if name.startswith(key):
            started = time.time()
            released = gate.wait(timeout=120)
            with requests_lock:
                holds.append((name, int((time.time() - started) * 1000), released))
            return


# ---------------------------------------------------------------- 模拟图片域名

def build_mock_cdn_root() -> Path:
    """按上传清单的对象键铺一份"云端目录"，内容就是仓库里的本地素材。"""
    root = Path(tempfile.gettempdir()) / f"typeme-mock-image-domain-{RELEASE}"
    if root.exists():
        shutil.rmtree(root)
    for name, key in OBJECTS.items():
        for extension in (".webp", ".avif", ".png"):
            source = ASSET_DIR / f"{name}{extension}"
            if source.exists():
                target = root / key
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
                break
        else:
            raise SystemExit(f"缺少素材 {name}，先运行 node scripts/gen-image-publish.mjs")
    return root


def make_cdn_handler(root: Path):
    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):
            pass

        def do_GET(self):  # noqa: N802
            path = unquote(urlparse(self.path).path)
            if path == "/__health":
                self.send_response(200)
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"ok")
                return
            name = Path(path).name
            with requests_lock:
                cdn_log.append((path, time.time()))
            for key in CDN_FAIL:
                if name.startswith(key):
                    self.send_error(404, "mock image domain: not found for verification")
                    return
            for key, delay in CDN_DELAY.items():
                if name.startswith(key):
                    time.sleep(delay)
                    break
            wait_for_hold(name, CDN_HOLD)
            file = root / path.lstrip("/")
            if not file.is_file():
                self.send_error(404, "mock image domain: no such object")
                return
            payload = file.read_bytes()
            self.send_response(200)
            # 与上传清单一致：对象键含内容哈希 → 可以长缓存 + immutable
            self.send_header("Content-Type", "image/webp")
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    return Handler


# ---------------------------------------------------------------- 站点 + 模拟 API

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

portraits = {item["code"]: item for item in json.loads(
    (ROOT / "frontend/src/design/personalityPortraits.json").read_text(encoding="utf-8"))}
unexpected: list[str] = []


def illustration_map() -> dict:
    """页面实际会读到的插画地址表（`GET /api/v3/platform/illustrations`）。

    `MODE=local` 时返回**空表**：那一轮要验的是"库里没有地址时页面怎么办"，
    也就是本地打包资源这条路。其余模式返回完整的 21 条，地址前缀是 `IMAGE_BASE`。
    """
    if MODE == "local":
        return {"release": None, "version": "0:-", "assets": []}
    return {
        "release": RELEASE,
        "version": f"{len(OBJECTS)}:{RELEASE}",
        "assets": [
            {"name": name, "url": f"{IMAGE_BASE}/{key}", "sha256": SHA256[name]}
            for name, key in sorted(OBJECTS.items())
        ],
    }


def api_payload(path: str) -> tuple[int, dict]:
    if path == "/api/v3/me":
        return 200, {"userId": "synthetic", "username": "页面验收示例", "nickname": "演示用户"}
    if path == "/api/v3/platform/illustrations":
        return 200, illustration_map()
    if path == "/api/v3/platform/instruments":
        return 200, {"items": catalog}
    if path in ("/api/v3/attempts", "/api/v3/platform/attempts", "/api/v3/platform/reports"):
        return 200, {"items": [], "page": 0, "size": 20, "total": 0}
    if path == "/api/v3/catalog/current":
        return 200, {"packageId": "typeme-jung48-zh-v2", "questionCount": 48, "basePerDimension": 12,
                     "title": "十六型人格参考测评", "dimensions": []}
    if path == "/api/v3/ai/status":
        return 200, {"enabled": True, "mock": True, "model": "mock", "dailyLimitPerUser": 2,
                     "remainingToday": 2, "apiKeySource": "none", "promptVersion": "typeme-ai-prompt-v3"}
    if path.startswith("/api/v3/auth/csrf"):
        return 200, {"token": "synthetic-browser-only", "headerName": "X-XSRF-TOKEN", "parameterName": "_csrf"}
    if path in ("/api/v1/meta", "/api/v2/assessment-packages/ipip50-zh1"):
        # 旧引擎初始化用仓库内置副本；明确模拟旧内容服务离线，不算未覆盖接口。
        return 503, {"code": "NOT_CONFIGURED", "message": "旧内容使用内置副本"}
    if path.startswith("/api/v3/"):
        return 404, {"code": "NOT_FOUND", "message": "验收未定义此接口"}
    unexpected.append(path)
    return 404, {"code": "NOT_FOUND", "message": "验收未定义此接口"}


def make_site_handler(root: Path):
    class Handler(http.server.SimpleHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

        def log_message(self, *args):
            pass

        def end_headers(self):
            path = urlparse(self.path).path
            self.send_header("Cache-Control",
                             "public, max-age=31536000, immutable" if path.startswith("/assets/") else "no-cache")
            super().end_headers()

        def do_GET(self):  # noqa: N802
            path = unquote(urlparse(self.path).path)
            if path.startswith("/api/"):
                status, body = api_payload(path)
                payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return
            with requests_lock:
                site_log.append((path, time.time()))
            name = Path(path).name
            for key in SITE_BLOCK:
                if key in name:
                    self.send_error(404, "site build: blocked for verification")
                    return
            for key, delay in SITE_DELAY.items():
                if key in name:
                    time.sleep(delay)
                    break
            wait_for_hold(name, SITE_HOLD)
            super().do_GET()

        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("Content-Length") or 0)
            if length:
                self.rfile.read(length)
            path = urlparse(self.path).path
            if path.startswith("/api/"):
                status, body = api_payload(path)
                payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return
            self.send_error(405)

    return Handler


class Server:
    def __init__(self, port: int, handler_cls):
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler_cls)
        self.httpd.daemon_threads = True
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.httpd.shutdown()
        self.httpd.server_close()


# ---------------------------------------------------------------- 页面内追踪

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
  const host = el => { try { return new URL(el.src).host; } catch (e) { return ''; } };
  const region = f => {
    if (f.closest('.portrait-spotlight')) return 'spotlight';
    if (f.closest('.portrait-picker')) return 'picker';
    if (f.closest('.discovery-illustration')) return 'hero';
    if (f.closest('.assessment-card')) return 'card';
    if (f.closest('.atelier-reflection')) return 'reflection';
    if (f.closest('.auth-page') || f.closest('.auth-art')) return 'auth';
    return 'other';
  };
  const snapshot = f => {
    const img = f.querySelector('img');
    const svg = f.querySelector('svg');
    const style = img ? getComputedStyle(img) : null;
    const box = f.getBoundingClientRect();
    return { key: region(f) + '/' + (f.dataset.artwork || '?'), artwork: f.dataset.artwork || '?',
      region: region(f), source: f.dataset.artworkSource || null, state: f.dataset.artworkState || null,
      attempt: f.dataset.artworkAttempt || null,
      slot: svg ? (svg.getAttribute('class') || 'svg') : null,
      box: [Math.round(box.width), Math.round(box.height)],
      file: img ? short(img) : null, host: img ? host(img) : null,
      naturalWidth: img ? img.naturalWidth : -1, complete: img ? img.complete : null,
      opacity: style ? Math.round(Number(style.opacity) * 100) / 100 : null,
      transition: style ? style.transitionProperty + ' ' + style.transitionDuration : null };
  };
  const boxSelectors = ['.atelier-cover-art', '.assessment-card-art', '.portrait-spotlight-art',
    '.portrait-picker button', '.atelier-reflection-art'];
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
      if (!prev || prev.state !== s.state || prev.source !== s.source || prev.attempt !== s.attempt
          || prev.opacity !== s.opacity || prev.naturalWidth !== s.naturalWidth || prev.file !== s.file
          || prev.box[1] !== s.box[1] || prev.slot !== s.slot) {
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


# ---------------------------------------------------------------- 追踪工具

def trace_of(page) -> dict:
    return page.evaluate("window.__trace")


def reset_trace(page) -> None:
    page.evaluate("window.__startTrace()")


def mark(page, label: str) -> None:
    page.evaluate("label => window.__trace.marks.push({t: Math.round(performance.now() - window.__trace.start), label})", label)


def region_changes(trace: dict, region: str, artwork: str | None = None) -> list[dict]:
    return [c for c in trace["changes"] if c["region"] == region and (artwork is None or c["artwork"] == artwork)]


def fade_samples(changes: list[dict]) -> list[dict]:
    return [c for c in changes if c["opacity"] is not None and 0.05 < c["opacity"] < 0.95]


def placeholder_window_ms(changes: list[dict]) -> float:
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
                    "assessment-card-art", "atelier-cover-art", "portrait-spotlight", "atelier-reflection-art")


def image_shift_sources(trace: dict) -> list[str]:
    return sorted({source for entry in trace["shifts"] for source in entry.get("sources", [])
                   if any(key in source for key in IMAGE_SHIFT_KEYS)})


def flatness(path: Path) -> dict:
    """截图内容是否有"画面感"：占位阶段细节少，图片出现后细节明显变多。"""
    from PIL import Image, ImageStat

    with Image.open(path) as image:
        rgb = image.convert("RGB")
        stat = ImageStat.Stat(rgb)
        small = rgb.resize((64, 64))
        distinct = len(small.getcolors(maxcolors=64 * 64) or [])
        return {"size": list(rgb.size), "stddev": round(sum(stat.stddev) / 3, 2), "distinct64": distinct}


def pixel_delta(before: Path, after: Path) -> dict:
    """同一区域"显示前 / 显示后"两帧之间有多少像素真的变了。

    这是不依赖人眼的"图片确实画出来了"证据：占位阶段整块是一个低细节底色，
    图片到达后同一区域出现大量不同像素。设计本身在图片区有渐变底色，
    所以不看"是否纯色"，而看"换了多少画面"。
    """
    from PIL import Image, ImageChops

    with Image.open(before) as a, Image.open(after) as b:
        first = a.convert("RGB")
        second = b.convert("RGB")
        if first.size != second.size:
            second = second.resize(first.size)
        diff = ImageChops.difference(first, second)
        pixels = list(diff.getdata())
        changed = sum(1 for r, g, bl in pixels if max(r, g, bl) > 16)
        mean = sum(max(r, g, bl) for r, g, bl in pixels) / (len(pixels) or 1)
        return {"changedRatio": round(changed / (len(pixels) or 1), 3), "meanAbsDiff": round(mean, 2)}


def shift_sources(trace: dict) -> list[str]:
    return [f"{source}×{sum(1 for e in trace['shifts'] for s in e.get('sources', []) if s == source)}"
            for source in sorted({s for e in trace["shifts"] for s in e.get("sources", [])})]


def cdn_hits(pattern: str, since: float | None = None) -> list[str]:
    with requests_lock:
        return [path for path, stamp in cdn_log if pattern in path and (since is None or stamp >= since)]


def site_hits(pattern: str, since: float | None = None) -> list[str]:
    with requests_lock:
        return [path for path, stamp in site_log if pattern in path and (since is None or stamp >= since)]


def image_hits(pattern: str, since: float | None = None) -> list[str]:
    """当前真正提供图片的那条链路上的请求（remote 看图片域名，local 看站点）。"""
    return cdn_hits(pattern, since) if MODE == "remote" else site_hits(pattern, since)


def wait_ready(page, artwork: str, timeout: int = 20000) -> bool:
    try:
        page.wait_for_function(
            "art => { const f = document.querySelector(`[data-artwork=\"${art}\"]`);"
            " return !!f && f.dataset.artworkState === 'ready'; }",
            arg=artwork, timeout=timeout)
        return True
    except Exception:
        return False


def open_page(context, *, cold: bool, budget: int = 6000):
    page = context.new_page()
    page.add_init_script(f"window.__TRACE_BUDGET__ = {budget};")
    page.add_init_script(TRACE)
    client = context.new_cdp_session(page)
    client.send("Network.enable")
    if cold:
        client.send("Network.setCacheDisabled", {"cacheDisabled": True})
    page.dsh_cdp = client  # 供 cdp_shot 使用
    return page


def cdp_shot(page, path: Path, selector: str | None = None) -> None:
    """直接用 CDP 抓图（可选只抓某个元素）。

    为什么不用 Playwright 的截图：它每次都会先等 `document.fonts.ready`，而字体就绪要等
    文档的 load 事件。只要还有图片请求被我们挂住，load 就永远不触发 —— 截图会一直等到超时。
    占位阶段的那张图必须在这种"请求还没回来"的时刻拍，所以只能绕开这层等待。
    clip 用**文档坐标**并配合 captureBeyondViewport，元素在不在视口内都能拍，两次拍摄取景一致。
    """
    params: dict = {"format": "png", "captureBeyondViewport": True}
    if selector:
        rect = page.evaluate(
            """sel => { const el = document.querySelector(sel); if (!el) return null;
                 const r = el.getBoundingClientRect();
                 return { x: r.left + window.scrollX, y: r.top + window.scrollY,
                          width: r.width, height: r.height }; }""",
            selector)
        if not rect:
            raise RuntimeError(f"CDP 截图找不到元素：{selector}")
        params["clip"] = {"x": rect["x"], "y": rect["y"], "width": rect["width"], "height": rect["height"], "scale": 1}
    data = page.dsh_cdp.send("Page.captureScreenshot", params)
    path.write_bytes(base64.b64decode(data["data"]))


def new_context(browser, width: int, *, video: bool = False):
    kwargs = {"viewport": VIEWPORTS[str(width)], "device_scale_factor": 1}
    if video and VIDEO:
        (OUT / "video").mkdir(parents=True, exist_ok=True)
        kwargs["record_video_dir"] = str(OUT / "video")
        kwargs["record_video_size"] = {"width": VIEWPORTS[str(width)]["width"], "height": VIEWPORTS[str(width)]["height"]}
    return browser.new_context(**kwargs)


# ---------------------------------------------------------------- 场景

def scenario_config_switch(width: int) -> None:
    """配置切换：图片到底走哪条链路，用两个服务器的请求日志说话。"""
    print(f"\n[配置切换 {width}]")
    set_cdn_rules()
    context = new_context(browser_ref[0], width)
    page = open_page(context, cold=True, budget=6000)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    started = time.time()
    page.goto(SITE, wait_until="domcontentloaded")
    page.locator(".personality-gallery").scroll_into_view_if_needed()
    page.wait_for_timeout(2500)
    probe = page.evaluate("""() => {
      const frames = [...document.querySelectorAll('.illustration-frame')];
      const withImg = frames.filter(f => f.querySelector('img'));
      const hosts = {};
      for (const f of withImg) {
        let host = '';
        try { host = new URL(f.querySelector('img').src).host; } catch (e) { host = ''; }
        hosts[host] = (hosts[host] || 0) + 1;
      }
      const key = hosts => Object.keys(hosts).length;
      return { total: frames.length, withImg: withImg.length, hosts,
        heroSrc: (document.querySelector('[data-artwork="home-hero"] img') || {}).src || null,
        attempts: [...new Set(frames.map(f => f.dataset.artworkAttempt))].sort(),
        preloads: document.querySelectorAll('link[rel="preload"][as="image"]').length,
        high: [...document.querySelectorAll('.illustration-frame img')].filter(i => i.getAttribute('fetchpriority') === 'high').length,
        lazy: [...document.querySelectorAll('.illustration-frame img')].filter(i => i.getAttribute('loading') === 'lazy').length };
    }""")
    page.screenshot(path=str(OUT / f"switch-{width}-full.png"), full_page=True)
    cdn_images = cdn_hits(".webp", started)
    site_images = site_hits(".webp", started)
    notes.append(f"{width}/配置切换：图片域名请求 {len(cdn_images)} 条，站点图片请求 {len(site_images)} 条")

    if MODE == "remote":
        check(probe["heroSrc"] is not None and probe["heroSrc"] == f"{CDN_BASE}/{OBJECTS['home-hero']}",
              f"{width}/切换：首屏主图指向图片域名的对象键", str(probe["heroSrc"]))
        check(len(probe["hosts"]) == 1 and CDN_BASE.split("//")[1] in probe["hosts"],
              f"{width}/切换：所有插画都来自图片域名", json.dumps(probe["hosts"], ensure_ascii=False))
        check(not site_images, f"{width}/切换：站点服务器没有收到任何图片请求（源站不再出图）",
              str(sorted(set(site_images))[:5]))
        check(len(cdn_images) >= 5, f"{width}/切换：图片域名确实收到了请求", f"{len(cdn_images)} 条")
    else:
        check(probe["heroSrc"] is not None and probe["heroSrc"].startswith(SITE),
              f"{width}/切换：未配置域名时仍用本地资源", str(probe["heroSrc"]))
        check(not cdn_images, f"{width}/切换：未配置域名时不访问图片域名", str(sorted(set(cdn_images))[:5]))
        check(bool(site_images), f"{width}/切换：图片由站点服务器提供", f"{len(site_images)} 条")

    check(all(attempt == "primary" for attempt in probe["attempts"]) and probe["attempts"] == ["primary"],
          f"{width}/切换：正常加载全程都在主地址上（没有无谓的回退）", str(probe["attempts"]))
    check(probe["preloads"] == 0 and probe["high"] == 1, f"{width}/切换：不预加载全部人物，只有主图高优先级",
          f"preload={probe['preloads']} high={probe['high']} lazy={probe['lazy']}")
    check(probe["lazy"] >= 10, f"{width}/切换：屏外图片仍是懒加载", f"lazy={probe['lazy']}")
    check(not errors, f"{width}/切换：无未捕获 JS 错误", str(errors))
    context.close()


def scenario_cold_slow(width: int) -> None:
    """冷缓存 + 慢网：占位稳定、解码后淡入、正文与按钮不被阻塞。

    慢网用"把响应挂住不返回"实现（而不是 sleep 固定时长）：这样"占位截图"一定拍在
    还没拿到图片的时刻，不会因为截图本身耗时而拍成加载完之后的样子。
    """
    print(f"\n[冷缓存 + 慢网 {width}]")
    set_cdn_rules()
    gate = hold_image("home-hero", "type-infp")
    context = new_context(browser_ref[0], width, video=(width == 390))
    page = open_page(context, cold=True, budget=7000)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    started = time.time()
    page.goto(SITE, wait_until="domcontentloaded")
    page.wait_for_timeout(900)
    early_cdn = cdn_hits("home-hero", started)
    early_site = site_hits("home-hero", started)
    early = page.evaluate("""() => {
      const frame = document.querySelector('[data-artwork="home-hero"]');
      const img = frame && frame.querySelector('img');
      const cta = [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('找到适合我的测评'));
      const h1 = document.querySelector('.discovery-copy h1');
      const overlays = [...document.querySelectorAll('body *')].filter(el => {
        const s = getComputedStyle(el);
        return s.position === 'fixed' && Number(s.zIndex) > 5 && el.getBoundingClientRect().height > innerHeight * 0.5;
      }).length;
      return { heroState: frame ? frame.dataset.artworkState : null,
        heroAttempt: frame ? frame.dataset.artworkAttempt : null,
        heroOpacity: img ? Number(getComputedStyle(img).opacity) : null,
        heroLoading: img ? img.getAttribute('loading') : null,
        heroPriority: img ? img.getAttribute('fetchpriority') : null,
        ctaEnabled: !!cta && !cta.disabled, h1Visible: !!h1 && h1.getBoundingClientRect().height > 0,
        overlays, galleryText: (document.body.innerText || '').includes('十六种倾向') };
    }""")
    check(early["heroState"] == "loading", f"{width}/冷缓存：主图未到时处于明确的加载态", f"state={early['heroState']}")
    check(early["heroOpacity"] == 0, f"{width}/冷缓存：加载中不显示半成品图片", f"opacity={early['heroOpacity']}")
    check(early["heroPriority"] == "high" and early["heroLoading"] == "eager",
          f"{width}/冷缓存：首屏主图 eager + 高优先级", f"loading={early['heroLoading']} priority={early['heroPriority']}")
    check(early["ctaEnabled"] and early["h1Visible"], f"{width}/冷缓存：图片加载期间正文与按钮可用")
    check(early["overlays"] == 0, f"{width}/冷缓存：没有整页 loading 遮罩", f"overlays={early['overlays']}")
    check(early["galleryText"], f"{width}/冷缓存：正文不等待图片")
    check(early["heroAttempt"] == "primary", f"{width}/冷缓存：慢网不是回退，仍在主地址上", str(early["heroAttempt"]))
    if MODE == "remote":
        check(bool(early_cdn), f"{width}/冷缓存：主图请求立即发往图片域名", str(early_cdn[:2]))
        check(not early_site, f"{width}/冷缓存：慢网期间没有偷偷改用本地图片", str(early_site[:2]))
    # 响应仍被挂住 → 这一张一定是"占位状态"的画面（CDP 直取，不必等 load 事件）
    frame_loading = OUT / f"cold-{width}-frame-loading.png"
    shot_started = time.time()
    cdp_shot(page, frame_loading, '[data-artwork="home-hero"]')
    cdp_shot(page, OUT / f"cold-{width}-loading.png", ".discovery-hero")
    shot_ms = int((time.time() - shot_started) * 1000)
    # 截图本身可能耗时较久（元素截图会等元素稳定），所以**先截完再重开追踪窗口**：
    # 这样录到的正好是"图片到达 → 淡入 → 稳定"这一段，不会因为预算耗光而漏掉淡入。
    reset_trace(page)
    mark(page, "mid-load")

    gate.set()
    check(wait_ready(page, "home-hero"), f"{width}/冷缓存：主图完成加载与解码后进入 ready")
    mark(page, "hero-ready")
    page.locator(".discovery-hero").screenshot(path=str(OUT / f"cold-{width}-fade.png"))
    page.wait_for_timeout(5200)
    trace = trace_of(page)
    trace_dump[f"cold-slow-{width}"] = trace
    page.locator(".discovery-hero").screenshot(path=str(OUT / f"cold-{width}-after.png"))
    frame_ready = OUT / f"cold-{width}-frame-ready.png"
    cdp_shot(page, frame_ready, '[data-artwork="home-hero"]')  # 与占位那张同一取景，才可比
    loading_pixels = flatness(frame_loading)
    ready_pixels = flatness(frame_ready)
    delta = pixel_delta(frame_loading, frame_ready)
    held = [ms for _, ms, _ in holds]
    notes.append(f"{width}/冷缓存：主图响应一直挂到占位截图拍完才释放（挂起 {held} ms，两张占位截图耗时 {shot_ms} ms）；"
                 f"主图区域细节 stddev {loading_pixels['stddev']}（{loading_pixels['distinct64']} 色）"
                 f" → {ready_pixels['stddev']}（{ready_pixels['distinct64']} 色）")
    check(all(released for _, _, released in holds) and bool(holds),
          f"{width}/冷缓存：占位截图期间图片响应一直没返回（占位证据不是拍晚了的假象）",
          f"挂起记录={holds}")
    check(loading_pixels["stddev"] <= ready_pixels["stddev"] * 0.5,
          f"{width}/冷缓存：占位阶段图片区细节明显更少（不是半张图）",
          f"占位 stddev={loading_pixels['stddev']} → 显示后 stddev={ready_pixels['stddev']}")
    check(delta["changedRatio"] >= 0.3,
          f"{width}/冷缓存：图片出现后同区域真的换了画面（像素级证据）",
          f"变化像素占比={delta['changedRatio']}，平均差={delta['meanAbsDiff']}")

    hero = region_changes(trace, "hero", "home-hero")
    check(len(hero) >= 2, f"{width}/冷缓存：记录到主图状态变化", f"changes={len(hero)}")
    check(not any(c["source"] == "vector" for c in trace["changes"]),
          f"{width}/冷缓存：已交付图片全程走位图，从不先用兜底 SVG 顶替")
    check(not any(c["slot"] for c in trace["changes"]),
          f"{width}/冷缓存：加载期间不渲染兜底 SVG 内容")
    fade = fade_samples(hero)
    check(len(fade) >= 2, f"{width}/冷缓存：主图以透明度过渡自然出现", f"中间帧={len(fade)} 帧")
    durations = {c["transition"] for c in hero if c["transition"] and (c["opacity"] or 0) > 0}
    check(bool(durations) and all("opacity" in d and ("0.2s" in d or "0.18s" in d or "0.22s" in d or "0.24s" in d) for d in durations),
          f"{width}/冷缓存：淡入只改透明度且时长在 180–240ms", f"transition={sorted(durations)}")
    check(shift_total(trace) <= 0.02, f"{width}/冷缓存：图片出现不引起布局位移", f"CLS={shift_total(trace)}")
    check(not image_shift_sources(trace), f"{width}/冷缓存：没有任何位移来自图片容器",
          f"来源={image_shift_sources(trace)}；全部来源={shift_sources(trace)}")
    for selector in (".atelier-cover-art", ".assessment-card-art", ".portrait-spotlight-art", ".atelier-reflection-art"):
        low, high, span = box_range(trace, selector)
        check(span <= 1, f"{width}/冷缓存：{selector} 尺寸稳定", f"{low}–{high}px（变化 {span}px）")
    check(not errors, f"{width}/冷缓存：无未捕获 JS 错误", str(errors))
    context.close()


def scenario_remote_404_fallback(width: int) -> None:
    """远端 404 → 只回退一次本地资源，成功后正常显示。

    用首页主图（页面上只有一张）做样本，请求次数因此可以断言成精确值而不是"有界"。
    """
    print(f"\n[远端 404 单次回退 {width}]")
    if MODE != "remote":
        scenario_local_only_failure(width)
        return
    set_cdn_rules(fail={"home-hero"})
    context = new_context(browser_ref[0], width)
    page = open_page(context, cold=True, budget=7000)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    started = time.time()
    page.goto(SITE, wait_until="domcontentloaded")
    check(wait_ready(page, "home-hero", timeout=20000), f"{width}/回退：远端 404 后最终仍然显示图片")
    page.wait_for_timeout(2500)
    after = page.evaluate("""() => {
      const f = document.querySelector('[data-artwork="home-hero"]');
      const img = f && f.querySelector('img');
      const h1 = document.querySelector('.discovery-copy h1');
      return { attempt: f && f.dataset.artworkAttempt, state: f && f.dataset.artworkState,
        source: f && f.dataset.artworkSource,
        host: img ? (() => { try { return new URL(img.src).host; } catch (e) { return ''; } })() : null,
        naturalWidth: img ? img.naturalWidth : -1,
        opacity: img ? Number(getComputedStyle(img).opacity) : null,
        h1Visible: !!h1 && h1.getBoundingClientRect().height > 0,
        ctaEnabled: !![...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('找到适合我的测评') && !b.disabled) };
    }""")
    trace = trace_of(page)
    trace_dump[f"remote-404-{width}"] = trace
    page.locator(".discovery-hero").screenshot(path=str(OUT / f"remote-404-{width}.png"))
    cdn_requests = cdn_hits("home-hero", started)
    local_requests = site_hits("home-hero", started)
    check(after["attempt"] == "local-fallback", f"{width}/回退：失败后切到本地打包资源", str(after["attempt"]))
    check(after["state"] == "ready" and after["source"] == "image" and (after["opacity"] or 0) >= 0.99,
          f"{width}/回退：回退后的图片正常显示（不是兜底 SVG）", json.dumps(after, ensure_ascii=False))
    check(after["naturalWidth"] > 0 and SITE.split("//")[1] == after["host"],
          f"{width}/回退：显示的是站点本地的同一张图", f"host={after['host']} nw={after['naturalWidth']}")
    check(len(cdn_requests) == 1, f"{width}/回退：远端只请求一次（不反复重试）", f"远端请求={len(cdn_requests)}")
    check(len(local_requests) == 1, f"{width}/回退：本地只请求一次", f"本地请求={local_requests}")
    check(after["h1Visible"] and after["ctaEnabled"], f"{width}/回退：正文与按钮不受配图失败影响")
    check(not image_shift_sources(trace), f"{width}/回退：回退不引起图片容器位移",
          f"来源={image_shift_sources(trace)}；CLS={shift_total(trace)}")
    check(not errors, f"{width}/回退：无未捕获 JS 错误", str(errors))
    context.close()


def scenario_double_failure(width: int) -> None:
    """远端与本地都失败 → 显示现有兜底 SVG，总共只发两次请求。"""
    print(f"\n[双重失败 → 兜底 {width}]")
    if MODE != "remote":
        notes.append(f"{width}/双重失败：本地模式下只有一次尝试，见「本地失败直接兜底」")
        return
    set_cdn_rules(fail={"home-hero"}, block_site={"home-hero"})
    context = new_context(browser_ref[0], width)
    page = open_page(context, cold=True, budget=7000)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    started = time.time()
    page.goto(SITE, wait_until="domcontentloaded")
    try:
        page.wait_for_function("""() => {
          const f = document.querySelector('[data-artwork="home-hero"]');
          return !!f && f.dataset.artworkState === 'fallback';
        }""", timeout=20000)
        fell_back = True
    except Exception:
        fell_back = False
    check(fell_back, f"{width}/双重失败：两次都失败后进入兜底")
    page.wait_for_timeout(3000)
    probe = page.evaluate("""() => {
      const f = document.querySelector('[data-artwork="home-hero"]');
      const h1 = document.querySelector('.discovery-copy h1');
      const gallery = document.querySelector('.personality-gallery');
      return { state: f && f.dataset.artworkState, source: f && f.dataset.artworkSource,
        attempt: f && f.dataset.artworkAttempt,
        hasImg: !!(f && f.querySelector('img')), hasVector: !!(f && f.querySelector('svg')),
        h1Visible: !!h1 && h1.getBoundingClientRect().height > 0,
        galleryText: !!gallery && gallery.innerText.length > 50,
        others: [...document.querySelectorAll('.illustration-frame')].filter(x => x.dataset.artwork !== 'home-hero')
                  .map(x => x.dataset.artworkState) };
    }""")
    trace = trace_of(page)
    trace_dump[f"double-failure-{width}"] = trace
    page.locator(".discovery-hero").screenshot(path=str(OUT / f"double-failure-{width}.png"))
    cdn_requests = cdn_hits("home-hero", started)
    local_requests = site_hits("home-hero", started)
    check(probe["state"] == "fallback" and probe["source"] == "vector" and probe["hasVector"] and not probe["hasImg"],
          f"{width}/双重失败：兜底 SVG 顶上且不再保留失效 img", json.dumps(probe, ensure_ascii=False))
    check(probe["attempt"] == "local-fallback", f"{width}/双重失败：失败链停在「已回退」这一档", str(probe["attempt"]))
    check(len(cdn_requests) == 1 and len(local_requests) == 1,
          f"{width}/双重失败：总共只发两次请求，没有第三次",
          f"远端={len(cdn_requests)} 本地={len(local_requests)}")
    check(probe["h1Visible"] and probe["galleryText"], f"{width}/双重失败：正文与图鉴不受影响")
    check(all(state in ("ready", "loading") for state in probe["others"]),
          f"{width}/双重失败：只有缺图的那一张受影响", str(probe["others"][:6]))
    check(not errors, f"{width}/双重失败：无未捕获 JS 错误", str(errors))
    set_cdn_rules()
    context.close()


def scenario_local_only_failure(width: int) -> None:
    """本地资源失败 → 直接显示现有兜底 SVG，且只请求一次（与接入前行为一致）。

    只在 local 模式下调用：remote 模式下"本地失败"必然先经历一次远端失败，那是双重失败场景。
    """
    print(f"\n[本地失败直接兜底 {width}]")
    set_cdn_rules(block_site={"home-hero"})
    context = new_context(browser_ref[0], width)
    page = open_page(context, cold=True, budget=7000)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    started = time.time()
    page.goto(SITE, wait_until="domcontentloaded")
    try:
        page.wait_for_function("""() => {
          const f = document.querySelector('[data-artwork="home-hero"]');
          return !!f && f.dataset.artworkState === 'fallback';
        }""", timeout=20000)
        fell_back = True
    except Exception:
        fell_back = False
    check(fell_back, f"{width}/本地失败：退出 loading 并显示兜底")
    page.wait_for_timeout(2500)
    probe = page.evaluate("""() => {
      const f = document.querySelector('[data-artwork="home-hero"]');
      const h1 = document.querySelector('.discovery-copy h1');
      return { state: f && f.dataset.artworkState, source: f && f.dataset.artworkSource,
        attempt: f && f.dataset.artworkAttempt,
        hasImg: !!(f && f.querySelector('img')), hasVector: !!(f && f.querySelector('svg')),
        h1Visible: !!h1 && h1.getBoundingClientRect().height > 0 };
    }""")
    trace = trace_of(page)
    trace_dump[f"local-failure-{width}"] = trace
    page.locator(".discovery-hero").screenshot(path=str(OUT / f"local-failure-{width}.png"))
    local_requests = site_hits("home-hero", started)
    check(probe["state"] == "fallback" and probe["source"] == "vector" and probe["hasVector"] and not probe["hasImg"],
          f"{width}/本地失败：兜底 SVG 顶上且不再保留失效 img", json.dumps(probe, ensure_ascii=False))
    check(len(local_requests) == 1, f"{width}/本地失败：只尝试一次，不无限重试", f"请求={local_requests}")
    check(probe["attempt"] == "primary", f"{width}/本地失败：本地为主时不进入回退档（直接兜底）",
          str(probe["attempt"]))
    check(not cdn_hits("home-hero", started), f"{width}/本地失败：未配置域名时不访问图片域名",
          str(cdn_hits("home-hero", started)))
    check(probe["h1Visible"], f"{width}/本地失败：正文不受配图失败影响")
    check(not errors, f"{width}/本地失败：无未捕获 JS 错误", str(errors))
    set_cdn_rules()
    context.close()


def scenario_cache_hit(width: int) -> None:
    """缓存命中：离开首页再回来，不重新下载、不闪占位、不为动画拖延。"""
    print(f"\n[缓存命中 {width}]")
    set_cdn_rules()
    context = new_context(browser_ref[0], width)
    page = open_page(context, cold=False, budget=5000)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(SITE, wait_until="domcontentloaded")
    check(wait_ready(page, "home-hero"), f"{width}/缓存命中：首次访问完成加载")
    page.wait_for_timeout(900)
    before_cdn = len(cdn_hits("home-hero"))
    before_site = len(site_hits("home-hero"))

    page.goto(f"{SITE}/#/about", wait_until="domcontentloaded")
    page.wait_for_timeout(400)
    reset_trace(page)
    page.goto(f"{SITE}/#/", wait_until="domcontentloaded")
    page.wait_for_selector('[data-artwork="home-hero"]', timeout=10000)
    page.wait_for_timeout(1200)
    trace = trace_of(page)
    trace_dump[f"cache-hit-{width}"] = trace
    after_cdn = len(cdn_hits("home-hero"))
    after_site = len(site_hits("home-hero"))
    page.locator(".discovery-hero").screenshot(path=str(OUT / f"cache-{width}-after.png"))
    hero = region_changes(trace, "hero", "home-hero")
    window = placeholder_window_ms(hero)
    check(hero and window <= 200, f"{width}/缓存命中：命中缓存时不为演出动画拖延显示", f"占位窗口={window}ms")
    check(len(fade_samples(hero)) <= 6, f"{width}/缓存命中：命中缓存时不长时间闪占位", f"中间帧={len(fade_samples(hero))} 帧")
    if MODE == "remote":
        check(after_cdn == before_cdn, f"{width}/缓存命中：回到首页没有重新下载主图（图片域名侧无新请求）",
              f"图片域名请求 {before_cdn} → {after_cdn}")
    else:
        check(after_site == before_site, f"{width}/缓存命中：回到首页没有重新下载主图", f"站点请求 {before_site} → {after_site}")
    check(shift_total(trace) <= 0.02, f"{width}/缓存命中：无布局位移", f"CLS={shift_total(trace)}")
    check(not image_shift_sources(trace), f"{width}/缓存命中：位移不来自图片容器", f"来源={image_shift_sources(trace)}")
    check(not any(c["source"] == "vector" for c in trace["changes"]), f"{width}/缓存命中：不使用兜底 SVG")
    check(not errors, f"{width}/缓存命中：无未捕获 JS 错误", str(errors))
    context.close()


def scenario_rapid_switch(width: int) -> None:
    """快速连续切换：晚到的旧图不得覆盖新选择，且请求次数有界。"""
    print(f"\n[快速连续切换 {width}]")
    set_image_delay({"type-intj": RAPID_SWITCH_DELAY})
    context = new_context(browser_ref[0], width, video=(width == 390))
    page = open_page(context, cold=True, budget=9000)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    started = time.time()
    page.goto(SITE, wait_until="domcontentloaded")
    page.locator(".personality-gallery").scroll_into_view_if_needed()
    check(wait_ready(page, "type-infp", timeout=20000), f"{width}/切换：默认人物先就绪")
    for code, pause in [("INTJ", 250), ("ESFP", 150), ("INTP", 120), ("ENFP", 0)]:
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
        attempt: f && f.dataset.artworkAttempt,
        file: img ? (img.currentSrc || img.src).split('/').pop() : null,
        opacity: img ? Number(getComputedStyle(img).opacity) : null,
        heading: (document.querySelector('.portrait-spotlight h3') || {}).textContent || '',
        pressed: [...document.querySelectorAll('.portrait-picker button[aria-pressed="true"]')].map(b => b.getAttribute('aria-label')) };
    }""")
    check(spotlight["artwork"] == "type-enfp", f"{width}/切换：插画跟随最后一次选择", str(spotlight["artwork"]))
    check(spotlight["state"] == "ready" and (spotlight["file"] or "").find("type-enfp") >= 0 and (spotlight["opacity"] or 0) >= 0.99,
          f"{width}/切换：显示的是新选择的位图", str(spotlight))
    check(spotlight["attempt"] == "primary", f"{width}/切换：切换过程不触发回退", str(spotlight["attempt"]))
    check(spotlight["pressed"] == [f"ENFP，{portraits['ENFP']['title']}"] and spotlight["heading"].strip() == portraits["ENFP"]["title"],
          f"{width}/切换：选中态、标题与插画指的是同一个人物", json.dumps(spotlight, ensure_ascii=False))
    stale = [c for c in region_changes(trace, "spotlight") if (c["opacity"] or 0) > 0.5 and c["naturalWidth"] > 0
             and not (c["file"] or "").startswith(c["artwork"])]
    check(not stale, f"{width}/切换：可见的插画永远属于当前选择", f"不一致样本={len(stale)}")
    late = [c for c in region_changes(trace, "spotlight", "type-intj") if (c["opacity"] or 0) > 0.5 and c["naturalWidth"] > 0]
    check(not late, f"{width}/切换：晚到的旧图片不会覆盖新选择", f"晚到可见样本={len(late)}")
    check(not image_shift_sources(trace), f"{width}/切换：切换过程不引起图片容器位移",
          f"来源={image_shift_sources(trace)}；CLS={shift_total(trace)}")
    over = {name: len(image_hits(name, started)) for name in ("type-intj", "type-esfp", "type-intp", "type-enfp")}
    check(all(count <= 2 for count in over.values()), f"{width}/切换：每个名字的请求次数有界", json.dumps(over))
    check(not errors, f"{width}/切换：无未捕获 JS 错误", str(errors))
    context.close()


# ---------------------------------------------------------------- 主流程

browser_ref: list = [None]


def main() -> int:
    if not DIST.exists():
        print("缺少 frontend/dist，请先执行：cd frontend && npm.cmd run build")
        return 2
    if MODE not in ("local", "remote"):
        print(f"TYPEME_IMAGE_MODE 只能是 local 或 remote，当前为 {MODE}")
        return 2
    if not OBJECTS:
        print("upload-manifest.json 里没有对象键，先运行 node scripts/gen-image-publish.mjs")
        return 2
    OUT.mkdir(parents=True, exist_ok=True)
    cdn_root = build_mock_cdn_root()
    print(f"隔离构建：{DIST}\n模拟图片域名目录：{cdn_root}\n模式：{MODE}\n证据目录：{OUT}")
    print(f"站点：{SITE}　图片域名：{CDN_BASE}（按键 {OBJECTS['home-hero']} 组织）")

    with Server(SITE_PORT, make_site_handler(DIST)), Server(CDN_PORT, make_cdn_handler(cdn_root)):
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            browser_ref[0] = browser
            try:
                for width in (320, 390, 1440):
                    scenario_config_switch(width)
                for width in (320, 390, 1440):
                    scenario_cold_slow(width)
                scenario_remote_404_fallback(390)
                scenario_double_failure(390)
                for width in (390, 1440):
                    scenario_cache_hit(width)
                for width in (390, 1440):
                    scenario_rapid_switch(width)
            finally:
                browser.close()

    check(not unexpected, "全部 API 均被模拟", str(sorted(set(unexpected))))
    passed = sum(1 for entry in checks if entry["passed"])
    summary = {"label": LABEL, "mode": MODE, "site": SITE, "imageBase": CDN_BASE,
               "scope": "isolated build + mock image domain + mocked API; no database, no AI, no cloud resources",
               "passed": passed, "failed": len(failures), "failures": failures, "notes": notes, "checks": checks,
               "requests": {"cdn": [path for path, _ in cdn_log], "site": [path for path, _ in site_log]}}
    (OUT / f"summary-{LABEL}.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / f"traces-{LABEL}.json").write_text(json.dumps(trace_dump, ensure_ascii=False), encoding="utf-8")
    print(f"\nPASS {passed} / FAIL {len(failures)}；证据：{OUT}")
    for item in failures:
        print(f"  · {item}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
