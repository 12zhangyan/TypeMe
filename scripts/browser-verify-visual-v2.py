"""TypeMe 持续优化验收：前端视觉重构与 AI 体验目标（2026-09-18 第 2 轮）。

用法（项目根目录）：

    python scripts/browser-verify-visual-v2.py

前置：
    - 前端 dev server 指向一个**可写测试后端**（本脚本会真实注册账号、走完整测评）；
    - 该后端建议开着 AI（mock 适配器即可），否则 AI 面板那一段会 SKIP：
          TYPEME_AI_ENABLED=true TYPEME_AI_MOCK_MODE=true TYPEME_AI_API_KEY=<占位串>
    - 数据库必须是一次性的（内存 H2）。**不要指向含有真实用户数据或真实 key 的库。**

环境变量：
    TYPEME_BASE   被验收地址（默认 http://127.0.0.1:5175，即转发到一次性测试后端）
    TYPEME_OUT    截图目录（默认 docs/optimization/verification/2026-09-18-visual-v2）
    TYPEME_LABEL  写进报告的说明

产出：<TYPEME_OUT>/*.png 与 REPORT.md / result.json

## 这一轮在验什么（对应 `docs/DSH-前端视觉重构与AI体验目标.md` 的验收条款）

| 条款 | 这里的做法 |
| --- | --- |
| 320 / 390 / 768 / 1440 无横向滚动、无遮挡 | 每个视口量 `scrollWidth - clientWidth`，并列出越过右边界的元素 |
| 正文对比度 ≥ 4.5:1 | 在**真实渲染结果**上取前景色 + 最近的实底背景色，按字号/字重选 4.5 或 3.0 门槛 |
| 触控目标 ≥44×44 | 量所有可见 `button/[role=radio]/select/textarea/input` 的实际盒子 |
| 200% 缩放 | CSS `zoom: 2`（等价 720px 布局宽度）后再量一次溢出，并用 720px 视口交叉验证 |
| reduced-motion | 模拟 `prefers-reduced-motion: reduce`，检查动画时长被压到 0 |
| 键盘可达 + 焦点可见 | 真实按 Tab，检查第一个焦点是「跳到主要内容」，且每一站都有可见焦点环 |
| AI 生成前 / 进行中 / 生成后 / 错误 | 走真实点击：结构预览 → 范围确认 → 生成 → 结果，并检查**没有百分比进度**这类假信息 |
| 切页后不留轮询 | 结果出来后再等 6s、离开报告页再等 6s，两次都不允许出现新的 `/api/v3/ai/` 请求 |

## 纪律

    - 账号名带随机后缀，密码是脚本生成的合成值，**不写进报告**；
    - 只调用注册、建测评、作答、交卷、读报告、AI 分析；不碰删除/注销/导出；
    - 不使用真实模型：本脚本假定后端是 mock 适配器，并在报告里如实标注。
"""

from __future__ import annotations

import json
import os
import secrets
import sys
import time
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(
    os.environ.get(
        "TYPEME_OUT",
        ROOT / "docs" / "optimization" / "verification" / "2026-09-18-visual-v2",
    )
)
BASE = os.environ.get("TYPEME_BASE", "http://127.0.0.1:5175")
BASE_LABEL = os.environ.get("TYPEME_LABEL", "")

VIEWPORTS = {
    "320x568": {"width": 320, "height": 568},
    "390x844": {"width": 390, "height": 844},
    "768x1024": {"width": 768, "height": 1024},
    "1440x900": {"width": 1440, "height": 900},
}

# 公开页面（无需登录）在任何视口都能走查；报告页在拿到报告后再补测。
PUBLIC_PAGES = {
    "home": "/",
    "about": "/about",
    "recover": "/recover",
    "login": "/login",
    "register": "/register",
}
AI_WAIT_MS = 90_000

failures: list[str] = []
skips: list[str] = []
notes: list[str] = []
passed = [0]

# 后端实测到的 AI 能力（必须由真实响应填充，否则报告里的 mock 结论无据）。
probe: dict[str, object] = {"enabled": None, "mock": None}


def check(condition: bool, label: str, detail: str = "") -> None:
    if condition:
        passed[0] += 1
        print(f"  PASS {label}")
    else:
        failures.append(f"{label}{(' —— ' + detail) if detail else ''}")
        print(f"  FAIL {label}{(' —— ' + detail) if detail else ''}")


def skip(label: str) -> None:
    skips.append(label)
    print(f"  SKIP {label}")


def capture(page: Page, name: str) -> None:
    page.screenshot(path=str(OUT / name), full_page=False)


def go(page: Page, hash_path: str, settle: int = 600) -> None:
    page.goto(f"{BASE}/#{hash_path}", wait_until="domcontentloaded")
    page.wait_for_timeout(settle)


# ── 注入到页面里的测量函数 ───────────────────────────────────────────────────

OVERFLOW_JS = """() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth + 1) return { overflow: 0, worst: [] };
    const bad = [];
    document.querySelectorAll('*').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > doc.clientWidth + 1) {
            bad.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 50)} 右边界 ${Math.round(r.right)}`);
        }
    });
    return { overflow: doc.scrollWidth - doc.clientWidth, worst: bad.slice(0, 3) };
}"""

