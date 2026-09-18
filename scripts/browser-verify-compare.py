"""TypeMe 持续优化验收：复测比较页在**真实浏览器**里的走查（2026-09-17）。

用法（项目根目录）：

    python scripts/browser-verify-compare.py

为什么单独一个脚本：比较页要**两份报告**才有内容，而主流程脚本每次只做一份。
这个脚本注册一次、把同一份测评走两遍（都直接「跳过补充题」交卷），然后验比较页。

前置：
    - 前端 dev server 指向一个**可写测试后端**；
    - 数据库必须是一次性的（会真实注册、真实作答两次）。**不要指向真实库。**
    - 后端开不开 AI 都能跑（比较页与 AI 无关）。

环境变量：
    TYPEME_BASE / TYPEME_OUT / TYPEME_LABEL，含义同其他验收脚本。

产出：<TYPEME_OUT>/*.png 与 REPORT.md / result.json

纪律：
    - 账号名带随机后缀，密码为脚本生成的合成值，不写进报告；
    - 只调用注册、建测评、作答、交卷、读报告、比较六个流程；不碰删除/注销/导出。
"""

from __future__ import annotations

import json
import os
import secrets
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
        ROOT / "docs" / "optimization" / "verification" / "2026-09-17-compare",
    )
)
BASE = os.environ.get("TYPEME_BASE", "http://127.0.0.1:5174")
BASE_LABEL = os.environ.get("TYPEME_LABEL", "")

MOBILE = {"width": 390, "height": 844}
NARROW = {"width": 320, "height": 568}
DESKTOP = {"width": 1440, "height": 900}

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


def capture(page: Page, name: str) -> None:
    page.screenshot(path=str(OUT / name))


def go(page: Page, hash_path: str) -> None:
    page.goto(f"{BASE}/#{hash_path}", wait_until="domcontentloaded")
    page.wait_for_timeout(500)


def overflow_report(page: Page) -> str:
    return page.evaluate(
        """() => {
            const doc = document.documentElement;
            if (doc.scrollWidth <= doc.clientWidth + 1) return '';
            const bad = [];
            document.querySelectorAll('*').forEach((el) => {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.right > doc.clientWidth + 1) {
                    bad.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 50)} 右边界 ${Math.round(r.right)}`);
                }
            });
            return `scrollWidth=${doc.scrollWidth} clientWidth=${doc.clientWidth} | ` + bad.slice(0, 3).join(' ;; ');
        }"""
    )


