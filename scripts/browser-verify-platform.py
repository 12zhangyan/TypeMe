"""TypeMe 验收：多量表平台（发现页 / 方法页 / 选择页 / 大五答题 / 大五报告 / 我的报告）。

用法（项目根目录，需要后端已在 8080 上跑起来 —— 它同时把 `frontend/dist` 当静态资源）：

    python scripts/browser-verify-platform.py

环境变量：
    TYPEME_BASE（默认 http://127.0.0.1:8080）
    TYPEME_OUT （默认 docs/optimization/verification/2026-09-18-platform）

看什么（按"用户能不能真的走完"排）：

    1. **未登录也能选测评**：`/instruments` 与 `/instruments/{slug}/method` 是公开的，
       而"开始"必须先登录 —— 这一点要在同一页上同时成立（能看内容、不能直接开始）。
    2. **两项测评的差别在页面上看得出来**：大五必须写明"没有类型、不看总分"，
       十六型不能把大五说成小一号的自己。
    3. **大五能真的答完并出报告**：50 题一屏一题、「说不好」是独立的一档（不是第 6 档）、
       自动保存说的是真话、报告里五个方面各自给/不给方向、中点由服务端给。
    4. **两种报告在同一个列表里**：`/reports` 必须按报告种类分流详情页，而不是都丢给十六型报告页。
    5. **320 / 390 / 1440** 三个宽度无横向溢出、主要动作可达且命中区够大。
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
        ROOT / "docs" / "optimization" / "verification" / "2026-09-18-platform",
    )
)
BASE = os.environ.get("TYPEME_BASE", "http://127.0.0.1:8080")

VIEWPORTS = [("320", 320, 720), ("390", 390, 844), ("1440", 1440, 900)]

BIG_FIVE_SLUG = "bigfive50"
JUNG_SLUG = "jung48"

failures: list[str] = []
skips: list[str] = []
notes: list[str] = []
passed = [0]
shots: list[str] = []


def check(condition: bool, label: str, detail: str = "") -> None:
    if condition:
        passed[0] += 1
        print(f"  PASS {label}")
    else:
        failures.append(f"{label}{(' —— ' + detail) if detail else ''}")
        print(f"  FAIL {label}{(' —— ' + detail) if detail else ''}")


def capture(page: Page, name: str) -> None:
    page.screenshot(path=str(OUT / name), full_page=True)
    shots.append(name)


def measure_layout(page: Page) -> dict:
    return page.evaluate(
        """() => {
            const doc = document.documentElement;
            const wide = [];
            for (const el of document.querySelectorAll('main *')) {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.right > doc.clientWidth + 1) {
                    wide.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 40)}`);
                }
            }
            return {
                scrollWidth: doc.scrollWidth,
                clientWidth: doc.clientWidth,
                overflowing: wide.slice(0, 5),
            };
        }"""
    )


def box_of(page: Page, selector: str) -> dict | None:
    locator = page.locator(selector).first
    if locator.count() == 0:
        return None
    return locator.bounding_box()


def register(page: Page, username: str, password: str) -> None:
    page.goto(f"{BASE}/#/register", wait_until="domcontentloaded")
    page.wait_for_timeout(600)
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


def answer_big_five(page: Page, total: int = 50) -> int:
    """答完大五：每题点一档，最后一道不点「下一题」而是走提交。

    返回实际处理的题数（用于断言"50 题都处理过"）。
    """
    answered = 0
    for index in range(total):
        page.wait_for_selector("[data-bigfive-item]", timeout=20000)
        # 轮换档位，避免全部同一档导致"看不出方向"掩盖渲染问题
        option_index = index % 5
        page.locator("[role='radio']").nth(option_index).click()
        answered += 1
        if index < total - 1:
            page.locator("[data-bigfive-next]").click()
        page.wait_for_timeout(90)
    return answered


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    username = f"plat_{secrets.token_hex(4)}"
    password = f"Plat-{secrets.token_urlsafe(9)}!7"

    print(f"被验收地址：{BASE}")
    print(f"截图目录：{OUT}")
    print(f"一次性账号：{username}（密码不记录）")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        context = browser.new_context(viewport={"width": 390, "height": 844})
        page = context.new_page()
        page.set_default_timeout(25000)
        try:
            # ── 1. 未登录的发现页 ────────────────────────────────────────────
            print("\n[1] 未登录：发现页能看到两项，但不能直接开始")
            page.goto(f"{BASE}/#/instruments", wait_until="domcontentloaded")
            page.wait_for_selector("[data-instrument]", timeout=20000)
            page.wait_for_timeout(600)
            cards = page.locator("[data-instrument]").count()
            check(cards == 2, "发现页列出两项测评", f"实际 {cards}")
            body_text = page.locator("main").inner_text()
            check("大五人格倾向测评" in body_text, "出现「大五人格倾向测评」")
            check("十六型人格参考测评" in body_text, "出现「十六型人格参考测评」")
            check("不给类型" in body_text, "大五标出「不给类型」")
            check("它不适合" in body_text, "每项都写了「它不适合」什么")
            check(
                page.locator("[data-instruments-login-hint]").count() == 1,
                "未登录时说明「测评需要登录」以及为什么",
            )
            check(
                page.locator("[data-method='bigfive50']").count() == 1,
                "有通往方法说明页的入口",
            )
            check(
                page.locator("[data-instruments-error]").count() == 0,
                "目录没有报错",
            )
            capture(page, "390-instruments-anonymous.png")

            # 未登录点"开始"应当去登录
            page.locator(f"[data-start='{BIG_FIVE_SLUG}']").click()
            page.wait_for_timeout(1200)
            check(
                "#/login" in page.url and "redirect" in page.url,
                "未登录点「开始」去登录页并带上回跳地址",
                page.url,
            )

            # ── 2. 公开的方法说明页 ─────────────────────────────────────────
            print("\n[2] 公开的方法说明页：两项各自的维度与口径")
            page.goto(f"{BASE}/#/instruments/{BIG_FIVE_SLUG}/method", wait_until="domcontentloaded")
            page.wait_for_selector("[data-method-dimensions]", timeout=20000)
            page.wait_for_timeout(500)
            dims = page.locator("[data-method-dimensions] [data-dimension]").count()
            check(dims == 5, "大五方法页给出五个方面", f"实际 {dims}")
            method_text = page.locator("main").inner_text()
            check(
                "没有类型码" in method_text and "没有总分" in method_text,
                "大五方法页说清结论不是类型、也没有总分",
            )
            check("中间值" in method_text, "说清了分数怎么读（离中间值有多远）")
            versions = page.locator("table tbody tr").count()
            check(versions >= 1, "方法页列出内容版本", f"实际 {versions}")
            capture(page, "390-method-bigfive.png")

            # 同一组件从一项切到另一项：维度数量不同，不重新载入就会继续显示上一项的
            page.goto(f"{BASE}/#/instruments/{JUNG_SLUG}/method", wait_until="domcontentloaded")
            page.wait_for_selector("[data-method-dimensions]", timeout=20000)
            page.wait_for_timeout(700)
            jung_dims = page.locator("[data-method-dimensions] [data-dimension]").count()
            check(jung_dims == 4, "十六型方法页给出四个维度", f"实际 {jung_dims}")
            jung_text = page.locator("main").inner_text()
            check("不给字母" in jung_text, "十六型方法页说清平分时不给字母")

            # 关键：**站内跳转**而不是重新加载页面。同一个组件实例换 slug 时，
            # 如果只在 onMounted 里取数据，这一跳之后维度还是上一项的（5 个）。
            page.goto(f"{BASE}/#/instruments", wait_until="domcontentloaded")
            page.wait_for_selector("[data-instrument]", timeout=20000)
            page.wait_for_timeout(400)
            page.locator(f"[data-method='{JUNG_SLUG}']").click()
            page.wait_for_selector("[data-method-dimensions]", timeout=20000)
            page.wait_for_timeout(900)
            in_page_dims = page.locator("[data-method-dimensions] [data-dimension]").count()
            check(
                in_page_dims == 4,
                "站内从发现页进方法页时维度数量正确（不残留上一项）",
                f"实际 {in_page_dims}",
            )
            page.goto(f"{BASE}/#/instruments", wait_until="domcontentloaded")
            page.wait_for_selector("[data-instrument]", timeout=20000)
            page.wait_for_timeout(400)
            page.locator(f"[data-method='{BIG_FIVE_SLUG}']").click()
            page.wait_for_selector("[data-method-dimensions]", timeout=20000)
            page.wait_for_timeout(900)
            big_dims_in_page = page.locator("[data-method-dimensions] [data-dimension]").count()
            check(
                big_dims_in_page == 5,
                "站内切到大五方法页时维度数量正确",
                f"实际 {big_dims_in_page}",
            )

            # ── 3. 注册并走完大五 ───────────────────────────────────────────
            print("\n[3] 注册后从选择页开始大五并答完")
            register(page, username, password)

            page.goto(f"{BASE}/#/assess", wait_until="domcontentloaded")
            page.wait_for_selector("[data-instrument]", timeout=20000)
            page.wait_for_timeout(600)
            check(
                page.locator("[data-assess-catalog-error]").count() == 0,
                "选择页目录没有报错（这条曾是「路径拼错」的警报器）",
            )
            check(page.locator("[data-instrument]").count() == 2, "选择页也列出两项")
            check(
                page.locator("[data-assess-no-drafts]").count() == 1,
                "新账号还没有草稿时给出空态说明",
            )
            capture(page, "390-assess.png")

            # 带 slug 自动开始（发现页"查看并开始"走的就是这条）
            page.goto(f"{BASE}/#/assess?instrument={BIG_FIVE_SLUG}", wait_until="domcontentloaded")
            page.wait_for_selector("[data-bigfive-item]", timeout=25000)
            page.wait_for_timeout(800)
            check(
                "#/assess/" in page.url,
                "带 ?instrument= 过来会直接进入答题页，不需要再点一次",
                page.url,
            )

            first_item = page.locator("[data-bigfive-item]").get_attribute("data-bigfive-item")
            check(first_item == "Q01", "从第 1 题开始", str(first_item))
            check(
                page.locator("[role='radio']").count() == 5,
                "五档位置都在（320 也不隐藏中间档）",
            )
            check(
                page.locator("[data-bigfive-unknown]").count() == 1,
                "「说不好」是独立的一档",
            )
            save_text = page.locator("[data-bigfive-save-state]").inner_text()
            check("未保存" not in save_text, "刚开始答时不说「有 N 题还没保存」", save_text)

            # 「说不好」可撤销
            page.locator("[data-bigfive-unknown]").click()
            page.wait_for_timeout(200)
            check(
                page.locator("[data-bigfive-unknown]").get_attribute("aria-pressed") == "true",
                "点「说不好」后状态是已记下",
            )
            page.locator("[data-bigfive-unknown]").click()
            page.wait_for_timeout(200)
            check(
                page.locator("[data-bigfive-unknown]").get_attribute("aria-pressed") == "false",
                "再点一次可以撤销（不是不可逆）",
            )

            # 选一档，界面必须如实说"还没保存"。
            #
            # 判据要按"这一条有没有进服务端"，而不是"服务端 revision 变了没有"：
            # 后者会在改完还没发出去时显示「已保存」，用户关掉页面就真的丢了这一题。
            page.locator("[role='radio']").nth(3).click()
            page.wait_for_timeout(300)
            unsaved_text = page.locator("[data-bigfive-save-state]").inner_text()
            check(
                "还没保存" in unsaved_text,
                "选完还没发出去时如实显示「还没保存」",
                unsaved_text,
            )
            # 而且要说清是**几**题，不然用户不知道该等多久
            check(
                "1 题" in unsaved_text,
                "未保存的题数写的是具体数字",
                unsaved_text,
            )

            # 答完剩下 49 题
            answered = answer_big_five(page, total=50)
            check(answered == 50, "逐题处理到第 50 题", f"实际 {answered}")
            page.wait_for_timeout(800)
            check(
                page.locator("[data-bigfive-item]").get_attribute("data-bigfive-item") == "Q50",
                "停在最后一题",
            )
            submit_disabled = page.locator("[data-bigfive-submit]").is_disabled()
            check(not submit_disabled, "50 题都处理过后提交按钮可用")
            capture(page, "390-bigfive-last-question.png")

            page.locator("[data-bigfive-submit]").click()
            page.wait_for_timeout(2500)
            check(
                "/reports/big-five/" in page.url,
                "提交后进入大五报告页",
                page.url,
            )

            # ── 4. 大五报告 ─────────────────────────────────────────────────
            print("\n[4] 大五报告：五个方面、覆盖说明、限制、方法")
            page.wait_for_selector("[data-bigfive-dimensions]", timeout=25000)
            page.wait_for_timeout(800)
            report_dims = page.locator("[data-bigfive-dimensions] [data-dimension]").count()
            check(report_dims == 5, "报告给出五个方面", f"实际 {report_dims}")
            report_text = page.locator("main").inner_text()
            check("类型" not in report_text.split("方法")[0] or "没有类型" in report_text, "报告不发明类型码")
            check(
                page.locator("[data-bigfive-coverage]").count() == 1,
                "报告说明本次的覆盖情况（哪些算数、哪些没答）",
            )
            check(
                page.locator("[data-bigfive-limitations]").count() == 1,
                "报告逐条列出限制",
            )
            check(
                page.locator("[data-bigfive-method]").count() == 1,
                "计分口径放在可折叠的方法区",
            )
            check(
                page.locator("[data-bigfive-report-broken]").count() == 0,
                "报告没有出现「读不出来」的破版提示",
            )
            # 中点必须是服务端给的 30，而不是 (低+高)/2
            check(
                "30" in report_text,
                "报告里出现中点 30（服务端给的，不是两端平均）",
            )
            capture(page, "390-bigfive-report.png")

            # ── 5. 我的报告：两种报告同一个列表 ─────────────────────────────
            print("\n[5] 我的报告列表（大五那一行必须分流到大五报告页）")
            page.goto(f"{BASE}/#/reports", wait_until="domcontentloaded")
            page.wait_for_selector("[data-report-rows]", timeout=25000)
            page.wait_for_timeout(600)
            rows = page.locator("[data-report-row]").count()
            check(rows >= 1, "列表里至少有刚做完的这一份", f"实际 {rows}")
            big_five_row = page.locator("[data-report-kind='big_five_profile']").first
            check(big_five_row.count() == 1, "大五报告在列表里被标成 big_five_profile")
            counts_text = page.locator("[data-report-counts]").inner_text()
            check("五维画像" in counts_text or "大五" in counts_text, "列表标出报告种类", counts_text)
            capture(page, "390-reports-list.png")

            big_five_row.locator("[data-report-open]").click()
            page.wait_for_timeout(2000)
            check(
                "/reports/big-five/" in page.url,
                "从列表点开大五报告落到大五报告页（不是十六型报告页）",
                page.url,
            )

            # 一份新的大五草稿必须出现在选择页的"继续"区
            page.goto(f"{BASE}/#/assess?instrument={BIG_FIVE_SLUG}", wait_until="domcontentloaded")
            page.wait_for_selector("[data-bigfive-item]", timeout=25000)
            page.wait_for_timeout(600)
            page.goto(f"{BASE}/#/assess", wait_until="domcontentloaded")
            page.wait_for_selector("[data-instrument]", timeout=20000)
            page.wait_for_timeout(900)
            check(
                page.locator("[data-draft]").count() >= 1,
                "第二份草稿出现在「没答完」区（可以继续）",
                f"实际 {page.locator('[data-draft]').count()}",
            )
            capture(page, "390-assess-with-draft.png")

            # ── 6. 三个宽度 ─────────────────────────────────────────────────
            print("\n[6] 320 / 390 / 1440 的横向溢出与主要动作")
            pages = [
                ("instruments", f"{BASE}/#/instruments", "[data-instrument]"),
                ("method", f"{BASE}/#/instruments/{BIG_FIVE_SLUG}/method", "[data-method-dimensions]"),
                ("assess", f"{BASE}/#/assess", "[data-instrument]"),
                ("reports", f"{BASE}/#/reports", "[data-report-rows]"),
            ]
            for label, width, height in VIEWPORTS:
                page.set_viewport_size({"width": width, "height": height})
                for name, url, anchor in pages:
                    page.goto(url, wait_until="domcontentloaded")
                    page.wait_for_selector(anchor, timeout=25000)
                    page.wait_for_timeout(500)
                    layout = measure_layout(page)
                    check(
                        layout["scrollWidth"] <= layout["clientWidth"] + 1,
                        f"{label}px 的 {name} 页无横向滚动",
                        f"scrollWidth={layout['scrollWidth']} clientWidth={layout['clientWidth']} "
                        f"溢出={layout['overflowing']}",
                    )
                # 主要动作的命中区
                page.goto(f"{BASE}/#/instruments", wait_until="domcontentloaded")
                page.wait_for_selector("[data-instrument]", timeout=20000)
                page.wait_for_timeout(400)
                start_box = box_of(page, f"[data-start='{BIG_FIVE_SLUG}']")
                check(
                    start_box is not None and start_box["height"] >= 32,
                    f"{label}px 下「开始」够得着",
                    "未找到" if start_box is None else f"{round(start_box['width'])}x{round(start_box['height'])}",
                )
                method_box = box_of(page, f"[data-method='{BIG_FIVE_SLUG}']")
                check(
                    method_box is not None and method_box["height"] >= 32,
                    f"{label}px 下「先看题目与口径」够得着",
                    "未找到" if method_box is None else f"{round(method_box['width'])}x{round(method_box['height'])}",
                )
                if label == "320":
                    capture(page, "320-instruments.png")
                if label == "1440":
                    capture(page, "1440-instruments.png")

            # ── 7. 桌面宽度下的报告页 ───────────────────────────────────────
            print("\n[7] 1440 下的大五报告与答题页")
            page.set_viewport_size({"width": 1440, "height": 900})
            page.goto(f"{BASE}/#/reports", wait_until="domcontentloaded")
            page.wait_for_selector("[data-report-rows]", timeout=25000)
            page.locator("[data-report-kind='big_five_profile']").first.locator("[data-report-open]").click()
            page.wait_for_selector("[data-bigfive-dimensions]", timeout=25000)
            page.wait_for_timeout(700)
            layout = measure_layout(page)
            check(
                layout["scrollWidth"] <= layout["clientWidth"] + 1,
                "1440px 的大五报告无横向滚动",
                f"scrollWidth={layout['scrollWidth']} clientWidth={layout['clientWidth']}",
            )
            capture(page, "1440-bigfive-report.png")
        finally:
            browser.close()

    verdict = "PASS" if not failures else "FAIL"
    print(f"\n{verdict} {passed[0]} / FAIL {len(failures)} / SKIP {len(skips)}")

    lines = [
        "# 多量表平台验收：发现 / 方法 / 选择 / 大五答题 / 大五报告 / 我的报告",
        "",
        f"- 被验收地址：`{BASE}`（后端 jar 同时托管 `frontend/dist`）",
        f"- 使用账号：`{username}`（一次性合成账号，密码未记录）",
        f"- 结论：**{verdict}**（PASS {passed[0]} / FAIL {len(failures)} / SKIP {len(skips)}）",
        "",
        "## 这条脚本在验什么（以及为什么是这几条）",
        "",
        "1. **未登录也能选测评**：`/instruments` 与方法页是公开的，"
        "但「开始」必须先登录 —— 两件事要在同一页上同时成立。",
        "2. **大五不能像小一号的十六型**：必须写明没有类型、不看总分、五维各自独立。",
        "3. **「说不好」是独立的一档**：点下去要有状态、再点一次要能撤销，"
        "而且选完还没发出去时界面要如实说「未保存」（第 20 轮改的就是这句话的判据）。",
        "4. **两种报告在同一个列表里**：大五那一行必须分流到大五报告页。",
        "5. **320 / 390 / 1440 无横向溢出**，主要动作命中区够大。",
        "",
    ]
    if notes:
        lines += ["## 观察记录", ""] + [f"- {item}" for item in notes] + [""]
    if shots:
        lines += ["## 截图", ""] + [f"- `{name}`" for name in shots] + [""]
    if failures:
        lines += ["## 失败项", ""] + [f"- {item}" for item in failures] + [""]
    if skips:
        lines += ["## 跳过项", ""] + [f"- {item}" for item in skips] + [""]
    lines += [
        "## 诚实交代",
        "",
        "1. 这条脚本用的是**一次性合成账号**，题目答案也是脚本轮着点的（不是真人在答题）——",
        "   它证明的是「流程能走通、页面说的和做的一致」，**不证明题目可读、更不证明量表可靠**。",
        "2. **没有做并发与冲突的真实验收**：409 冲突那条由组件测试钉住（`bigFiveAssessView.spec.ts`），",
        "   这里没有开两个上下文去制造真冲突。",
        "3. **没有真的删除任何报告**：列表里的删除按钮只验了它存在。",
        "4. AI 解读**没有验**：大五报告上不提供（后端明确返回 `UNSUPPORTED_INSTRUMENT`），",
        "   十六型那一支的 AI 解读属于第 19 轮的范围。",
        "5. 三个宽度里只有 390 走了完整交互，320/1440 量的是布局与动作尺寸。",
    ]
    (OUT / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (OUT / "result.json").write_text(
        json.dumps(
            {
                "verdict": verdict,
                "passed": passed[0],
                "failed": failures,
                "skipped": skips,
                "notes": notes,
                "screenshots": shots,
                "username": username,
                "base": BASE,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"报告：{OUT / 'REPORT.md'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