# 对比度审计：只算"有直接文字"的元素，背景取最近一个不透明的祖先背景色。
# 这是**渲染结果**上的测量（不是读 token），所以能抓到"某个类把它盖成了浅色"这类问题。
CONTRAST_JS = """() => {
    const parse = (c) => {
        const m = String(c).match(/rgba?\\(([^)]+)\\)/);
        if (!m) return null;
        const p = m[1].split(',').map((x) => parseFloat(x));
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const lum = (c) => {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const ratio = (a, b) => {
        const l1 = lum(a), l2 = lum(b);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const over = (fg, bg) => ({
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
        a: 1,
    });
    const bgOf = (el) => {
        let node = el;
        while (node) {
            const bg = parse(getComputedStyle(node).backgroundColor);
            if (bg && bg.a >= 0.95) return bg;
            node = node.parentElement;
        }
        return { r: 255, g: 255, b: 255, a: 1 };
    };
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('main *, header a, header span, footer p, footer a, footer span')) {
        if (el.closest('[aria-hidden="true"], .sr-only, [hidden], [disabled]')) continue;
        const text = Array.from(el.childNodes)
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent.trim())
            .join(' ')
            .trim();
        if (!text) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.6) continue;
        const fg = parse(cs.color);
        if (!fg || fg.a < 0.5) continue;
        const bg = bgOf(el);
        const r = ratio(over(fg, bg), bg);
        const fs = parseFloat(cs.fontSize);
        const weight = parseInt(cs.fontWeight, 10) || 400;
        const large = fs >= 24 || (fs >= 18.66 && weight >= 700);
        const need = large ? 3.0 : 4.5;
        if (r + 0.05 < need) {
            const key = text.slice(0, 20) + '|' + Math.round(fs) + '|' + cs.color;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
                text: text.slice(0, 30),
                tag: el.tagName.toLowerCase(),
                cls: (el.className || '').toString().slice(0, 44),
                ratio: Math.round(r * 100) / 100,
                need,
                fontSize: Math.round(fs),
                color: cs.color,
                bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
            });
        }
    }
    return out;
}"""

TARGETS_JS = """() => {
    const out = [];
    const sel = 'button, [role="radio"], select, textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])';
    for (const el of document.querySelectorAll(sel)) {
        if (el.closest('[hidden], [aria-hidden="true"]')) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || '')
            .trim().replace(/\\s+/g, ' ').slice(0, 22);
        out.push({ label, w: Math.round(r.width), h: Math.round(r.height), tag: el.tagName.toLowerCase() });
    }
    return out;
}"""

ANIM_JS = """() => {
    const out = [];
    const add = (el, name, dur) => {
        if (!name || name === 'none') return;
        out.push({ name, dur, el: el.tagName.toLowerCase() + '.' + (el.className || '').toString().slice(0, 34) });
    };
    for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        add(el, cs.animationName, cs.animationDuration);
        const before = getComputedStyle(el, '::before');
        add(el, before.animationName, before.animationDuration);
        const after = getComputedStyle(el, '::after');
        add(el, after.animationName, after.animationDuration);
    }
    return out;
}"""


def overflow_of(page: Page) -> dict:
    return page.evaluate(OVERFLOW_JS)


def audit_viewport(page: Page, viewport_label: str, page_label: str) -> None:
    """一个视口 × 一个页面上的通用布局与可读性判据。"""
    info = overflow_of(page)
    check(
        info["overflow"] <= 0,
        f"{viewport_label} {page_label}：无横向滚动",
        f"多出 {info['overflow']}px；越界元素 {' ;; '.join(info['worst'])}",
    )

    violations = page.evaluate(CONTRAST_JS)
    short = [
        f"{v['text']!r}({v['fontSize']}px {v['color']} on {v['bg']})={v['ratio']}<{v['need']}"
        for v in violations[:4]
    ]
    check(
        not violations,
        f"{viewport_label} {page_label}：正文/辅助文字对比度达标",
        f"{len(violations)} 处不足：{' ;; '.join(short)}",
    )

    # 源码注释里用 `**强调**` 是给人读的；一旦它出现在**渲染结果**里，用户看到的是星号。
    # 这类问题任何渲染测试都不会报错（它只是普通文本），所以在真实页面上直接扫一遍。
    stray = page.evaluate(
        """() => {
            const main = document.querySelector('main');
            if (!main) return 0;
            return (main.innerText.match(/\\*\\*/g) || []).length;
        }"""
    )
    check(stray == 0, f"{viewport_label} {page_label}：没有残留的 markdown 星号", f"渲染出 {stray} 处 **")


def audit_targets(page: Page, viewport_label: str, page_label: str) -> None:
    """触控目标：手机宽度要求 ≥44，桌面（鼠标）按 WCAG 2.5.8 的 24 兜底。"""
    min_size = 44 if int(viewport_label.split("x")[0]) <= 390 else 24
    targets = page.evaluate(TARGETS_JS)
    bad = [t for t in targets if t["h"] < min_size or t["w"] < min_size]
    short = [f"{t['label'] or t['tag']}({t['w']}×{t['h']})" for t in bad[:5]]
    check(
        not bad,
        f"{viewport_label} {page_label}：交互控件 ≥{min_size}×{min_size}",
        f"{len(bad)} 个偏小：{' ;; '.join(short)}",
    )


def max_animation_seconds(dur: str) -> float:
    """`animationDuration` 可能是逗号分隔的多个值（多段动画），取其中最大的一段。"""
    worst = 0.0
    for part in str(dur).split(","):
        token = part.strip().rstrip("s")
        try:
            worst = max(worst, float(token))
        except ValueError:
            continue
    return worst


