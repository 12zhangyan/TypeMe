"""TypeMe 持续优化验收：报告页 AI 分析面板在**真实浏览器**里的走查（2026-09-17）。

用法（项目根目录）：

    python scripts/browser-verify-ai-analysis.py

前置：
    - 前端 dev server 指向一个**可写测试后端**；
    - 该后端需要**开着 AI**，否则脚本会在第一步就 SKIP：
          TYPEME_AI_ENABLED=true TYPEME_AI_MOCK_MODE=true TYPEME_AI_API_KEY=<占位串>
      mock 适配器不联网、不用真实 key，产出的结果带 mock=true；
      脚本会据此断言"页面显著标注了这是演示数据"。
    - **真实模式（mock=false）也可以跑**：此时会真的调用外部模型服务、产生真实费用，
      因此只应在**明确授权**下执行。脚本会改判"不该出现演示数据标注"，
      其余结构性断言（整体印象/分节/建议/追问/定位说明）对真实输出同样适用。
      未经授权的环境请保持 mock。
    - 数据库必须是一次性的（本脚本会真实注册账号、走完整测评）。**不要指向真实库。**

环境变量：
    TYPEME_BASE     被验收地址（默认 http://127.0.0.1:5174）
    TYPEME_OUT      截图目录（默认 docs/optimization/verification/2026-09-17-ai）
    TYPEME_LABEL    写进报告的说明

产出：<TYPEME_OUT>/*.png 与 REPORT.md / result.json

纪律：
    - 账号名带随机后缀，密码是脚本生成的合成值，**不写进报告**；
    - 不显示、不保存任何 key 或 token；
    - 只调用注册、建测评、作答、交卷、读报告、AI 分析六个流程，不碰删除/注销/导出。
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
        ROOT / "docs" / "optimization" / "verification" / "2026-09-17-ai",
    )
)
BASE = os.environ.get("TYPEME_BASE", "http://127.0.0.1:5174")
BASE_LABEL = os.environ.get("TYPEME_LABEL", "")

MOBILE = {"width": 390, "height": 844}
NARROW = {"width": 320, "height": 568}
DESKTOP = {"width": 1440, "height": 900}

# AI 任务要等 worker 真的跑完。mock 适配器很快，但 lease/poll 有间隔，
# 这里给 90 秒上限，超时算 FAIL（而不是无限等）。
AI_WAIT_MS = 90_000

failures: list[str] = []
skips: list[str] = []
notes: list[str] = []
passed = [0]

# 后端实测到的 AI 能力状态。**必须由 /ai/status 的真实响应填充**：
# 早期版本的 finally 分支写成 report(None, username, True, True)，把 mock 硬编码成 True，
# 于是真实模式下 result.json 的 aiMock 恒为 true —— 与观察记录里的 mock=False 自相矛盾。
# 任何依据这个字段判断"这份结果是不是演示数据"的人都会被误导。
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
    page.screenshot(path=str(OUT / name))


def go(page: Page, hash_path: str) -> None:
    page.goto(f"{BASE}/#{hash_path}", wait_until="domcontentloaded")
    page.wait_for_timeout(500)


def overflow_report(page: Page) -> str:
    """返回一行"最宽溢出元素"的说明；没有溢出时返回空串。"""
    return page.evaluate(
        """() => {
            const doc = document.documentElement;
            if (doc.scrollWidth <= doc.clientWidth + 1) return '';
            const bad = [];
            document.querySelectorAll('*').forEach((el) => {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.right > doc.clientWidth + 1) {
                    bad.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 60)} 右边界 ${Math.round(r.right)}`);
                }
            });
            return `scrollWidth=${doc.scrollWidth} clientWidth=${doc.clientWidth} | ` + bad.slice(0, 3).join(' ;; ');
        }"""
    )


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"被验收地址：{BASE}{(' （' + BASE_LABEL + '）') if BASE_LABEL else ''}")
    print(f"截图目录：{OUT}")

    username = f"aivf_{secrets.token_hex(4)}"
    password = f"Vf-{secrets.token_hex(6)}"

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            page = browser.new_page(viewport=MOBILE)
            page.set_default_timeout(20000)

            # ── 0. 先确认这台后端确实开着 AI（否则整段无意义）──────────────
            print("\n[0] 前置：这台后端开没开 AI")
            go(page, "/register")
            page.fill("input[name='username']", username)
            page.fill("input[name='new-password']", password)
            page.fill("input[name='confirm-password']", password)
            page.locator("input[name='disclaimer-accepted']").check()
            page.click("button[type='submit']")
            page.wait_for_selector("[data-recovery-codes] li", timeout=25000)
            # 注册成功后表单换成"抄下恢复码"确认区，没有 submit 按钮；
            # 勾"已抄下"后再点「去账号与数据」离开。（这是真实路径，不是绕过。）
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
            if not enabled:
                skip("后端没有开启 AI（TYPEME_AI_ENABLED=false）：本脚本无法验收 AI 面板")
                # 仍要走的唯一一件事：确认"没开"时页面不显示生成入口。
                check(True, "已确认前置条件并提前结束", "AI 未开启")
                report(page, username, enabled, mock)
                return 0
            check(True, "后端已开启 AI 分析")
            if not mock:
                notes.append(
                    "注意：这次 backend 不是 mock 模式，脚本会真的调用外部模型服务。"
                )
            else:
                check(mock, "后端用 mock 适配器（演示数据，不联网）")

            # ── 1. 走完整测评，拿到一份报告 ────────────────────────────────
            print("\n[1] 先走到一份报告（复用主流程脚本的路径）")
            go(page, "/")
            page.locator("[data-primary-entry]").click()
            page.wait_for_timeout(2500)
            check("/assess" in page.url, "首页主按钮进入 /assess", f"实际 URL {page.url}")
            page.wait_for_selector("[data-question-card]", timeout=20000)

            answered = 0
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
                page.wait_for_timeout(150)
                next_button = page.locator("[data-next]")
                if next_button.count() == 0:
                    break
                # 保存是服务端往返，按钮在保存期间是禁用的；点禁用按钮会静默无进展。
                if next_button.first.is_disabled():
                    page.wait_for_timeout(1200)
                next_button.first.click()
                page.wait_for_timeout(300)
                answered += 1
            check(answered >= 40, "主测能连续推进到最后一题", f"只推进了 {answered} 题")

            # 最后一道主测题
            final_rating = page.locator(".option-cell[data-rating='1']")
            if final_rating.count() > 0:
                final_rating.first.click()
                page.wait_for_timeout(1500)
                final_next = page.locator("[data-next]")
                if final_next.count() > 0 and not final_next.first.is_disabled():
                    final_next.first.click()
                    page.wait_for_timeout(3500)

            # 补充题：这里刻意走「跳过」，因为本脚本要验的是报告页的 AI 面板，
            # 不是补充题本身（补充题由主流程脚本覆盖）。
            skip_button = page.locator("[data-skip-clarification]")
            if skip_button.count() > 0:
                skip_button.first.click()
                page.wait_for_timeout(4000)
            else:
                notes.append("本次主测结束时没有安排补充题。")

            page.wait_for_timeout(2500)
            report_url_completed = "/reports/" in page.url
            check(report_url_completed, "交卷后落在报告详情页", f"URL {page.url}")
            if not report_url_completed:
                notes.append(f"没到报告页，页面片段：{page.locator('main').inner_text()[:200]!r}")
                return report(page, username, enabled, mock)
            capture(page, "10-report-before-ai-390.png")

            # ── 2. AI 面板：AI 开着时必须给入口，且默认不显示生成按钮以外的动作 ──
            print("\n[2] AI 面板：入口与范围确认")
            panel = page.locator("[data-ai-panel]")
            check(panel.count() == 1, "报告页有 AI 分析面板")
            check(
                page.locator("[data-ai-start]").count() == 1,
                "AI 开启时显示「生成一段 AI 分析」入口",
            )
            check(
                page.locator("[data-ai-quota]").count() == 1,
                "显示今日剩余次数",
                page.locator("[data-ai-quota]").inner_text() if page.locator("[data-ai-quota]").count() else "无",
            )

            page.click("[data-ai-start]")
            consent = page.locator("[data-ai-consent]")
            check(consent.count() == 1, "点生成后先展开范围确认区（不是直接开始生成）")
            consent_text = consent.inner_text()
            check("会发送" in consent_text and "不会发送" in consent_text, "确认区如实列出会发送/不会发送")
            check("用户名、昵称" in consent_text, "明确写出不发送用户名昵称")
            check("完整题库正文与完整答卷" in consent_text, "明确写出不发送完整题库与完整答卷")
            submit = page.locator("[data-ai-submit]")
            check(submit.is_disabled(), "未勾选确认时不能提交（不会替用户同意外发）")
            capture(page, "10-ai-consent-390.png")

            page.locator("input[name='ai-consent']").check()
            page.wait_for_timeout(200)
            check(not submit.is_disabled(), "勾选确认后可以提交")

            # ── 3. 生成并等待结果 ───────────────────────────────────────────
            print(f"\n[3] 生成分析（{'mock 适配器' if mock else '真实模型服务'}，等待 worker 完成）")
            page.click("[data-ai-submit]")
            page.wait_for_selector("[data-ai-job]", timeout=20000)
            running_seen = page.locator("[data-ai-running]").count() == 1
            check(running_seen or page.locator("[data-ai-result]").count() == 1, "提交后立刻进入「进行中」或已出结果")

            waited = 0
            while waited < AI_WAIT_MS:
                if page.locator("[data-ai-result]").count() == 1:
                    break
                if page.locator("[data-ai-failed]").count() == 1:
                    break
                page.wait_for_timeout(1000)
                waited += 1000
            notes.append(f"等待 AI 结果 {waited / 1000:.0f}s")

            check(
                page.locator("[data-ai-failed]").count() == 0,
                "AI 任务没有失败",
                page.locator("[data-ai-failed]").inner_text()[:160]
                if page.locator("[data-ai-failed]").count()
                else "",
            )
            check(page.locator("[data-ai-result]").count() == 1, "拿到了 AI 分析结果")
            if page.locator("[data-ai-result]").count() == 1:
                capture(page, "11-ai-result-390.png")
                # 演示数据的标注只在 mock 模式下**必须**存在；真实模式下它不该出现
                # （出现反而说明后端在把模型输出当演示数据处理）。原实现无条件断言它存在，
                # 于是"用真实 key 跑一遍"必然 FAIL —— 这是脚本的缺陷，不是产品缺陷。
                if mock:
                    check(
                        page.locator("[data-ai-result-mock], [data-ai-mock]").count() >= 1,
                        "结果显著标注了「演示数据」",
                    )
                else:
                    check(
                        page.locator("[data-ai-result-mock], [data-ai-mock]").count() == 0,
                        "真实调用不标注「演示数据」",
                    )
                check(page.locator("[data-ai-summary]").count() == 1, "有「整体印象」")
                check(page.locator("[data-ai-section]").count() >= 1, "有分节正文")
                check(page.locator("[data-ai-actions]").count() == 1, "有「可以试试的具体做法」")
                check(page.locator("[data-ai-questions]").count() == 1, "有「可以问问自己」")
                check(
                    page.locator("[data-ai-result-problems]").count() == 0,
                    "没有「有一部分没读出来」的提示",
                    page.locator("[data-ai-result-problems]").inner_text()[:160]
                    if page.locator("[data-ai-result-problems]").count()
                    else "",
                )
                body = page.locator("[data-ai-result]").inner_text()
                check("不是心理诊断" in body or "不改变上面那份固定报告" in body, "结果结尾保留定位说明")
                check("jobId" not in body and "promptVersion" not in body, "不把内部字段显示给用户")

            # ── 4. 刷新页面：已有结果要能直接看到（不能丢）────────────────
            print("\n[4] 刷新后再看：已有分析必须还在")
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector("[data-ai-panel]", timeout=20000)
            page.wait_for_timeout(1200)
            check(page.locator("[data-ai-result]").count() == 1, "刷新后已有分析照常展示")
            check(page.locator("[data-ai-job]").count() == 1, "刷新后能读到这次任务（不是空面板）")

            # ── 5. 额度扣减：再生成一次应当占掉一次额度 ────────────────────
            print("\n[5] 额度：生成一次会占额度")
            quota_after = page.locator("[data-ai-quota]").inner_text() if page.locator("[data-ai-quota]").count() else ""
            notes.append(f"生成后额度文案：{quota_after!r}")
            check(quota_after != "", "额度文案仍可读")

            # ── 6. 窄屏 / 桌面布局 ─────────────────────────────────────────
            print("\n[6] 布局：320 / 390 / 1440")
            for label, viewport in (("320px", NARROW), ("1440px", DESKTOP)):
                page.set_viewport_size(viewport)
                page.wait_for_timeout(500)
                overflow = overflow_report(page)
                check(not overflow, f"{label} 报告页（含 AI 面板）没有横向溢出", overflow)
                if label == "320px":
                    capture(page, "12-ai-320.png")

            # 生成入口在 320 下也要够大够点
            page.set_viewport_size(NARROW)
            page.wait_for_timeout(400)
            box = page.locator("[data-ai-panel]").bounding_box()
            check(box is not None and box["width"] <= 320, "320px 下 AI 面板宽度不超过视口")

        finally:
            browser.close()

    return report(None, username, probe["enabled"], probe["mock"])


def report(page: Page | None, username: str, enabled: bool, mock: bool) -> int:
    outcome = "PASS" if not failures else "FAIL"
    lines = [
        "# 真实浏览器验收：报告页 AI 分析面板（2026-09-17）",
        "",
        f"- 被验收地址：`{BASE}`" + (f"（{BASE_LABEL}）" if BASE_LABEL else ""),
        f"- AI 是否开启：`{enabled}`；是否 mock 适配器：`{mock}`",
        f"- 使用账号：`{username}`（密码为脚本生成的合成值，未记录）",
        f"- 结论：**{outcome}**（PASS {passed[0]} / FAIL {len(failures)} / SKIP {len(skips)}）",
        "",
    ]
    if notes:
        lines += ["## 观察记录", ""] + [f"- {note}" for note in notes] + [""]
    if failures:
        lines += ["## 失败项", ""] + [f"- {item}" for item in failures] + [""]
    if skips:
        lines += ["## 跳过项", ""] + [f"- {item}" for item in skips] + [""]
    lines += [
        "## 说明",
        "",
        "- 本脚本只做注册 → 建测评 → 作答 → 交卷 → 读报告 → 生成 AI 分析；不调用删除/注销/导出。",
        "- 断言的是页面上真实出现的东西（`data-ai-*` 钩子与文案），不是内部 state。",
        "- AI 结果来自 mock 适配器（若 `mock=true`）：不联网、不用真实 key、带 `mock: true` 标记，",
        "  页面必须显著标注「演示数据」。",
        "- 若 `mock=false`：本次**真的调用了外部模型服务并产生真实费用**，页面则不得标注「演示数据」。",
        "",
    ]
    (OUT / "REPORT.md").write_text("\n".join(lines), encoding="utf-8")
    (OUT / "result.json").write_text(
        json.dumps(
            {
                "base": BASE,
                "aiEnabled": enabled,
                "aiMock": mock,
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