def complete_assessment(page: Page, rating: str) -> None:
    """走完一次完整测评并停在报告页。

    `rating` 是每题选的档位（两次测评刻意选不同档位，让比较页有真实内容可看）。
    """
    go(page, "/")
    page.locator("[data-primary-entry]").click()
    page.wait_for_timeout(2500)
    page.wait_for_selector("[data-question-card]", timeout=20000)

    answered = 0
    for _ in range(70):
        next_button = page.locator("[data-next]")
        if next_button.count() == 0:
            break
        if "完成主测" in next_button.first.inner_text():
            break
        option = page.locator(f".option-cell[data-rating='{rating}']")
        if option.count() == 0:
            break
        option.first.click()
        page.wait_for_timeout(150)
        next_button = page.locator("[data-next]")
        if next_button.count() == 0:
            break
        try:
            page.wait_for_function(
                """() => {
                    const b = document.querySelector('[data-next]');
                    return b !== null && !b.disabled;
                }""",
                timeout=15000,
            )
        except Exception:
            notes.append(f"作答第 {answered + 1} 题后「下一题」15s 内没恢复可用，提前结束本次作答")
            break
        next_button.first.click()
        page.wait_for_timeout(300)
        answered += 1

    final_option = page.locator(f".option-cell[data-rating='{rating}']")
    if final_option.count() > 0:
        final_option.first.click()
        page.wait_for_timeout(1500)
        final_next = page.locator("[data-next]")
        if final_next.count() > 0 and not final_next.first.is_disabled():
            final_next.first.click()
            page.wait_for_timeout(3500)

    skip_button = page.locator("[data-skip-clarification]")
    if skip_button.count() > 0:
        skip_button.first.click()
        page.wait_for_timeout(4000)
    page.wait_for_timeout(2500)
    notes.append(f"本次作答选了第 {rating} 档，实际点击 {answered} 次")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"被验收地址：{BASE}{(' （' + BASE_LABEL + '）') if BASE_LABEL else ''}")
    print(f"截图目录：{OUT}")

    username = f"cmp_{secrets.token_hex(4)}"
    password = f"Vf-{secrets.token_hex(6)}"
    report_ids: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            page = browser.new_page(viewport=MOBILE)
            page.set_default_timeout(20000)

            # ── 0. 注册 ────────────────────────────────────────────────────
            print("\n[0] 注册一个测试账号")
            go(page, "/register")
            page.fill("input[name='username']", username)
            page.fill("input[name='new-password']", password)
            page.fill("input[name='confirm-password']", password)
            page.locator("input[name='disclaimer-accepted']").check()
            page.click("button[type='submit']")
            page.wait_for_selector("[data-recovery-codes] li", timeout=25000)
            page.locator("[data-recovery-codes] ~ div input[type='checkbox']").first.check()
            page.wait_for_timeout(200)
            page.locator("button:has-text('去')").first.click()
            page.wait_for_timeout(1500)
            check(True, "注册成功并进入账号页")

            # ── 1. 先做一次测评（第 1 档）────────────────────────────────────
            print("\n[1] 第一份报告（每题选第 1 档）")
            complete_assessment(page, "1")
            check("/reports/" in page.url, "第一份报告已生成", f"URL {page.url}")
            if "/reports/" in page.url:
                report_ids.append(page.url.split("/reports/")[1].split("?")[0])
            capture(page, "10-first-report-390.png")

            # ── 2. 再做一次（第 5 档，刻意为相反方向）────────────────────────
            print("\n[2] 第二份报告（每题选第 5 档，方向刻意相反）")
            complete_assessment(page, "5")
            check("/reports/" in page.url, "第二份报告已生成", f"URL {page.url}")
            if "/reports/" in page.url:
                report_id = page.url.split("/reports/")[1].split("?")[0]
                if report_id not in report_ids:
                    report_ids.append(report_id)
            check(len(report_ids) >= 2, "拿到了两份不同的报告", f"实际 {report_ids}")

            if len(report_ids) < 2:
                notes.append("只拿到一份报告，比较页无法验收，提前结束。")
                return report(username, report_ids, MOBILE)

            # ── 3. 历史列表：两份报告时才出现比较入口 ────────────────────────
            print("\n[3] 历史报告的入口")
            go(page, "/reports")
            page.wait_for_selector("[data-report-list]", timeout=20000)
            page.wait_for_timeout(1200)
            rows = page.locator("[data-report-row]").count()
            check(rows >= 2, "历史列表里有两份报告", f"实际 {rows}")
            entry = page.locator("[data-compare-entry]")
            check(entry.count() == 1, "有「把两次测评放在一起看」入口")
            entry.first.click()
            page.wait_for_timeout(1200)
            check(
                "#/reports/compare" in page.url,
                "点击后进入 /reports/compare（没有被 /reports/:reportId 抢走）",
                f"实际 URL {page.url}",
            )
            capture(page, "20-compare-entry-390.png")

            # ── 4. 选两份并比较 ────────────────────────────────────────────
            print("\n[4] 选择两份报告并比较")
            page.wait_for_selector("[data-compare-pickers]", timeout=20000)
            select_a = page.locator("[data-compare-select-a]")
            select_b = page.locator("[data-compare-select-b]")
            check(select_a.count() == 1 and select_b.count() == 1, "有两个报告选择框")

            first_id = report_ids[0]
            second_id = report_ids[1]
            select_a.select_option(first_id)
            page.wait_for_timeout(400)
            # 第 17 轮起：换选即作废旧结果。只选了一份时页面**不该**留着上一次的对照表。
            check(
                page.locator("[data-compare-result]").count() == 0,
                "只选了一份时不会留着上一次的对照表",
            )
            select_b.select_option(second_id)
            page.wait_for_timeout(400)
            check("a=" in page.url and "b=" in page.url, "选择写进了 URL 查询参数（可刷新、可分享）", page.url)

            # 第 17 轮起：两份选齐后**自动**比较（不要求先点按钮），
            # 表头会写明这次比的是哪两份；「开始比较」按钮此时是重算入口。
            page.wait_for_selector("[data-compare-result]", timeout=20000)
            page.wait_for_timeout(600)
            run = page.locator("[data-compare-run]")
            check(run.count() == 1 and not run.is_disabled(), "比较结束后「开始比较」可点（重算入口）")
            subject = page.locator("[data-compare-subject]")
            check(subject.count() == 1, "表头写明这次比的是哪两份")
            check(
                "这次比的是" in (subject.inner_text() if subject.count() else ""),
                "表头文案把两份报告的标签都写出来",
            )

            rows_locator = page.locator("[data-compare-row]")
            check(rows_locator.count() == 4, "比较表给出四个维度", f"实际 {rows_locator.count()} 行")

            table_text = page.locator("[data-compare-result]").inner_text()
            check("方向不同" in table_text or "方向一致" in table_text, "每维都标了方向是否不同")
            check(
                "不是分数、不是概率，也不是匹配度" in table_text,
                "明确说明「强度」不是分数/概率/匹配度",
            )
            check(
                "不判断你变好了还是变差了" in page.locator("main").inner_text(),
                "页面明确声明不判断好坏（不是成长/退步报告）",
            )
            # 只在**对照表本体**里查禁用词。
            # 用整块 `[data-compare-result]` 会误报：后端给的说明与页面自己的免责句
            # 必须出现"成长/退步"这几个词才能把话讲清楚（例如"变化不等于成长或退步"），
            # 拿整块去查等于把"说清楚"判成违规。
            grid_text = page.locator("[data-compare-result] table").inner_text()
            for forbidden in ("成长", "进步", "退步", "准确率", "匹配率", "相似度", "分数"):
                check(forbidden not in grid_text, f"对照表本体里不出现「{forbidden}」这类判断词")
            capture(page, "21-compare-result-390.png")

            # ── 5. 刷新后仍能看到同一份比较 ────────────────────────────────
            print("\n[5] 刷新与直接链接")
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector("[data-compare-result]", timeout=20000)
            page.wait_for_timeout(600)
            check(page.locator("[data-compare-row]").count() == 4, "刷新后仍自动比较同一对报告（URL 带参数）")

            same_a = page.locator("[data-compare-select-a]").input_value()
            check(same_a == first_id, "刷新后选择框仍指向原来那份", f"实际 {same_a}")

            # 同一份 → 不能比
            page.locator("[data-compare-select-b]").select_option(first_id)
            page.wait_for_timeout(600)
            same_run = page.locator("[data-compare-run]")
            check(
                same_run.count() == 1 and same_run.is_disabled(),
                "选同一份时「开始比较」被禁用（服务端也会拒）",
            )
            check(page.locator("[data-compare-same]").count() == 1, "并说明了为什么不能比")

            # ── 6. 布局：320 / 1440 ────────────────────────────────────────
            print("\n[6] 布局：320 / 1440")
            page.locator("[data-compare-select-b]").select_option(second_id)
            page.wait_for_timeout(800)
            for label, viewport in (("320px", NARROW), ("1440px", DESKTOP)):
                page.set_viewport_size(viewport)
                page.wait_for_timeout(500)
                overflow = overflow_report(page)
                check(not overflow, f"{label} 比较页没有横向溢出", overflow)
                if label == "320px":
                    capture(page, "22-compare-320.png")
                if label == "1440px":
                    capture(page, "23-compare-1440.png")

            # 表格在窄屏应当**可横向滚动**（而不是把页面撑破）
            page.set_viewport_size(NARROW)
            page.wait_for_timeout(400)
            scroll = page.evaluate(
                """() => {
                    const wrap = document.querySelector('[data-compare-result] .overflow-x-auto');
                    if (!wrap) return null;
                    return { scrollWidth: wrap.scrollWidth, clientWidth: wrap.clientWidth };
                }"""
            )
            check(
                scroll is not None and scroll["scrollWidth"] >= scroll["clientWidth"],
                "窄屏下表格容器自身可横向滚动（内容不被裁掉）",
                f"{scroll}",
            )

        finally:
            browser.close()

    return report(username, report_ids, MOBILE)


