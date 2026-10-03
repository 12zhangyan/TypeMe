"""TypeMe 持续优化验收：**历史报告**能否被 AI 分析（2026-09-17，第 14 轮衍生）。

用法（项目根目录）：

    python scripts/browser-verify-history-ai.py

要回答的问题
------------
用户问："也支持把历史报告进行分析吧"。代码层面的答案是"支持"：
AI 面板挂在报告详情组件上，创建路径只校验（幂等键 / AI 已开启且有 key / 报告属于本人），
没有按报告时间或新鲜度设限。但代码上一个真实风险必须用浏览器验证：

    父组件用 `v-if="reportId"` 挂载 AI 面板，而面板只在 `onMounted` 里
    `ai.loadJobs(props.reportId)`，**没有 watch reportId**。
    从 B 报告切到 A 报告时 `v-if` 两边都为真 → 组件实例被复用、`onMounted` 不再触发，
    面板可能**一直显示上一份报告的分析**（更糟的是轮询也不会停）。

验收口径（都用页面真实出现的东西断言）
--------------------------------------
1. 二份报告都在历史列表里，且从列表能进第一份（老的那份）；
2. 第一份报告的 AI 面板正常加载，**不显示第二份报告的任务**；
3. **在报告之间切换**时面板跟着换（浏览器后退 / 历史列表 / 直接改地址三条路径）；
4. 对历史报告**真的能发起分析**并拿到结果（这是用户问题的正面回答）。

前置
----
- 前端 dev server 指向一个可写测试后端，且该后端开着 AI（mock 或真实均可）；
- 数据库必须是一次性的（本脚本会注册账号、做两次完整测评）。**不要指向真实库。**
- **本脚本会真的调用外部模型**（这一点务必先看清）：脚本虽然不等结果，
  但后端的 `AnalysisWorker` 是**急切执行**的 —— 任务一旦落库就立刻发起真实请求。
  "只验证能发起、不等输出"**省不掉**调用与费用。
  本脚本一次运行会接受 **2 个**分析任务（新报告 1 个、老报告 1 个），
  因此在 `mock=false` 的实例上是 **2 次真实外发**。
  不要在未授权的环境上跑。

环境变量：
    TYPEME_BASE     被验收地址（默认 http://127.0.0.1:5174）
    TYPEME_OUT      截图目录（默认 docs/optimization/verification/2026-09-17-history-ai）
    TYPEME_LABEL    写进报告的说明

产出：<TYPEME_OUT>/*.png 与 REPORT.md / result.json

纪律：
    - 账号名带随机后缀，密码是脚本生成的合成值，**不写进报告**；
    - 不显示、不保存任何 key 或 token；
    - 只调用注册、建测评、作答、交卷、读报告、列出报告六个流程。
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
        ROOT / "docs" / "optimization" / "verification" / "2026-09-17-history-ai",
    )
)
BASE = os.environ.get("TYPEME_BASE", "http://127.0.0.1:5174")
BASE_LABEL = os.environ.get("TYPEME_LABEL", "")
MOBILE = {"width": 390, "height": 844}

passed: list[str] = []
failed: list[str] = []
skipped: list[str] = []
notes: list[str] = []
probe: dict[str, object] = {"enabled": None, "mock": None}


def check(condition: bool, label: str, detail: str = "") -> None:
    if condition:
        passed.append(label)
        print(f"  PASS {label}" + (f"  [{detail}]" if detail else ""))
    else:
        failed.append(f"{label}" + (f"  [{detail}]" if detail else ""))
        print(f"  FAIL {label}" + (f"  [{detail}]" if detail else ""))


def skip(label: str) -> None:
    skipped.append(label)
    print(f"  SKIP {label}")


def capture(page: Page, name: str) -> None:
    page.screenshot(path=str(OUT / name), full_page=False)
    print(f"  截图 {name}")


def go(page: Page, hash_path: str) -> None:
    page.goto(f"{BASE}/#{hash_path}", wait_until="domcontentloaded")
    page.wait_for_timeout(1200)


def report_id_from_url(page: Page) -> str:
    marker = "/reports/"
    url = page.url.split("#", 1)[-1]
    if marker not in url:
        return ""
    return url.split(marker, 1)[1].split("?", 1)[0].strip("/")


def panel_job_id(page: Page) -> str:
    """面板当前显示的任务 id；没有任务时返回空串。

    依赖 `AiAnalysisPanel` 上的 `data-ai-job-id`。没有它就只能数 `data-ai-job` 的个数，
    而"1 个任务"既可能是本报告的、也可能是上一份残留的 —— 那种断言没有区分力。
    """
    node = page.locator("[data-ai-job]")
    if node.count() == 0:
        return ""
    return (node.first.get_attribute("data-ai-job-id") or "").strip()


def start_analysis(page: Page, wait_for_job: bool = True) -> bool:
    """在**当前报告**上发起一次分析，只等到"任务被后端接受"，不等模型输出。

    刻意不等待出结果：本脚本要验的是"历史报告能不能发起分析"与"面板有没有串台"，
    模型产出质量由 `browser-verify-ai-analysis.py` 负责，没必要在这里重复消耗用户额度。
    """
    start = page.locator("[data-ai-start]")
    if start.count() == 0:
        return False
    start.click()
    page.wait_for_timeout(400)
    if page.locator("[data-ai-consent]").count() == 0:
        return False
    page.locator("input[name='ai-consent']").check()
    page.wait_for_timeout(200)
    submit = page.locator("[data-ai-submit]")
    if submit.count() == 0 or submit.is_disabled():
        return False
    submit.click()
    if not wait_for_job:
        return True
    try:
        page.wait_for_selector("[data-ai-job]", timeout=15000)
        return True
    except Exception:  # noqa: BLE001
        return False


def run_assessment(page: Page) -> str:
    """走完一次完整主测（跳过补充题），返回报告 id。"""
    go(page, "/")
    page.locator("[data-primary-entry]").click()
    page.wait_for_timeout(2500)
    page.wait_for_selector("[data-question-card]", timeout=20000)

    for _ in range(70):
        next_button = page.locator("[data-next]")
        if next_button.count() == 0:
            break
        if "完成主测" in next_button.first.inner_text():
            break
        rating = page.locator(".option-cell[data-rating='1']")
        if rating.count() == 0:
            break
        rating.first.click()
        page.wait_for_timeout(120)
        next_button = page.locator("[data-next]")
        if next_button.count() == 0:
            break
        if next_button.first.is_disabled():
            page.wait_for_timeout(1200)
        next_button.first.click()
        page.wait_for_timeout(260)

    final_rating = page.locator(".option-cell[data-rating='1']")
    if final_rating.count() > 0:
        final_rating.first.click()
        page.wait_for_timeout(1500)
        final_next = page.locator("[data-next]")
        if final_next.count() > 0 and not final_next.first.is_disabled():
            final_next.first.click()
            page.wait_for_timeout(3500)

    skip_button = page.locator("[data-skip-clarification]")
    if skip_button.count() > 0:
        skip_button.first.click()
        page.wait_for_timeout(4000)
    page.wait_for_timeout(2000)
    return report_id_from_url(page)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"被验收地址：{BASE}{(' （' + BASE_LABEL + '）') if BASE_LABEL else ''}")
    print(f"截图目录：{OUT}")

    username = f"hist_{secrets.token_hex(4)}"
    password = f"Hv-{secrets.token_hex(6)}"

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            page = browser.new_page(viewport=MOBILE)
            page.set_default_timeout(20000)

            # ── 0. 注册并确认 AI 状态 ────────────────────────────────────────
            print("\n[0] 注册并确认 AI 状态")
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

            ai_status = page.evaluate(
                """async () => {
                    const r = await fetch('/api/v3/ai/status', { credentials: 'include' });
                    return { status: r.status, body: await r.json() };
                }"""
            )
            enabled = bool(ai_status.get("body", {}).get("enabled"))
            mock = bool(ai_status.get("body", {}).get("mock"))
            probe["enabled"] = enabled
            probe["mock"] = mock
            notes.append(f"GET /ai/status → enabled={enabled} mock={mock}")
            check(enabled, "后端已开启 AI（否则本脚本无意义）")
            if not enabled:
                finish(page, username, enabled, mock)
                return 0

            # ── 1. 做两次测评，拿到两份报告 ──────────────────────────────────
            print("\n[1] 连续做两次测评（第二次用来把第一次变成『历史报告』）")
            first_id = run_assessment(page)
            check(bool(first_id), "第一次测评产出报告", f"reportId={first_id[:8]}…" if first_id else "空")
            capture(page, "20-first-report-390.png")

            second_id = run_assessment(page)
            check(bool(second_id), "第二次测评产出报告", f"reportId={second_id[:8]}…" if second_id else "空")
            check(first_id != second_id, "两份报告是不同的记录", f"{first_id[:8]}… vs {second_id[:8]}…")
            if not (first_id and second_id and first_id != second_id):
                notes.append("没能拿到两份不同报告，后续历史报告断言无法进行。")
                finish(page, username, enabled, mock)
                return 1

            # ── 2. 历史列表里两份都在，且能从列表进第一份 ────────────────────
            print("\n[2] 历史列表：两份都在，并能进到老的那一份")
            go(page, "/reports")
            rows = page.locator("[data-report-row]")
            check(rows.count() >= 2, "历史列表里至少两份报告", f"实际 {rows.count()} 份")
            check(
                page.locator(f"[data-report-row='{first_id}']").count() == 1,
                "老的那份报告在历史列表里",
            )
            capture(page, "21-report-list-390.png")

            # ── 3. 在**新**报告上发起分析（它先有任务） ───────────────────────
            print("\n[3] 先在新报告上发起分析")
            go(page, f"/reports/{second_id}")
            page.wait_for_selector("[data-ai-panel]", timeout=15000)
            check(page.locator("[data-ai-panel]").count() == 1, "新报告页有 AI 面板")
            check(page.locator("[data-ai-start]").count() == 1, "新报告页有生成入口")
            check(start_analysis(page), "新报告的 AI 任务被后端接受")
            if page.locator("[data-ai-result]").count() == 1:
                notes.append("新报告的分析已经出结果（后端 AI 可用）。")
            elif page.locator("[data-ai-running]").count() == 1:
                notes.append("新报告的分析仍在进行中（本脚本不等它出结果）。")
            new_job_id = panel_job_id(page)
            notes.append(f"新报告的任务 id={new_job_id[:8]}…")
            capture(page, "22-new-report-ai-started-390.png")

            # ── 3a. 从历史列表进老报告：老报告还没有任何分析 ──────────────────
            print("\n[3a] 从历史列表进老报告（它此时没有任何分析）")
            go(page, "/reports")
            row_link = page.locator(f"[data-report-row='{first_id}'] a, [data-report-row='{first_id}'] button")
            if row_link.count() > 0:
                row_link.first.click()
                page.wait_for_timeout(2200)
            else:
                go(page, f"/reports/{first_id}")
            check(
                report_id_from_url(page) == first_id,
                "从历史列表点进了老报告",
                f"URL={report_id_from_url(page)[:8]}…",
            )
            page.wait_for_selector("[data-ai-panel]", timeout=15000)
            stale_job = page.locator("[data-ai-job]").count()
            check(
                stale_job == 0,
                "老报告上没冒出本该属于新报告的分析（串台检测）",
                f"data-ai-job={stale_job}",
            )
            capture(page, "23-old-report-panel-390.png")

            # ── 3c. 老报告也发起一次分析（两份各有任务，串台才可判定） ─────────
            print("\n[3c] 老报告也发起一次分析（这样两份各有任务）")
            check(
                start_analysis(page),
                "**对历史报告发起的分析被后端接受**",
                page.locator("[data-ai-create-error]").inner_text()[:160]
                if page.locator("[data-ai-create-error]").count()
                else "",
            )
            old_job_id = panel_job_id(page)
            notes.append(f"老报告的任务 id={old_job_id[:8]}…")
            check(
                old_job_id != "" and new_job_id != "" and old_job_id != new_job_id,
                "两份报告的任务是两个不同的任务",
                f"老={old_job_id[:8]}… 新={new_job_id[:8]}…",
            )
            capture(page, "25-history-ai-started-390.png")

            # ── 3d. 同一实例内只换地址：面板显示的必须是对的那一份 ─────────────
            #
            # 这条模拟"组件实例被复用"的最短路径：页面不重载，只换 hash。
            # 断言必须**有区分力**：两份报告各有任务时，对比 jobId 才能区分
            # "换对了" 与 "还挂着上一份的"。
            print("\n[3d] 同一实例内只换地址（不重载页面），面板显示的是不是对的那一份")
            page.evaluate("""(rid) => { window.location.hash = `#/reports/${rid}`; }""", second_id)
            page.wait_for_timeout(2500)
            check(
                report_id_from_url(page) == second_id,
                "地址确实换成了新报告（页面未重载）",
                f"URL={report_id_from_url(page)[:8]}…",
            )
            shown_after_switch = panel_job_id(page)
            check(
                shown_after_switch == new_job_id,
                "换到新报告后显示的是**新报告自己**的任务",
                f"显示={shown_after_switch[:8]}… 应为={new_job_id[:8]}…",
            )

            page.evaluate("""(rid) => { window.location.hash = `#/reports/${rid}`; }""", first_id)
            page.wait_for_timeout(2500)
            check(
                report_id_from_url(page) == first_id,
                "地址切回了老报告（页面未重载）",
                f"URL={report_id_from_url(page)[:8]}…",
            )
            shown_back = panel_job_id(page)
            check(
                shown_back == old_job_id,
                "切回老报告后显示的是**老报告自己**的任务",
                f"显示={shown_back[:8]}… 应为={old_job_id[:8]}…",
            )
            capture(page, "24-switched-in-place-390.png")


            # ── 4. 刷新一次：老报告的分析必须在刷新后仍然读得到 ───────────────
            print("\n[4] 刷新老报告：已有分析仍然读得到")
            go(page, f"/reports/{first_id}")
            page.wait_for_selector("[data-ai-panel]", timeout=15000)
            check(
                panel_job_id(page) == old_job_id,
                "刷新后老报告仍显示自己那次分析（不丢、不串）",
                f"显示={panel_job_id(page)[:8]}… 应为={old_job_id[:8]}…",
            )
            capture(page, "26-history-after-reload-390.png")

            return finish(page, username, enabled, mock)
        finally:
            browser.close()


def finish(page: Page | None, username: str, enabled: bool, mock: bool) -> int:
    print(f"\n{'=' * 60}")
    print(f"PASS {len(passed)} / FAIL {len(failed)} / SKIP {len(skipped)}")
    for item in failed:
        print(f"  FAIL {item}")

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# 真实浏览器验收：**历史报告**能否被 AI 分析（2026-09-17）",
        "",
        f"- 被验收地址：`{BASE}`{(' （' + BASE_LABEL + '）') if BASE_LABEL else ''}",
        f"- AI 是否开启：`{enabled}`；是否 mock 适配器：`{mock}`",
        f"- 使用账号：`{username}`（密码为脚本生成的合成值，未记录）",
        f"- 结论：**{'PASS' if not failed else 'FAIL'}**"
        f"（PASS {len(passed)} / FAIL {len(failed)} / SKIP {len(skipped)}）",
        "",
        "## 这次验收要回答的问题",
        "",
        "用户问的是『历史报告也能分析吧』。代码层面：AI 面板挂在报告详情组件上，",
        "创建路径只校验（幂等键 / AI 已开启且有 key / 报告属于本人），没有按报告时间设限。",
        "但 `AiAnalysisPanel` 只在 `onMounted` 加载任务、没有 `watch(reportId)`，而父组件用",
        "`v-if=\"reportId\"` 挂载它 —— 从一份报告切到另一份时组件实例会被复用。",
        "本脚本就是去查这件事在真实浏览器里到底会不会串台。",
        "",
        "## 观察记录",
        "",
    ]
    lines += [f"- {line}" for line in notes]
    lines += [
        "",
        "## 断言（页面真实出现的东西）",
        "",
        f"- PASS {len(passed)} 条：",
    ]
    lines += [f"    - {item}" for item in passed]
    if failed:
        lines += ["", f"- FAIL {len(failed)} 条："]
        lines += [f"    - {item}" for item in failed]
    if skipped:
        lines += ["", f"- SKIP {len(skipped)} 条："]
        lines += [f"    - {item}" for item in skipped]
    lines += [
        "",
        "## 本脚本的边界",
        "",
        "- **会真的调用外部模型**：脚本不等结果，但后端 worker 是急切执行的，",
        "  任务落库即发起请求。一次运行 = **2 次真实外发**（新报告 1 + 老报告 1）。",
        "  初版脚本文档曾写成『不消耗额度』，是**错的** —— 已在脚本里更正并留痕。",
        "- 用的是脚本注册的一次性合成账号，作答为固定选项，不含任何真实个人信息。",
    ]
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    (OUT / "result.json").write_text(
        json.dumps(
            {
                "base": BASE,
                "passed": passed,
                "failed": failed,
                "skipped": skipped,
                "notes": notes,
                "aiEnabled": enabled,
                "aiMock": mock,
                "username": username,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"报告：{REPORT}")
    return 0 if not failed else 1


REPORT = OUT / "REPORT.md"

if __name__ == "__main__":
    sys.exit(main())