def run_assessment(page: Page) -> str:
    """走完一次完整主测（跳过补充题），返回报告 id。

    这段刻意写得比"点一下、等一下"啰嗦，原因是**这三件事都是真实存在的**：

    1. 「下一题」在一次保存往返期间是禁用的，读到的"可用"可能下一秒就过期
       （上一轮验收报告里出现过"停在 16/48"），所以每个动作都先 `wait_for` 到真的可交互；
    2. 作答与答题位置是两次带 `expectedRevision` 的写入，脚本以机器速度连点时
       **自己**就能撞出 409（本脚本第一版实测到过：进度回到 2/48 并弹出冲突横幅）。
       这不是页面缺陷 —— 页面按契约停写并让用户选择，正是期望行为 ——
       但脚本必须像人一样处理它：点「载入最新进度」，然后接着答；
    3. 交卷前要等保存落库，否则最后一题可能还没写上去就点了「完成主测」。
    """
    go(page, "/", settle=800)
    page.locator("[data-primary-entry]").click()
    page.wait_for_selector("[data-question-card]", timeout=30000)

    answered = 0
    conflicts = 0
    for _ in range(200):
        if "/reports/" in page.url:
            break

        # 409 冲突：先载入最新进度（绝不静默覆盖），再从最新版本继续
        if page.locator("[data-conflict-banner]").count() > 0:
            reload_button = page.locator("[data-reload-latest]")
            if reload_button.count() > 0:
                reload_button.first.click()
                page.wait_for_timeout(1800)
                conflicts += 1
                continue

        next_button = page.locator("[data-next]")
        try:
            next_button.first.wait_for(state="visible", timeout=10000)
        except Exception:
            break
        label = next_button.first.inner_text()
        if "完成主测" in label or "完成并交卷" in label:
            break

        rating = page.locator(".option-cell[data-rating='1']")
        try:
            rating.first.wait_for(state="visible", timeout=10000)
        except Exception:
            break
        rating.first.click()
        try:
            page.wait_for_function(
                """() => {
                    const b = document.querySelector('[data-next]');
                    const s = document.querySelector('[data-save-state]');
                    const saving = s !== null && s.innerText.includes('正在保存');
                    return b !== null && !b.disabled && !saving;
                }""",
                timeout=15000,
            )
        except Exception:
            notes.append(f"第 {answered + 1} 题作答后「下一题」15s 内没有恢复可用")
            break
        next_button.first.click()
        page.wait_for_timeout(320)
        answered += 1

    notes.append(f"主测共点击作答 {answered} 次（每题选第 1 档）；脚本自身撞到 409 冲突 {conflicts} 次")

    # 最后一题：作答 → 等保存 → 交卷
    final_rating = page.locator(".option-cell[data-rating='1']")
    final_next = page.locator("[data-next]")
    if final_rating.count() > 0 and final_next.count() > 0:
        final_rating.first.click()
        try:
            page.wait_for_function(
                """() => {
                    const b = document.querySelector('[data-next]');
                    const s = document.querySelector('[data-save-state]');
                    const saving = s !== null && s.innerText.includes('正在保存');
                    return b !== null && !b.disabled && !saving;
                }""",
                timeout=20000,
            )
        except Exception:
            notes.append("最后一题保存后交卷按钮没有恢复可用")
        final_next = page.locator("[data-next]")
        if final_next.count() > 0:
            final_next.first.click()
            page.wait_for_timeout(4000)

    # 主测结束可能进「补充题要不要做」这一步：这里选跳过（跳过 ≠ 没答，主测照常计分）
    skip_button = page.locator("[data-skip-clarification]")
    if skip_button.count() > 0:
        skip_button.first.click()
        page.wait_for_timeout(4000)

    # 交卷是服务端结算（生成报告），给它足够时间；期间若落到「信息不足」也如实记录
    for _ in range(20):
        if "/reports/" in page.url:
            break
        page.wait_for_timeout(1000)
    if "/reports/" not in page.url:
        state = page.evaluate(
            """() => ({
                offer: !!document.querySelector('[data-clarify-offer]'),
                needsReview: !!document.querySelector('[data-needs-review]'),
                conflict: !!document.querySelector('[data-conflict-banner]'),
                unanswered: document.querySelectorAll('[data-unanswered-list]').length,
                progress: (document.querySelector('[data-save-state]') || {}).innerText || '',
            })"""
        )
        notes.append(f"交卷后没有进入报告页；当时页面状态：{state}")

    url = page.url
    return url.split("/reports/")[1].split("?")[0] if "/reports/" in url else ""


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"被验收地址：{BASE}{(' （' + BASE_LABEL + '）') if BASE_LABEL else ''}")
    print(f"截图目录：{OUT}")

    username = f"visual_{secrets.token_hex(4)}"
    password = f"Vv-{secrets.token_hex(6)}"
    report_id = ""
    ai_requests: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        # 用**显式** context：`browser.new_page()` 建的是隐式 context，Playwright 不允许
        # 再往里加页面（`Please use browser.new_context()`）。而第 6b 步的三个 mock 场景
        # 必须在**同一个已登录会话**里开新页（新 context 没有 cookie，会被路由守卫送去登录页）。
        context = browser.new_context(viewport=VIEWPORTS["390x844"])
        try:
            page = context.new_page()
            page.set_default_timeout(20000)
            page.on(
                "request",
                lambda req: ai_requests.append(f"{req.method} {req.url}")
                if "/api/v3/ai/" in req.url or "/analyses" in req.url
                else None,
            )

            # ── 0. 注册（真实表单）并确认 AI 能力 ─────────────────────────
            print("\n[0] 注册账号并确认 AI 能力状态")
            go(page, "/register")
            page.fill("input[name='username']", username)
            page.fill("input[name='new-password']", password)
            page.fill("input[name='confirm-password']", password)
            disclaimer = page.locator("input[name='disclaimer-accepted']")
            if disclaimer.count() == 1:
                disclaimer.check()
            page.click("button[type='submit']")
            try:
                page.wait_for_selector("[data-recovery-codes] li", timeout=30000)
            except Exception:
                # 本机注册限流是 1 小时 5 次（`typeme.ratelimit.register.ip-limit`）。
                # 连续复跑本脚本**真的会撞到它**；撞到时如实记成 SKIP ——
                # 既不能把环境的限流说成页面缺陷，也不能假装后面的走查跑过了。
                main_text = page.locator("main").inner_text()
                hint = next(
                    (line.strip() for line in main_text.splitlines() if "频繁" in line or "稍后" in line),
                    "",
                )
                notes.append(f"注册被拒（未进入账号页）：{hint or main_text[:160]!r}")
                skip("注册被限流/失败：需要登录态的答题页、报告页与 AI 区走查本轮未执行")
                return finish(username)
            page.locator("[data-recovery-codes] ~ div input[type='checkbox']").first.check()
            page.wait_for_timeout(250)
            page.locator("button:has-text('去')").first.click()
            page.wait_for_timeout(1500)
            check("/account" in page.url, "注册后进入账号页", f"URL {page.url}")

            status = page.evaluate(
                """async () => {
                    const r = await fetch('/api/v3/ai/status', { credentials: 'include' });
                    return { status: r.status, body: await r.json().catch(() => null) };
                }"""
            )
            body = status.get("body") or {}
            probe["enabled"] = bool(body.get("enabled"))
            probe["mock"] = bool(body.get("mock"))
            notes.append(
                f"后端 AI 能力：enabled={probe['enabled']} mock={probe['mock']} "
                f"model={body.get('model')} promptVersion={body.get('promptVersion')}"
            )
            check(status.get("status") == 200, "GET /api/v3/ai/status 可读", f"status={status.get('status')}")
            if not probe["enabled"]:
                skip("后端未开启 AI：AI 面板生成流程无法在浏览器里走通")

            # 账号页需要登录态：注册之后立刻在同一会话里量一遍
            print("\n[0b] 账号与数据页 × 四视口（已登录）")
            for label, viewport in VIEWPORTS.items():
                page.set_viewport_size(viewport)
                go(page, "/account", settle=1200)
                audit_viewport(page, label, "account")
                if label in ("320x568", "1440x900"):
                    audit_targets(page, label, "account")
            page.set_viewport_size(VIEWPORTS["390x844"])
            capture(page, "390x844-account.png")

            # ── 1. 公开页面 × 四视口 ──────────────────────────────────────
            print("\n[1] 公开页面 × 320 / 390 / 768 / 1440")
            for label, viewport in VIEWPORTS.items():
                page.set_viewport_size(viewport)
                for page_label, path in PUBLIC_PAGES.items():
                    go(page, path)
                    audit_viewport(page, label, page_label)
                    if page_label in ("home", "login"):
                        capture(page, f"{label}-{page_label}.png")
                if label in ("320x568", "390x844"):
                    # 表单页单独量一次触控目标（输入框/选择框最容易被做成 40px）
                    go(page, "/register")
                    audit_targets(page, label, "register")

            # ── 2. 完整测评 → 报告页 ──────────────────────────────────────
            print("\n[2] 首页 → 答题页 → 报告页")
            page.set_viewport_size(VIEWPORTS["390x844"])
            report_id = run_assessment(page)
            check(bool(report_id), "完成一次主测并拿到报告 id", f"URL {page.url}")
            notes.append(f"报告 id 形如 {report_id[:8]}…（UUID，不含个人信息）")

            if not report_id:
                return finish(username)

            # 答题页与报告页的窄屏截图（对照上一轮的 before 图）
            page.set_viewport_size(VIEWPORTS["320x568"])
            go(page, "/reports")
            audit_viewport(page, "320x568", "reports")
            capture(page, "320x568-reports.png")
            audit_targets(page, "320x568", "reports")

            page.set_viewport_size(VIEWPORTS["390x844"])
            go(page, f"/reports/{report_id}", settle=1500)
            check(
                page.locator("[data-report-overview]").count() == 1,
                "报告页有「结果概览」深色面板",
                "没找到 [data-report-overview]",
            )
            check(
                "#/reports/" in page.url,
                "报告页 URL 未跳走（表格/目录不产生路由副作用）",
                f"URL {page.url}",
            )

            # 目录：点第一个 chip 应当滚动而不改路由（hash 路由下 href="#id" 会跳到假路由）
            toc = page.locator("[data-toc]")
            if toc.count() > 0:
                url_before = page.url
                toc.nth(1).click()
                page.wait_for_timeout(900)
                check(page.url == url_before, "点报告目录不改路由（滚动而非跳转）", f"{url_before} → {page.url}")
                check(
                    page.evaluate("() => window.scrollY") > 0,
                    "点报告目录确实滚动了（不是点了没反应）",
                    "scrollY 仍为 0",
                )
                capture(page, "390x844-report-toc.png")

            for label, viewport in VIEWPORTS.items():
                page.set_viewport_size(viewport)
                go(page, f"/reports/{report_id}", settle=1500)
                audit_viewport(page, label, "report")
                if label in ("320x568", "1440x900"):
                    audit_targets(page, label, "report")

            # ── 3. 200% 缩放 ─────────────────────────────────────────────
            print("\n[3] 200% 缩放（等价布局宽度 720px）")
            page.set_viewport_size(VIEWPORTS["1440x900"])
            go(page, f"/reports/{report_id}", settle=1500)
            page.evaluate("() => { document.documentElement.style.zoom = '2'; }")
            page.wait_for_timeout(800)
            zoomed = overflow_of(page)
            check(
                zoomed["overflow"] <= 0,
                "报告页 200% 缩放无横向滚动",
                f"多出 {zoomed['overflow']}px；{' ;; '.join(zoomed['worst'])}",
            )
            capture(page, "1440x900-report-zoom200.png")
            page.evaluate("() => { document.documentElement.style.zoom = '1'; }")

            page.set_viewport_size({"width": 720, "height": 900})
            go(page, f"/reports/{report_id}", settle=1200)
            cross = overflow_of(page)
            check(
                cross["overflow"] <= 0,
                "报告页 720px 视口无横向滚动（与 200% 缩放交叉验证）",
                f"多出 {cross['overflow']}px；{' ;; '.join(cross['worst'])}",
            )

            # ── 4. reduced-motion ────────────────────────────────────────
            print("\n[4] prefers-reduced-motion: reduce")
            page.set_viewport_size(VIEWPORTS["1440x900"])
            page.emulate_media(reduced_motion="reduce")
            go(page, "/", settle=1200)
            running = [a for a in page.evaluate(ANIM_JS) if max_animation_seconds(a["dur"]) > 0.01]
            check(
                not running,
                "reduced-motion 下所有动画时长被压到 0",
                f"{len(running)} 个仍在动：{running[:3]}",
            )
            capture(page, "1440x900-home-reduced-motion.png")
            go(page, f"/reports/{report_id}", settle=1500)
            long_report = [a for a in page.evaluate(ANIM_JS) if max_animation_seconds(a["dur"]) > 0.01]
            check(
                not long_report,
                "报告页在 reduced-motion 下也没有长动画",
                f"{len(long_report)} 个仍在动：{long_report[:3]}",
            )
            page.emulate_media(reduced_motion="no-preference")

            # ── 5. 键盘可达与焦点可见 ────────────────────────────────────
            print("\n[5] 键盘 Tab 走查（焦点必须可见）")
            page.set_viewport_size(VIEWPORTS["1440x900"])
            go(page, "/", settle=1000)
            # 必须先 `reload()` 再按 Tab。2026-09-18 实测：本站是 hash 路由，
            # 前面几步已经用过 `#/reports/...`，再 `goto('#/')` 属于**同文档**导航，
            # 此时 Chromium 会保留"顺序焦点导航起点"，第一次 Tab 直接落到主内容里，
            # 于是"第一个焦点是不是跳到主要内容"这条判据测的就不是页面本身了。
            # reload 会重置这个起点（实测第一站回到 `a.skip-link`，且在焦点下真的可见）。
            page.reload(wait_until="domcontentloaded")
            page.wait_for_timeout(1500)
            stops = []
            for _ in range(8):
                page.keyboard.press("Tab")
                page.wait_for_timeout(120)
                stops.append(
                    page.evaluate(
                        """() => {
                            const el = document.activeElement;
                            if (!el || el === document.body) return null;
                            const cs = getComputedStyle(el);
                            const r = el.getBoundingClientRect();
                            return {
                                tag: el.tagName.toLowerCase(),
                                cls: (el.className || '').toString().slice(0, 40),
                                text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 20),
                                focusVisible: el.matches(':focus-visible'),
                                ring: cs.boxShadow !== 'none' || parseFloat(cs.outlineWidth || '0') >= 2,
                                w: Math.round(r.width),
                                h: Math.round(r.height),
                            };
                        }"""
                    )
                )
            valid = [s for s in stops if s]
            check(len(valid) >= 6, "首页有连续可聚焦的键盘路径", f"只走到 {len(valid)} 站")
            first = valid[0] if valid else None
            check(
                bool(first) and "skip-link" in (first["cls"] or "") and first["focusVisible"],
                "第一个 Tab 落在「跳到主要内容」（且是 :focus-visible）",
                f"实际第一站 {first}",
            )
            # skip-link 平时是 `sr-only`（1×1），只有聚焦时才展开成可见按钮。
            # 所以这里量的必须是"聚焦之后"的盒子 —— 否则 1×1 也能骗过"存在性"检查。
            skip_visible = bool(first) and first["w"] > 80 and first["h"] > 20
            check(
                skip_visible,
                "聚焦时「跳到主要内容」真的可见（不是 1px 隐形）",
                f"聚焦后的盒子 {first['w']}×{first['h']}" if first else "没有焦点元素",
            )
            no_ring = [s for s in valid if not s["ring"]]
            check(
                not no_ring,
                "每一站都有可见焦点环（box-shadow 或 ≥2px outline）",
                f"{len(no_ring)} 站没有：{no_ring[:3]}",
            )
            invisible = [s for s in valid if s["w"] < 4 or s["h"] < 4]
            check(not invisible, "没有聚焦到不可见的元素", f"{invisible[:2]}")
            capture(page, "1440x900-home-focus.png")

            # ── 6. AI 面板：生成前 → 确认 → 结果 ──────────────────────────
            print("\n[6] AI 洞察区（生成前 → 范围确认 → 生成 → 结果）")
            page.set_viewport_size(VIEWPORTS["390x844"])
            loaded_from = len(ai_requests)
            go(page, f"/reports/{report_id}", settle=2000)
            panel = page.locator("[data-ai-panel]")
            check(panel.count() == 1, "报告页有且仅有一块 AI 面板", f"计数 {panel.count()}")

            # 目标书里的一条硬要求：**不在页面加载时偷偷调模型**。
            # 加载期间只该有读接口（status / 任务列表），不该出现任何创建或重试的 POST。
            on_load = ai_requests[loaded_from:]
            sneaky = [r for r in on_load if r.startswith("POST")]
            check(
                not sneaky,
                "打开报告页不会偷偷发起生成（加载期间只有读接口）",
                f"加载期间出现了写请求：{sneaky[:3]}",
            )
            notes.append(
                f"打开报告页期间的 AI 请求：{len(on_load)} 个，"
                f"全部是读接口={all(not r.startswith('POST') for r in on_load)}"
            )

            if probe["enabled"] and panel.count() == 1:
                check(
                    page.locator("[data-ai-structure]").count() == 1,
                    "生成前显示「你将得到什么」结构预览",
                    "没找到 [data-ai-structure]",
                )
                check(
                    page.locator("[data-ai-start]").count() == 1,
                    "生成入口只有一个",
                    f"计数 {page.locator('[data-ai-start]').count()}",
                )
                capture(page, "390x844-ai-before.png")

                page.locator("[data-ai-start]").first.click()
                page.wait_for_timeout(600)
                consent = page.locator("[data-ai-consent]")
                check(consent.count() == 1, "点生成先展开范围确认", f"计数 {consent.count()}")
                if consent.count() == 1:
                    text = consent.first.inner_text()
                    check("会发送" in text and "不会发送" in text, "确认区列出「会发送 / 不会发送」")
                    check("用户名、昵称、任何登录信息" in text, "明确列出不发送登录信息")
                    submit_btn = page.locator("[data-ai-submit]")
                    check(submit_btn.first.is_disabled(), "未勾选同意时不能提交")
                    capture(page, "390x844-ai-consent.png")
                    page.locator("input[name='ai-consent']").check()
                    page.wait_for_timeout(300)
                    check(not submit_btn.first.is_disabled(), "勾选后可以提交")

                    before = len(ai_requests)
                    submit_btn.first.click()
                    # 结果/进行中二者出现其一即可（mock 很快，可能直接到结果）
                    page.wait_for_function(
                        """() => document.querySelector('[data-ai-result], [data-ai-running], [data-ai-failed]') !== null""",
                        timeout=AI_WAIT_MS,
                    )
                    page.wait_for_timeout(400)
                    running_visible = page.locator("[data-ai-running]").count()
                    if running_visible:
                        running_text = page.locator("[data-ai-running]").first.inner_text()
                        check(
                            "%" not in running_text,
                            "进行中状态不编造百分比进度",
                            f"文案里出现了 %：{running_text[:60]!r}",
                        )
                        check(
                            "正在生成" in running_text,
                            "进行中状态如实说「正在生成」",
                            f"{running_text[:60]!r}",
                        )
                        capture(page, "390x844-ai-running.png")

                    page.wait_for_selector("[data-ai-result], [data-ai-failed]", timeout=AI_WAIT_MS)
                    if page.locator("[data-ai-result]").count() == 1:
                        check(True, "AI 生成成功并渲染结果")
                        check(
                            page.locator("[data-ai-summary]").count() == 1,
                            "结果有一段「整体印象」作为阅读入口",
                            f"计数 {page.locator('[data-ai-summary]').count()}",
                        )
                        check(
                            page.locator("[data-ai-section]").count() >= 1,
                            "结果按主题分节",
                            f"计数 {page.locator('[data-ai-section]').count()}",
                        )
                        check(
                            page.locator("[data-ai-actions]").count() == 1,
                            "结果包含「可以试试的具体做法」",
                        )
                        check(
                            page.locator("[data-ai-questions]").count() == 1,
                            "结果包含「可以问问自己」",
                        )
                        check(
                            page.locator("[data-ai-boundaries]").count() == 1,
                            "结果包含「这段分析的边界」",
                        )
                        check(
                            page.locator("[data-ai-result-problems]").count() == 0,
                            "mock 输出没有解析丢字段",
                            "出现了 resultProblems",
                        )
                        # 目标书里的硬规矩：AI 不许编造 潜力值 / 匹配率 / 置信度 / 排名 这类量化结论。
                        # 这条只在**模型输出区**上查 —— 页面别处的免责声明本来就要提到这些词
                        # （例如报告页那句"不是概率、不是准确率"），一律禁词会误伤正经文案。
                        ai_text = page.locator("[data-ai-result]").first.inner_text()
                        invented = [
                            word
                            for word in ("潜力值", "匹配率", "置信度", "排名", "准确率", "相似度")
                            if word in ai_text
                        ]
                        check(
                            not invented,
                            "AI 结果里没有编造出来的量化指标（潜力值/匹配率/置信度/排名…）",
                            f"出现了 {invented}",
                        )
                        if probe["mock"]:
                            check(
                                page.locator("[data-ai-mock]").count() == 1,
                                "演示数据被显著标注",
                                "mock=true 但页面没有 [data-ai-mock]",
                            )
                        else:
                            check(
                                page.locator("[data-ai-mock]").count() == 0,
                                "真实模式下不出现「演示数据」标注",
                            )
                        # 结果区的对比度单独量一次（深色面板里嵌白纸）
                        audit_viewport(page, "390x844", "ai-result")
                        capture(page, "390x844-ai-result.png")
                        notes.append(
                            f"提交后 AI 相关请求 {len(ai_requests) - before} 次（含创建与轮询）"
                        )
                    else:
                        failed_text = page.locator("[data-ai-failed]").first.inner_text()
                        check(False, "AI 生成成功并渲染结果", f"落到了失败态：{failed_text[:60]!r}")

                    # 轮询必须停：结果出来后静置 6s，不应再有新的 /api/v3/ai/ 请求
                    settled = len(ai_requests)
                    page.wait_for_timeout(6000)
                    check(
                        len(ai_requests) == settled,
                        "结果出来后停止轮询（静置 6s 无新请求）",
                        f"又发了 {len(ai_requests) - settled} 次",
                    )

                    # 换页后也不能留轮询
                    before_leave = len(ai_requests)
                    go(page, "/reports", settle=800)
                    page.wait_for_timeout(6000)
                    check(
                        len(ai_requests) == before_leave,
                        "离开报告页后不残留轮询",
                        f"离开后又发了 {len(ai_requests) - before_leave} 次",
                    )
            elif not probe["enabled"]:
                skip("AI 未开启：跳过生成流程走查")
            capture(page, "390x844-reports-after-ai.png")

            # ── 6b. AI 的另外三种状态：额度用尽 / 失败 / 输出读不出来 ──────
            # 这三种在真实后端上造不出来（要真把额度用完、真让上游失败、真让模型吐坏结构），
            # 所以这里用**路由 mock**：响应是造的，**渲染是真的**。
            # 结论只能算"这三种设计的渲染与可读性没问题"，**不算端到端证据**。
            print("\n[6b] AI 其余状态（路由 mock：额度用尽 / 失败 / 输出读不出来）")
            status_ok = {
                "enabled": True,
                "mock": False,
                "model": "verify-status-probe",
                "dailyLimitPerUser": 3,
                "remainingToday": 3,
                "apiKeySource": "env",
                "promptVersion": "typeme-ai-prompt-v2",
            }
            failed_job = {
                "jobId": "mock-failed-job",
                "reportId": report_id,
                "status": "FAILED",
                "topic": "overall",
                "promptVersion": "typeme-ai-prompt-v2",
                "modelRequested": "verify-status-probe",
                "modelReturned": None,
                "errorCode": "UPSTREAM_TIMEOUT",
                "attemptCount": 1,
                "createdAt": None,
                "finishedAt": None,
                "result": None,
                "resultProblems": [],
                "mock": False,
            }
            broken_job = dict(failed_job, jobId="mock-broken-job", status="SUCCEEDED", errorCode=None,
                              # 状态说成功、结构却读不出来 —— 这一支是"宁可说读不出来，也不编内容"
                              result={"schemaVersion": "unknown-version"})
            scenarios = [
                {
                    "label": "额度用尽",
                    "status": dict(status_ok, remainingToday=0, dailyLimitPerUser=1),
                    "jobs": [],
                    "expect": "[data-ai-quota-empty]",
                    "shot": "390x844-ai-quota-empty.png",
                },
                {
                    "label": "任务失败",
                    "status": status_ok,
                    "jobs": [failed_job],
                    "expect": "[data-ai-failed]",
                    "shot": "390x844-ai-failed.png",
                },
                {
                    "label": "输出读不出来",
                    "status": status_ok,
                    "jobs": [broken_job],
                    "expect": "[data-ai-result-problems]",
                    "shot": "390x844-ai-result-problems.png",
                },
            ]

            for scenario in scenarios:
                # 必须用 `page.context.new_page()`：`browser.new_page()` 会开一个**新的**上下文，
                # 也就没有登录 cookie，`/reports/{id}` 的路由守卫会直接把页面送去登录页
                # （第一版就是这样，三条全红、页面上写着"登录状态已经失效"）。
                mock_page = page.context.new_page()
                mock_page.set_default_timeout(20000)
                mock_page.set_viewport_size(VIEWPORTS["390x844"])
                state = {"status": scenario["status"], "jobs": scenario["jobs"]}

                # Playwright 的路由回调是 `handler(route, request)` **两个**位置参数 ——
                # 写成 `handler(route, state=state)` 会让第二个参数收到 Request 对象，
                # 然后在 `state['status']` 上炸出 "Request object is not subscriptable"。
                def make_handler(snapshot: dict):
                    def handler(route, _request):
                        url = route.request.url
                        if url.endswith("/api/v3/ai/status"):
                            route.fulfill(
                                status=200,
                                content_type="application/json",
                                body=json.dumps(snapshot["status"]),
                            )
                        elif url.endswith("/analyses") and "/api/v3/reports/" in url:
                            route.fulfill(
                                status=200,
                                content_type="application/json",
                                body=json.dumps({"items": snapshot["jobs"]}),
                            )
                        elif "/api/v3/ai/analyses/" in url:
                            route.fulfill(
                                status=200,
                                content_type="application/json",
                                body=json.dumps(snapshot["jobs"][0] if snapshot["jobs"] else {}),
                            )
                        else:
                            route.continue_()

                    return handler

                mock_page.route("**/api/v3/**", make_handler(state))
                mock_page.goto(f"{BASE}/#/reports/{report_id}", wait_until="domcontentloaded")
                mock_page.wait_for_timeout(2500)
                present = mock_page.locator(scenario["expect"]).count() == 1
                check(
                    present,
                    f"AI「{scenario['label']}」在真实浏览器里渲染出对应状态",
                    f"没找到 {scenario['expect']}；页面文字 {mock_page.locator('main').inner_text()[:120]!r}",
                )
                if present:
                    audit_viewport(mock_page, "390x844", f"ai-{scenario['label']}")
                    if scenario["label"] == "任务失败":
                        retry = mock_page.locator("[data-ai-retry]")
                        check(retry.count() == 1, "失败态给出「重试」入口", f"计数 {retry.count()}")
                        if retry.count() == 1:
                            box = retry.first.bounding_box() or {}
                            check(
                                box.get("height", 0) >= 44,
                                "失败态的「重试」按钮 ≥44 高（手机上点得到）",
                                f"实际 {box.get('height')}",
                            )
                    if scenario["label"] == "输出读不出来":
                        text = mock_page.locator("[data-ai-result-problems]").first.inner_text()
                        check(
                            "解析" in text or "读不出" in text,
                            "读不出结构时如实说明，而不是编一段内容",
                            f"{text[:60]!r}",
                        )
                    if scenario["label"] == "额度用尽":
                        start = mock_page.locator("[data-ai-start]")
                        check(
                            start.count() == 1 and start.first.is_disabled(),
                            "额度用尽时生成按钮不可点",
                            f"计数 {start.count()}，disabled={start.first.is_disabled() if start.count() else None}",
                        )
                    mock_page.screenshot(path=str(OUT / scenario["shot"]))
                mock_page.close()

            # ── 7. 首屏资源与动画开销 ────────────────────────────────────
            print("\n[7] 首屏资源与动画开销")
            external: list[str] = []
            page2 = browser.new_page(viewport=VIEWPORTS["390x844"])
            page2.on(
                "request",
                lambda req: external.append(req.url)
                if not req.url.startswith(BASE) and not req.url.startswith("data:")
                else None,
            )
            page2.goto(f"{BASE}/#/", wait_until="load")
            page2.wait_for_timeout(2500)
            check(
                not external,
                "首屏没有跨域请求（无远程字体 / CDN / 第三方脚本）",
                f"{len(external)} 个外部请求：{external[:3]}",
            )

            anim = page2.evaluate(
                """() => {
                    const out = [];
                    const vh = window.innerHeight;
                    for (const el of document.querySelectorAll('main *, header *, body > *')) {
                        const cs = getComputedStyle(el);
                        const before = getComputedStyle(el, '::before');
                        const names = [cs.animationName, before.animationName].filter((n) => n && n !== 'none');
                        if (names.length === 0) continue;
                        const r = el.getBoundingClientRect();
                        out.push({
                            names: names.join(','),
                            dur: cs.animationDuration,
                            inFirstScreen: r.top < vh && r.bottom > 0,
                        });
                    }
                    return out;
                }"""
            )
            first_screen_anim = [a for a in anim if a["inFirstScreen"]]
            longest = max((max_animation_seconds(a["dur"]) for a in anim), default=0.0)
            notes.append(
                f"首页动画元素 {len(anim)} 个（首屏内 {len(first_screen_anim)} 个），最长动画 {longest:.1f}s"
            )
            check(
                len(first_screen_anim) <= 8,
                "首屏内动画元素不超过 8 个（不堆动效）",
                f"首屏内 {len(first_screen_anim)} 个：{[a['names'] for a in first_screen_anim][:6]}",
            )
            check(
                longest <= 25,
                "没有超长循环动画（最长 ≤25s，且都是背景缓慢漂移一类的低频动效）",
                f"最长 {longest:.1f}s：{[a['names'] for a in anim if max_animation_seconds(a['dur']) == longest][:3]}",
            )
            # 动画只允许出现在 transform / opacity 上（不触发 layout），这里抽查声明本身
            layout_animated = page2.evaluate(
                """() => {
                    const bad = [];
                    for (const sheet of document.styleSheets) {
                        let rules;
                        try { rules = sheet.cssRules; } catch (e) { continue; }
                        for (const rule of rules) {
                            if (rule.type !== CSSRule.KEYFRAMES_RULE) continue;
                            for (const kf of rule.cssRules) {
                                const style = kf.style;
                                for (const prop of style) {
                                    if (['width', 'height', 'top', 'left', 'right', 'bottom', 'margin', 'padding'].includes(prop)) {
                                        bad.push(rule.name + ':' + prop);
                                    }
                                }
                            }
                        }
                    }
                    return Array.from(new Set(bad)).slice(0, 5);
                }"""
            )
            check(
                not layout_animated,
                "关键帧只动 transform / opacity（不逐帧触发布局）",
                f"含布局属性的关键帧：{layout_animated}",
            )
            page2.close()

        finally:
            context.close()
            browser.close()

    return finish(username)


