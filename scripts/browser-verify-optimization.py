"""TypeMe 持续优化验收：顶栏导航与辅助文字可读性（2026-09-17 第 1–2 轮）。

用法（项目根目录）：

    python scripts/browser-verify-optimization.py

前置：
    - 前端 dev server 已起（`npm run dev`，默认 http://127.0.0.1:5173）；
    - 后端可选。首页与账号页在接口不可达时会退到新测自己的内置口径，
      但**答题与报告需要后端**；缺后端时本脚本会把这部分标为 SKIP 而不是 PASS。

环境变量：
    TYPEME_BASE   被验收地址（默认 http://127.0.0.1:5173）
    TYPEME_OUT    截图目录（默认 docs/optimization/verification/2026-09-17-round1）
    TYPEME_LABEL  写进报告的说明

产出：
    <TYPEME_OUT>/*.png 与 <TYPEME_OUT>/REPORT.md

本脚本只做**只读**检查：不注册账号、不提交答卷、不调用任何写接口。
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(
    os.environ.get(
        "TYPEME_OUT",
        ROOT / "docs" / "optimization" / "verification" / "2026-09-17-round1",
    )
)
BASE = os.environ.get("TYPEME_BASE", "http://127.0.0.1:5173")
BASE_LABEL = os.environ.get("TYPEME_LABEL", "")

WIDTHS = {
    "320": {"width": 320, "height": 568},
    "390": {"width": 390, "height": 844},
    "1440": {"width": 1440, "height": 900},
}

failures: list[str] = []
skips: list[str] = []
notes: list[str] = []
passed = [0]


def check(condition: bool, label: str, detail: str = "") -> None:
    if condition:
        passed[0] += 1
        print(f"  PASS {label}")
    else:
        failures.append(f"{label}{(' —— ' + detail) if detail else ''}")
        print(f"  FAIL {label}{(' —— ' + detail) if detail else ''}")


def skip(label: str, why: str) -> None:
    skips.append(f"{label} —— {why}")
    print(f"  SKIP {label} —— {why}")


def relative_luminance(rgb: tuple[float, float, float]) -> float:
    def channel(value: float) -> float:
        c = value / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (channel(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def parse_color(value: str) -> tuple[float, float, float]:
    inner = value[value.index("(") + 1 : value.index(")")]
    parts = [float(p) for p in inner.replace(",", " ").split()[:3]]
    return parts[0], parts[1], parts[2]


def contrast_ratio(foreground: str, background: str) -> float:
    a = relative_luminance(parse_color(foreground))
    b = relative_luminance(parse_color(background))
    hi, lo = (a, b) if a > b else (b, a)
    return (hi + 0.05) / (lo + 0.05)


def effective_background(page: Page, selector: str) -> str:
    """沿着祖先链找到第一个不透明底色；透明色会一路穿到 body。"""
    return page.eval_on_selector(
        selector,
        """(el) => {
          let node = el;
          while (node) {
            const bg = getComputedStyle(node).backgroundColor;
            const m = bg.match(/rgba?\\(([^)]+)\\)/);
            const parts = m ? m[1].split(',').map((s) => parseFloat(s.trim())) : [];
            const alpha = parts.length === 4 ? parts[3] : 1;
            if (parts.length >= 3 && alpha > 0.95) return bg;
            node = node.parentElement;
          }
          return 'rgb(255, 255, 255)';
        }""",
    )


def nav_links(page: Page, path: str) -> list[str]:
    return page.eval_on_selector_all(
        'header nav[aria-label="站点导航"] a',
        """(links, path) => links
          .filter((a) => new URL(a.href).hash.split('?')[0] === '#' + path)
          .map((a) => a.textContent.trim())""",
        path,
    )


def capture(page: Page, name: str) -> None:
    page.screenshot(path=str(OUT / name))


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"被验收地址：{BASE}{(' （' + BASE_LABEL + '）') if BASE_LABEL else ''}")
    print(f"截图目录：{OUT}")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            # ── A. 顶栏导航：重复入口与写反的文案 ─────────────────────────────
            print("\n[A] 顶栏导航（320 / 390 / 1440）")
            for label, viewport in WIDTHS.items():
                page = browser.new_page(viewport=viewport)
                page.goto(f"{BASE}/#/", wait_until="domcontentloaded")
                page.wait_for_timeout(800)

                assess = nav_links(page, "/assess")
                check(
                    len(assess) == 1,
                    f"{label}px 首页顶栏的「开始测评」入口恰好一个",
                    f"实际 {len(assess)} 个：{assess}",
                )
                about = nav_links(page, "/about")
                check(
                    about == ["关于"],
                    f"{label}px 首页顶栏的关于入口文案是「关于」",
                    f"实际 {about}",
                )

                header_box = page.eval_on_selector(
                    "header", "(el) => el.getBoundingClientRect().height"
                )
                notes.append(
                    f"{label}px 首屏（{viewport['height']}px 高）顶栏高 {header_box:.0f}px，"
                    f"占首屏 {header_box / viewport['height'] * 100:.1f}%"
                )

                capture(page, f"nav-{label}.png")
                page.close()

            # 关于页上的同一个入口
            page = browser.new_page(viewport=WIDTHS["390"])
            page.goto(f"{BASE}/#/about", wait_until="domcontentloaded")
            page.wait_for_timeout(800)
            about_on_about = nav_links(page, "/about")
            check(
                about_on_about == ["关于"],
                "390px 停在关于页时，导航项仍叫「关于」（不是「方法与隐私」）",
                f"实际 {about_on_about}",
            )
            capture(page, "nav-about-390.png")
            page.close()

            # ── B. 辅助文字对比度（用真实渲染出来的颜色算）──────────────────
            print("\n[B] 辅助文字与背景的对比度（真实渲染值）")
            page = browser.new_page(viewport=WIDTHS["390"])
            page.goto(f"{BASE}/#/", wait_until="domcontentloaded")
            page.wait_for_timeout(800)

            samples = page.eval_on_selector_all(
                ".fineprint, .caption, .section-kicker, .section-title",
                """(els) => els.map((el) => {
                  const style = getComputedStyle(el);
                  return {
                    text: el.textContent.trim().slice(0, 24),
                    color: style.color,
                    size: parseFloat(style.fontSize),
                    weight: style.fontWeight,
                  };
                })""",
            )
            check(len(samples) > 0, "首页能取到辅助文字样本", f"取到 {len(samples)} 条")

            worst = None
            for index, sample in enumerate(samples):
                selector = (
                    ".fineprint, .caption, .section-kicker, .section-title"
                )
                background = page.evaluate(
                    """([sel, idx]) => {
                      const el = document.querySelectorAll(sel)[idx];
                      let node = el;
                      while (node) {
                        const bg = getComputedStyle(node).backgroundColor;
                        const m = bg.match(/rgba?\\(([^)]+)\\)/);
                        const parts = m ? m[1].split(',').map((s) => parseFloat(s.trim())) : [];
                        const alpha = parts.length === 4 ? parts[3] : 1;
                        if (parts.length >= 3 && alpha > 0.95) return bg;
                        node = node.parentElement;
                      }
                      return 'rgb(255, 255, 255)';
                    }""",
                    [selector, index],
                )
                ratio = contrast_ratio(sample["color"], background)
                sample["background"] = background
                sample["ratio"] = round(ratio, 2)
                # 大字号门槛 3.0；普通字号 4.5（WCAG AA）
                big = sample["size"] >= 24 or (sample["size"] >= 18.66 and int(sample["weight"]) >= 700)
                sample["required"] = 3.0 if big else 4.5
                if worst is None or ratio < worst["ratio"]:
                    worst = sample

            assert worst is not None
            print(
                f"  最低一条：{worst['ratio']}:1 （要求 {worst['required']}:1）"
                f" {worst['size']:.0f}px 「{worst['text']}」"
                f" 前景 {worst['color']} / 背景 {worst['background']}"
            )
            check(
                all(s["ratio"] >= s["required"] for s in samples),
                "首页所有 .fineprint / .caption / .section-kicker / .section-title 达到 AA 门槛",
                "；".join(
                    f"{s['text']}（{s['ratio']}:1 < {s['required']}）"
                    for s in samples
                    if s["ratio"] < s["required"]
                ),
            )

            # 页脚（bg-paper-soft 底）上的小字——最容易不达标的一处
            page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(400)
            footer = page.eval_on_selector_all(
                "footer .fineprint",
                """(els) => els.map((el) => {
                  const style = getComputedStyle(el);
                  let node = el, bg = 'rgb(255,255,255)';
                  while (node) {
                    const value = getComputedStyle(node).backgroundColor;
                    const m = value.match(/rgba?\\(([^)]+)\\)/);
                    const parts = m ? m[1].split(',').map((s) => parseFloat(s.trim())) : [];
                    const alpha = parts.length === 4 ? parts[3] : 1;
                    if (parts.length >= 3 && alpha > 0.95) { bg = value; break; }
                    node = node.parentElement;
                  }
                  return { text: el.textContent.trim().slice(0, 24), color: style.color, background: bg };
                })""",
            )
            footer_failures = [
                item
                for item in footer
                if contrast_ratio(item["color"], item["background"]) < 4.5
            ]
            check(
                len(footer) > 0 and not footer_failures,
                "页脚（paper-soft 底）上的小字达到 AA",
                "；".join(
                    f"{i['text']}（{contrast_ratio(i['color'], i['background']):.2f}:1）"
                    for i in footer_failures
                ),
            )
            capture(page, "footer-390.png")

            # ── C. 窄屏横向溢出 ─────────────────────────────────────────────
            print("\n[C] 窄屏横向溢出与关键操作可达性")
            for label in ("320", "390"):
                overflow_page = browser.new_page(viewport=WIDTHS[label])
                overflow_page.goto(f"{BASE}/#/", wait_until="domcontentloaded")
                overflow_page.wait_for_timeout(800)
                overflow = overflow_page.evaluate(
                    "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
                )
                check(
                    overflow <= 0,
                    f"{label}px 首页没有横向滚动",
                    f"scrollWidth 比 clientWidth 多 {overflow}px",
                )
                overflow_page.close()

            page.close()

            # ── D. 新测主流程：需要后端，缺后端时明确 SKIP ─────────────────
            print("\n[D] 新测主流程（需要后端）")
            probe = browser.new_page(viewport=WIDTHS["390"])
            # 必须**先落到站点上**再 fetch：`browser.new_page()` 打开的是 `about:blank`，
            # 从那里发起的任何 fetch 都只会得到 "Failed to fetch"（跨源 / 无源），
            # 于是"后端在不在"永远被判成不在。原来那版探针就是先踩了这个坑，
            # 只是因为探错路径恰好也失败，才看起来像"正确地 SKIP"。
            probe.goto(f"{BASE}/", wait_until="domcontentloaded")
            # 就绪探测**必须**同时满足三件事，否则这条探测本身就是假的：
            #   1. 落在 Vite 真正代理的前缀上（`/api`）—— 原来探 `/actuator/health`，
            #      而 vite.config.ts 只代理 `/api`，请求落进 SPA 回退拿到 index.html + 200，
            #      后端在不在都"通过"，真坏掉时也不 SKIP；
            #   2. **无需登录**就能拿到 JSON —— `/api/v3/ai/status` 未登录会返回 401，
            #      拿它当"后端在不在"会让每次都判成不在；
            #   3. 页面得先落到站点上再 fetch —— `about:blank` 上发起的 fetch 一律
            #      "Failed to fetch"，这一条原来也踩了。
            # `/api/v1/meta` 是旧内容接口的站点元信息：只读、匿名可访问、返回 JSON。
            health = probe.evaluate(
                """async () => {
                  try {
                    const res = await fetch('/api/v1/meta', {
                      credentials: 'include',
                      headers: { Accept: 'application/json' },
                    });
                    const text = await res.text();
                    // 只用于"能不能解析成 JSON"的判定，所以给足长度；
                    // 截断到 200 字符会让 JSON.parse 必然失败（试过：截断处正好在数组中间）。
                    return { status: res.status, body: text.slice(0, 4000), path: '/api/v1/meta' };
                  } catch (error) {
                    return { status: 0, body: String(error), path: '/api/v1/meta' };
                  }
                }"""
            )
            probe.close()
            # 200 + 能解析出 JSON 才算后端真的在（SPA 回退返回的是 HTML，会被这一步挡下）。
            try:
                parsed = json.loads(health["body"])
                backend_up = health["status"] == 200 and isinstance(parsed, dict)
            except Exception:
                backend_up = False
            if not backend_up:
                skip(
                    "新测答题 / 报告 / 账号的浏览器验收",
                    f"后端未就绪（{health['path']} → {health['status']}，响应片段 {health['body'][:80]!r}）",
                )
            else:
                notes.append(
                    f"后端就绪探测通过（{health['path']} → 200 JSON，contentVersion="
                    f"{parsed.get('contentVersion')!r}）；本轮主流程验收见 progress.md"
                )

        finally:
            browser.close()

    report = [
        "# 浏览器验收报告 —— 顶栏导航与辅助文字可读性（2026-09-17 第 1–2 轮）",
        "",
        f"- 被验收地址：`{BASE}`" + (f"（{BASE_LABEL}）" if BASE_LABEL else ""),
        "- 结论：**只读走查**，未注册账号、未提交答卷、未调用任何写接口。",
        f"- PASS {passed[0]} / FAIL {len(failures)} / SKIP {len(skips)}",
        "",
        "## 失败项",
        "",
    ]
    report += [f"- {item}" for item in failures] or ["- 无"]
    report += ["", "## 跳过项（未验证，不计入通过）", ""]
    report += [f"- {item}" for item in skips] or ["- 无"]
    report += ["", "## 实测数据", ""]
    report += [f"- {item}" for item in notes] or ["- 无"]
    report += ["", "## 截图", ""]
    report += [f"- `{p.name}`" for p in sorted(OUT.glob("*.png"))]
    report += [
        "",
        "## 复现方式",
        "",
        "```powershell",
        "cd frontend; npm.cmd run dev -- --host 127.0.0.1",
        "python scripts/browser-verify-optimization.py",
        "```",
        "",
    ]
    (OUT / "REPORT.md").write_text("\n".join(report), encoding="utf-8")
    (OUT / "result.json").write_text(
        json.dumps(
            {"passed": passed[0], "failures": failures, "skips": skips, "notes": notes},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"\nPASS {passed[0]} / FAIL {len(failures)} / SKIP {len(skips)}")
    print(f"报告：{OUT / 'REPORT.md'}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