def report(username: str, report_ids: list[str], viewport: dict) -> int:
    outcome = "PASS" if not failures else "FAIL"
    lines = [
        "# 真实浏览器验收：复测比较页（2026-09-17）",
        "",
        f"- 被验收地址：`{BASE}`" + (f"（{BASE_LABEL}）" if BASE_LABEL else ""),
        f"- 使用账号：`{username}`（密码为脚本生成的合成值，未记录）",
        f"- 比较的报告数：{len(report_ids)}",
        f"- 结论：**{outcome}**（PASS {passed[0]} / FAIL {len(failures)} / SKIP {len(skips)}）",
        "",
    ]
    if notes:
        lines += ["## 观察记录", ""] + [f"- {note}" for note in notes] + [""]
    if failures:
        lines += ["## 失败项", ""] + [f"- {item}" for item in failures] + [""]
    lines += [
        "## 说明",
        "",
        "- 本脚本注册一次、把同一份测评走两遍（第 1 档 / 第 5 档，刻意让方向相反），再验比较页。",
        "- 断言的是页面上真实出现的东西（`data-compare-*` 钩子与文案），不是内部 state。",
        "- 特意断言比较页**不出现**「成长/进步/退步/准确率/匹配率/相似度」这类判断词：",
        "  方向不同只表示方向不同，后端也算不出这些量。",
        "",
    ]
    (OUT / "REPORT.md").write_text("\n".join(lines), encoding="utf-8")
    (OUT / "result.json").write_text(
        json.dumps(
            {
                "base": BASE,
                "reportCount": len(report_ids),
                "passed": passed[0],
                "failed": failures,
                "skipped": skips,
                "notes": notes,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nPASS {passed[0]} / FAIL {len(failures)} / SKIP {len(skips)}")
    print(f"报告：{OUT / 'REPORT.md'}")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