def finish(username: str) -> int:
    report = [
        "# 浏览器验收报告 —— 前端视觉重构与 AI 体验（2026-09-18 第 2 轮）",
        "",
        f"- 被验收地址：`{BASE}`" + (f"（{BASE_LABEL}）" if BASE_LABEL else ""),
        f"- 账号：`{username[:11]}…`（随机后缀；密码与恢复码不落盘、不入报告）",
        f"- 后端 AI：enabled={probe['enabled']} mock={probe['mock']}"
        + ("（**模拟适配器**，没有调用真实模型）" if probe["mock"] else ""),
        f"- PASS {passed[0]} / FAIL {len(failures)} / SKIP {len(skips)}",
        (
            ""
            if passed[0] > 0
            else "- ⚠️ **本轮一条都没跑成**（见下面的跳过项）。这份文件没有覆盖 `REPORT.md`，"
            "以免把上一次成功的证据冲掉。"
        ),
        "",
        "## 判据",
        "",
        "- 每个视口/页面：`scrollWidth - clientWidth ≤ 0`；",
        "- 文字对比度：普通字号 ≥4.5:1、大字号 ≥3.0:1（在渲染结果上量，取最近的不透明背景）；",
        "- 交互控件：≤390 宽要求 ≥44×44，≥768 宽按 WCAG 2.5.8 的 ≥24×24；",
        "- 200% 缩放：`zoom: 2` 与 720px 视口都不许横向滚动；",
        "- reduced-motion：所有 `animation-duration ≤ 0.01s`；",
        "- 键盘：第一个 Tab 是「跳到主要内容」且可见；每一站都有可见焦点环；",
        "- AI：生成前有结构预览、生成前必须显式确认发送范围、进行中不编百分比、结果五段齐全；",
        "- 结果出来与离开页面后各静置 6s：不允许出现新的 `/api/v3/ai/` 请求。",
        "",
        "## 失败项",
        "",
    ]
    report += [f"- {item}" for item in failures] or ["- 无"]
    report += ["", "## 跳过项", ""]
    report += [f"- {item}" for item in skips] or ["- 无"]
    report += ["", "## 实测记录", ""]
    report += [f"- {item}" for item in notes] or ["- 无"]
    report += [
        "",
        "## 截图",
        "",
        "本轮（重构后）：",
        "",
    ]
    report += [f"- `{p.name}`" for p in sorted(OUT.glob("*.png"))]
    report += [
        "",
        "重构前对照（上一轮同一批页面的截图，用于前后对比）：",
        "",
        "- `docs/optimization/verification/2026-09-17-layout/320x568-home.png`（首页）",
        "- `docs/optimization/verification/2026-09-17-flow/32-assess-320.png`（答题页）",
        "- `docs/optimization/verification/2026-09-17-flow/30-report-detail-390.png`（报告页）",
        "- `docs/optimization/verification/2026-09-17-ai/10-report-before-ai-390.png`（AI 生成前）",
        "- `docs/optimization/verification/2026-09-17-ai/10-ai-consent-390.png`（AI 范围确认）",
        "- `docs/optimization/verification/2026-09-17-ai/11-ai-result-390.png`（AI 结果）",
        "",
        "## 复现方式",
        "",
        "```powershell",
        "# 一次性内存库 + 模拟 AI（不碰任何既有库、不调用真实模型）",
        "cd backend",
        "$env:JAVA_HOME='D:\\develop\\jdk-21'",
        "$env:SPRING_DATASOURCE_URL='jdbc:h2:mem:typeme_visual;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1'",
        "$env:SPRING_DATASOURCE_DRIVER_CLASS_NAME='org.h2.Driver'",
        "$env:SERVER_PORT='8110'",
        "$env:TYPEME_AI_ENABLED='true'; $env:TYPEME_AI_MOCK_MODE='true'; $env:TYPEME_AI_API_KEY='verify-placeholder'",
        "$env:TYPEME_SETTINGS_SECRET='verify-settings-secret'",
        "mvn.cmd -q -o dependency:build-classpath '-Dmdep.outputFile=target/cp.txt' '-Dmdep.includeScope=test'",
        "$cp = Get-Content target/cp.txt -Raw",
        "& \"$env:JAVA_HOME\\bin\\java.exe\" -cp \"target\\classes;$cp\" com.typeme.TypeMeApplication",
        "",
        "cd ..\\frontend",
        "$env:VITE_DEV_API_TARGET='http://127.0.0.1:8110'",
        "npm.cmd run dev -- --host 127.0.0.1 --port 5175",
        "",
        "python scripts/browser-verify-visual-v2.py",
        "```",
        "",
    ]
    # 一条都没跑成时**不许覆盖**已有的 REPORT.md：本机注册限流是 1 小时 5 次，
    # 复跑本脚本真的会撞到，如果那样就把上一轮 137 条 PASS 的证据冲掉，等于自毁证据。
    report_path = OUT / ("REPORT.md" if passed[0] > 0 else "REPORT-not-run.md")
    report_path.write_text("\n".join(report), encoding="utf-8")
    (OUT / "result.json").write_text(
        json.dumps(
            {
                "base": BASE,
                "passed": passed[0],
                "failures": failures,
                "skips": skips,
                "notes": notes,
                "aiEnabled": probe["enabled"],
                "aiMock": probe["mock"],
                "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nPASS {passed[0]} / FAIL {len(failures)} / SKIP {len(skips)}")
    for item in failures:
        print(f"  FAIL {item}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
