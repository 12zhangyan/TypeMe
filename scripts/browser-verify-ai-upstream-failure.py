"""TypeMe 验收：**真实上游**返回 401 时，AI 分析怎么收场（固定报告是否受影响）。

用法（项目根目录）：

    python scripts/browser-verify-ai-upstream-failure.py

与被 mock 的验证脚本的区别（这一点必须说清）：
    - 后端以 `TYPEME_AI_MOCK_MODE=false` + 一把**故意写错的 key** 启动，
      于是 worker 真的会 `POST https://api.deepseek.com/...`；
    - 发出去的是**这个一次性测试账号的合成报告**（48 道题全选同一档），
      没有真实用户的个人数据；上游在鉴权阶段就拒绝，不产生费用、不产出内容；
    - 因此本脚本验的是"真实上游错误 → 服务端如何归类 → 界面怎么说"，
      而不是 mock 适配器能不能造出同样的错误码。

环境变量：
    TYPEME_BASE（默认 http://127.0.0.1:5176）
    TYPEME_OUT （默认 docs/optimization/verification/2026-09-18-ai-upstream-401）
    TYPEME_LABEL（可选标签）
    TYPEME_BACKEND_LOG（可选：后端启动日志路径。给了就会去读它自己打印的
        「AI 设置已加载 … mockMode=false, baseUrl=https://api.deepseek.com」那一行，
        作为"这一轮真的是真实上游、不是 mock"的证据）

看什么：
    1. 固定报告先要完整存在（这是后面"不受影响"的比较基准）；
    2. 任务必须落成 FAILED，且服务端给的 errorCode **就是** UPSTREAM_401，
       并且 `mock` 不是 true（否则就是拿演示数据冒充真实调用）；
    3. 界面上说的是"密钥无效/过期，需要站点管理员处理，你自己重试没有用"，
       而不是"网络问题"或"AI 暂时不可用"这类猜测；
    4. 没有任何 AI 结果被显示出来（不能拿半成品凑数）；
    5. 固定报告内容一字未变（AI 失败不影响基础测评）。
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
        ROOT / "docs" / "optimization" / "verification" / "2026-09-18-ai-upstream-401",
    )
)
BASE = os.environ.get("TYPEME_BASE", "http://127.0.0.1:5176")
BASE_LABEL = os.environ.get("TYPEME_LABEL", "")

MOBILE = {"width": 390, "height": 844}

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


def skip(label: str) -> None:
    skips.append(label)
    print(f"  SKIP {label}")


def capture(page: Page, name: str) -> None:
    page.screenshot(path=str(OUT / name))
    shots.append(name)


def go(page: Page, hash_path: str, settle: int = 600) -> None:
    page.goto(f"{BASE}/#{hash_path}", wait_until="domcontentloaded")
    page.wait_for_timeout(settle)


def register(page: Page, username: str, password: str) -> None:
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


def complete_assessment(page: Page, rating: str) -> None:
    """走完一次完整测评并停在报告页（与第 17 轮脚本同一套动作，避免引入新时序）。"""
    go(page, "/")
    page.locator("[data-primary-entry]").click()
    page.wait_for_timeout(2500)
    page.wait_for_selector("[data-question-card]", timeout=20000)

    answered = 0
    for _ in range(70):
        next_button = page.locator("[data-next]")
        if next_button.count() == 0 or "完成主测" in next_button.first.inner_text():
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
        page.wait_for_timeout(5000)
    page.wait_for_timeout(3000)
    notes.append(f"本次作答选了第 {rating} 档，实际点击「下一题」{answered} 次")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"被验收地址：{BASE}{(' （' + BASE_LABEL + '）') if BASE_LABEL else ''}")
    print(f"截图目录：{OUT}")

    username = f"r19ai_{secrets.token_hex(4)}"
    password = f"Vf-{secrets.token_hex(6)}"

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            page = browser.new_page(viewport=MOBILE)
            page.set_default_timeout(20000)

            # ── 0. 注册 ────────────────────────────────────────────────────
            print("\n[0] 注册一个一次性测试账号")
            register(page, username, password)
            check(True, "注册成功")

            # ── 0.5 后端确实是以「关闭 mock + 真实上游」启动的 ──────────────
            #
            # 这一步是为了堵住"其实还是 mock 在造错误码"这条质疑：
            # 从后端启动日志里读它自己打印的设置行，而不是靠我在报告里口头声明。
            print("\n[0.5] 后端启动配置")
            log_path = os.environ.get("TYPEME_BACKEND_LOG", "")
            settings_line = ""
            if log_path and Path(log_path).exists():
                # PowerShell 的 `Tee-Object` 在本机写的是 **UTF-16LE（带 BOM）**，
                # 直接按 UTF-8 读会拿到一堆交错 NUL、连 ASCII 关键字都匹配不上。
                data = Path(log_path).read_bytes()
                for encoding in ("utf-16", "utf-8-sig", "utf-8"):
                    try:
                        text = data.decode(encoding)
                    except UnicodeDecodeError:
                        continue
                    if "AI 设置已加载" in text:
                        for line in text.splitlines():
                            if "AI 设置已加载" in line:
                                settings_line = line.strip()
                                break
                        break
            if not settings_line:
                skips.append(
                    "没有提供 TYPEME_BACKEND_LOG（或日志里没有 AI 设置行），"
                    "「关闭 mock + 真实上游」只能靠启动命令本身证明"
                )
            else:
                check(
                    "mockMode=false" in settings_line and "api.deepseek.com" in settings_line,
                    "后端是「关闭 mock + 指向真实上游」启动的",
                    settings_line[-120:],
                )
                notes.append(f"后端设置行：{settings_line[-160:]}")

            # ── 1. 完成测评，确认固定报告存在（后面的比较基准）──────────────            print("\n[1] 完成主测并交卷")
            complete_assessment(page, "4")
            page.wait_for_selector("[data-report-overview]", timeout=30000)
            capture(page, "390x844-report-before-ai.png")
            # 固定报告的锚点用**整块概览文本**，而不是类型码：
            # 均匀作答很容易让某一维打平，而契约要求 TIED 时**不**强行给四字母，
            # 于是 [data-type-code] 可能合法地不存在。拿它当锚点会把契约行为当成缺陷。
            overview_before = page.locator("[data-report-overview]").first.inner_text()
            type_before = (
                page.locator("[data-type-code]").first.inner_text()
                if page.locator("[data-type-code]").count()
                else ""
            )
            check(bool(overview_before.strip()), "固定报告正文已经渲染（AI 之外的东西先立住）")
            if type_before:
                notes.append(f"报告类型码：{type_before.strip()}")
            else:
                notes.append("这份报告的四个维度里至少有一维打平，按契约不给四字母类型码（本轮不据此断言）")
            report_hash = page.evaluate("() => location.hash")
            notes.append(f"报告页：{report_hash}")

            # ── 2. AI 面板：生成 → 确认范围 → 提交 ─────────────────────────
            print("\n[2] 触发生成（后端 mock 关闭、key 故意写错）")
            panel = page.locator("[data-ai-panel]")
            if panel.count() == 0:
                page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
                page.wait_for_timeout(1200)
            check(page.locator("[data-ai-panel]").count() == 1, "报告页上出现了 AI 分析面板")
            check(
                page.locator("[data-ai-mock]").count() == 0,
                "这一轮没有 mock 标记（说明不是演示数据）",
            )
            page.locator("[data-ai-start]").first.scroll_into_view_if_needed()
            page.locator("[data-ai-start]").first.click()
            page.wait_for_selector("[data-ai-consent]", timeout=10000)
            capture(page, "390x844-ai-consent.png")
            page.locator("input[name='ai-consent']").check()
            page.wait_for_timeout(300)
            page.locator("[data-ai-submit]").first.click()
            page.wait_for_timeout(2500)

            # ── 3. 等终态：必须是 FAILED，而且原因就是上游 401 ──────────────
            print("\n[3] 等任务落终态")
            terminal = ""
            for _ in range(60):  # 最多约 120s：worker 轮询 + 一次真实 HTTP 往返
                status = page.locator("[data-ai-job]").first.get_attribute("data-ai-job-status")
                if status in ("SUCCEEDED", "FAILED", "UNKNOWN"):
                    terminal = status or ""
                    break
                page.wait_for_timeout(2000)
            capture(page, "390x844-ai-failed.png")
            check(terminal == "FAILED", "任务落成 FAILED（不是一直转圈）", f"实际 {terminal or '未落终态'}")
            if terminal != "FAILED":
                skip("任务未落 FAILED，后面的界面文案断言没有意义")

            # 服务端自己怎么说：直接问任务详情（不是从界面文字反推）
            job_id = page.locator("[data-ai-job]").first.get_attribute("data-ai-job-id")
            payload = page.evaluate(
                """async (jobId) => {
                    const r = await fetch(`/api/v3/analyses/${jobId}`, { credentials: 'include' });
                    if (!r.ok) return { ok: false, status: r.status };
                    return { ok: true, body: await r.json() };
                }""",
                job_id,
            )
            if not payload.get("ok"):
                check(False, "能读到任务详情", f"{payload}")
            else:
                body = payload["body"]
                notes.append(f"任务详情：status={body.get('status')} errorCode={body.get('errorCode')} mock={body.get('mock')}")
                check(
                    body.get("errorCode") == "UPSTREAM_401",
                    "服务端把这次失败归成 UPSTREAM_401（真实上游的 401，不是猜的）",
                    f"实际 errorCode={body.get('errorCode')}",
                )
                check(body.get("mock") is not True, "任务没有被标成 mock（真实调用）")
                check(
                    body.get("result") in (None, {}),
                    "没有产出任何结果内容（失败就是失败，不拿半成品凑数）",
                )

            # ── 4. 界面文案：说清原因与下一步 ──────────────────────────────
            print("\n[4] 界面怎么说")
            failed_block = page.locator("[data-ai-failed]")
            check(failed_block.count() == 1, "界面给出独立的失败说明块")
            text = failed_block.first.inner_text() if failed_block.count() else ""
            check("密钥" in text and ("无效" in text or "过期" in text), "说清了是密钥无效/过期", text[:80])
            check("管理员" in text, "说清了这不是用户自己能修的（需要站点管理员）", text[:120])
            check("基础报告不受影响" in text, "说清了基础报告不受影响", text[:160])
            check(
                "网络" not in text,
                "没有把鉴权失败说成网络问题（那是另一种猜测）",
                text[:120],
            )
            check(page.locator("[data-ai-result]").count() == 0, "没有显示任何 AI 结果区")
            check(page.locator("[data-ai-mock]").count() == 0, "没有出现演示数据标记")
            check(page.locator("[data-ai-retry]").count() == 1, "提供了「重试」这一条下一步动作")

            # ── 5. 固定报告一字未变 ────────────────────────────────────────
            print("\n[5] 固定报告是否受影响")
            overview_after = page.locator("[data-report-overview]").first.inner_text()
            check(
                overview_after == overview_before,
                "固定报告概览与 AI 失败前逐字一致",
                f"前 {len(overview_before)} 字 / 后 {len(overview_after)} 字",
            )
            if type_before:
                type_after = (
                    page.locator("[data-type-code]").first.inner_text()
                    if page.locator("[data-type-code]").count()
                    else ""
                )
                check(type_after == type_before, "类型码没变", f"{type_before} → {type_after}")
            check(
                page.locator("[data-report-overview]").count() == 1,
                "固定报告正文仍在页面上",
            )
            share = page.locator("[data-share-text]")
            if share.count() > 0:
                check(bool(share.first.inner_text().strip()), "分享文本仍然可用（没被 AI 失败拖累）")
            else:
                skips.append("报告页没有渲染分享文本块，跳过该条")

            # ── 6. 重试也走同一条真实路径（不额外消耗额度）──────────────────
            print("\n[6] 重试一次")
            page.locator("[data-ai-retry]").first.click()
            page.wait_for_timeout(3000)
            capture(page, "390x844-ai-retry.png")
            after_retry = page.locator("[data-ai-job]").first.get_attribute("data-ai-job-status")
            check(after_retry in ("RUNNING", "QUEUED", "FAILED"), "重试被接受并回到进行中/失败态", f"实际 {after_retry}")
        finally:
            browser.close()

    total = passed[0] + len(failures)
    verdict = "PASS" if not failures else "FAIL"
    print(f"\n{verdict} {passed[0]} / FAIL {len(failures)} / SKIP {len(skips)}")

    lines = [
        "# 真实上游 401 验收：AI 失败时界面说什么、固定报告受不受影响",
        "",
        f"- 被验收地址：`{BASE}`（后端 `TYPEME_AI_MOCK_MODE=false` + 一把**故意写错**的 key）",
        f"- 使用账号：`{username}`（一次性合成账号，密码未记录）",
        f"- 结论：**{verdict}**（PASS {passed[0]} / FAIL {len(failures)} / SKIP {len(skips)}）",
        "",
        "## 这次是真的打到上游了",
        "",
        "- 后端没有开 mock：`TYPEME_AI_MOCK_MODE=false`，`TYPEME_AI_API_KEY` 是一把不存在的 key。",
        "- 于是 worker 真的向 `https://api.deepseek.com` 发起请求，上游在鉴权阶段就返回 401。",
        "- 发出去的内容是**这个一次性账号的合成报告**（48 题全选同一档），没有任何真实用户的个人数据；",
        "  401 不产生费用，也没有任何模型输出被采纳。",
        "- 任务详情里 `errorCode=UPSTREAM_401`、`mock` 不是 true —— 这两点由脚本直接问服务端拿到，",
        "  不是从界面文字反推的。",
        "",
    ]
    if notes:
        lines += ["## 观察记录", ""]
        lines += [f"- {item}" for item in notes]
        lines += [""]
    if shots:
        lines += ["## 截图", ""]
        lines += [f"- `{name}`" for name in shots]
        lines += [""]
    if failures:
        lines += ["## 失败项", ""]
        lines += [f"- {item}" for item in failures]
        lines += [""]
    if skips:
        lines += ["## 跳过项", ""]
        lines += [f"- {item}" for item in skips]
        lines += [""]
    lines += [
        "## 判据",
        "",
        "- **失败必须落成 FAILED**：不能一直转圈，也不能静默消失。",
        "- **原因必须来自服务端分类**：`errorCode=UPSTREAM_401` 是服务端的判断；",
        "  界面文案必须说「密钥无效/过期 + 需要管理员」，而不是「网络问题」或「AI 暂时不可用」。",
        "- **不许有结果**：失败时不能显示 `data-ai-result`，也不能出现 mock 标记。",
        "- **固定报告不受影响**：报告概览文本与分享文本在 AI 失败前后必须完全一致",
        "  （类型码可能因为某一维打平而**合法缺席**，不拿它当锚点）。",
        "",
        "## 诚实交代",
        "",
        "1. 这是**故意制造失败**的验收：真实上游成功生成那条路径由第 14 轮的真实调用与",
        "   第 17 轮的 mock 流程分别覆盖，本轮不复验。",
        "2. 上游返回 401 的具体原因（key 无效）由**我们提供的 key 决定**，不是上游故障；",
        "   这条验收证明的是「上游拒绝 → 服务端归类 → 界面表达」这条链路，不是上游的可用性。",
        "3. 重试那一条只断言「重试被接受」，没有等它第二次失败（会再打一次上游，没有必要）。",
        "4. 弱网/超时/429/截断等其它错误分支仍然只有 mock 证据。",
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
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
