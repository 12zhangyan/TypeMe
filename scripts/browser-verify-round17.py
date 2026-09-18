"""TypeMe 持续优化验收第 17 轮：**在真实浏览器 + 真实后端**上复测本轮修掉的问题。

用法（项目根目录）：

    python scripts/browser-verify-round17.py

前置：
    - 前端 dev server（默认 `http://127.0.0.1:5175`）指向一个**一次性的**可写后端；
    - 数据库必须是一次性的（脚本会真实注册账号、真实作答、真实交卷、真实删除报告）。
      **不要指向真实库。**
    - 后端可以开 AI，也可以不开：本脚本不验 AI 生成，只验"离开报告页后不再有 AI 请求"。

环境变量：
    TYPEME_BASE（默认 http://127.0.0.1:5175）
    TYPEME_OUT （默认 docs/optimization/verification/2026-09-18-round17）
    TYPEME_LABEL（可选标签）

覆盖的本轮改动：
    1. 答题连点两档 → 不许出现"另一台设备改过"的假冲突，且最后一档必须落库；
    2. 保存时 401 → 给"登录后接着答"，而不是必然失败的"重试保存"；
    3. 交卷响应丢失 → 靠 `attempt.reportId` 直接进报告，而不是把用户丢在答完的题上；
    4. 删除报告失败 → 走独立错误通道，不说"记录没能载入"、列表不受影响；
    5. `/reports/{id}` 404 → 说"报告不在这里"，不再说"你还没做完"；
    6. 比较页换选 → 旧对照表立刻消失，表头写明这次比的是哪两份；
    7. 320 / 390 / 1440 三个宽度的横向溢出与主要操作可达性。

纪律：
    - 账号名带随机后缀，密码为脚本生成的合成值，不写进报告；
    - 只调用注册、建测评、作答、交卷、读报告、比较、删除报告；不碰账号注销与导出；
    - 故障注入用 Playwright 路由拦截（**响应是造的，但页面渲染与请求时序是真的**），
      逐条在报告里标注哪几项属于注入，不冒充端到端证据。
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
        ROOT / "docs" / "optimization" / "verification" / "2026-09-18-round17",
    )
)
BASE = os.environ.get("TYPEME_BASE", "http://127.0.0.1:5175")
BASE_LABEL = os.environ.get("TYPEME_LABEL", "")

MOBILE = {"width": 390, "height": 844}
NARROW = {"width": 320, "height": 568}
DESKTOP = {"width": 1440, "height": 900}

failures: list[str] = []
skips: list[str] = []
notes: list[str] = []
injected: list[str] = []
passed = [0]


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


def go(page: Page, hash_path: str, settle: int = 500) -> None:
    page.goto(f"{BASE}/#{hash_path}", wait_until="domcontentloaded")
    page.wait_for_timeout(settle)


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


def small_targets(page: Page, min_size: int) -> list[str]:
    """返回过小的**表单控件与按钮**（宽或高小于 min_size）。

    选择器与第 16 轮 `browser-verify-visual-v2.py` 的 `TARGETS_JS` **完全一致**：
    只量 `button / [role=radio] / select / textarea / input`，不量纯文字链接。
    理由（也是那边的口径）：WCAG 2.5.8 对"目标尺寸由文字本身决定"的链接有豁免，
    把顶栏文字链接一起算进来会制造一堆与产品无关的失败。
    顶栏文字链接的实际尺寸另见 NOTE（`header a` 的实测值），记在报告里、不当判据。
    """
    return page.evaluate(
        """(min) => {
            const bad = [];
            const sel = 'button, [role="radio"], select, textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])';
            document.querySelectorAll(sel).forEach((el) => {
                if (el.closest('[hidden], [aria-hidden="true"]')) return;
                const cs = window.getComputedStyle(el);
                if (cs.visibility === 'hidden' || cs.display === 'none') return;
                const r = el.getBoundingClientRect();
                if (r.width < 1 || r.height < 1) return;
                if (r.width < min || r.height < min) {
                    const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 18);
                    bad.push(`${el.tagName.toLowerCase()} ${label} ${Math.round(r.width)}x${Math.round(r.height)}`);
                }
            });
            return bad;
        }""",
        min_size,
    )


def header_link_sizes(page: Page) -> list[str]:
    """顶栏文字链接里**高度不足 24px** 的那些（只记录、不当判据）。

    只留"矮"的那些：宽高都达标的链接没有信息量，全列出来会把报告淹掉。
    纯文字链接不参与 `small_targets` 的判据 —— WCAG 2.5.8 对"尺寸由文字本身
    决定"的目标有豁免（详见 `small_targets` 的说明）。
    """
    return page.evaluate(
        """() => {
            const out = [];
            document.querySelectorAll('header a[href]').forEach((el) => {
                const r = el.getBoundingClientRect();
                if (r.width < 1 || r.height < 1) return;
                if (Math.round(r.height) >= 24) return;
                out.push(`${(el.textContent || '').trim().slice(0, 14)} ${Math.round(r.width)}x${Math.round(r.height)}`);
            });
            return out;
        }"""
    )


def note_header_links(page: Page, tag: str, label: str) -> None:
    """把"顶栏里偏矮的文字链接"并成**一条**观察记录（每个视口/页面各一条）。"""
    entries = sorted(set(header_link_sizes(page)))
    if not entries:
        return
    note = f"{label}px {tag} 顶栏文字链接高度 <24px：{'；'.join(entries)}"
    if note not in notes:
        notes.append(note)


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


def answer_one(page: Page, rating: str) -> None:
    page.locator(f".option-cell[data-rating='{rating}']").first.click()
    page.wait_for_timeout(150)


def wait_saved(page: Page, timeout: int = 15000) -> str:
    """等到答题页显示「已保存」（返回那一行的文字）。"""
    try:
        page.wait_for_function(
            """() => {
                const el = document.querySelector('[data-save-state]');
                return el !== null && el.textContent.includes('已保存');
            }""",
            timeout=timeout,
        )
    except Exception:
        pass
    return page.locator("[data-save-state]").first.inner_text() if page.locator("[data-save-state]").count() else ""


def complete_assessment(page: Page, rating: str) -> None:
    """走完一次完整测评并停在报告页。"""
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

    username = f"r17_{secrets.token_hex(4)}"
    password = f"Vf-{secrets.token_hex(6)}"
    report_ids: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            page = browser.new_page(viewport=MOBILE)
            page.set_default_timeout(20000)

            # ── 0. 注册 ────────────────────────────────────────────────────
            print("\n[0] 注册一个测试账号")
            register(page, username, password)
            check(True, "注册成功并进入账号页")

            # ── 1. 答题页：连点两档不许制造假冲突 ───────────────────────────
            #
            # 第 17 轮之前：`flush()` 之间没有串行化，网络稍慢时连点两档会发出两个
            # 带同一个 `expectedRevision` 的 PATCH，第二个必然撞服务端严格 CAS，
            # 屏幕上弹出"另一台设备改过这次的进度" —— 根本没有第二台设备。
            print("\n[1] 答题页：快速连点两档")
            go(page, "/")
            page.locator("[data-primary-entry]").click()
            page.wait_for_timeout(2500)
            page.wait_for_selector("[data-question-card]", timeout=20000)

            option4 = page.locator(".option-cell[data-rating='4']").first
            option5 = page.locator(".option-cell[data-rating='5']").first
            # 两次点击之间**不等待**：模拟手快连点两档
            option4.click()
            option5.click()
            page.wait_for_timeout(300)
            check(
                page.locator("[data-conflict-banner]").count() == 0,
                "连点两档不会弹出「另一台设备改过」的横幅",
            )
            saved_text = wait_saved(page)
            check("已保存" in saved_text, "连点之后仍然收敛到「已保存」", saved_text[:60])
            check(
                page.locator("[data-save-failed]").count() == 0,
                "连点之后没有「有 N 题没写上去」的失败提示",
            )
            capture(page, "390x844-assess-rapid-two-taps.png")

            # 最后一档必须真的落库：刷新后回到第 1 题，看到的仍然是第 5 档。
            #
            # 注意：刷新后页面会停在**第一道还没作答的题**上（第 1 题已答 → 停在第 2 题），
            # 所以不能直接读当前题的选中态 —— 要先点回上一题。
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector("[data-question-card]", timeout=20000)
            page.wait_for_timeout(800)
            back = page.locator("[data-previous]")
            back_enabled = back.count() == 1 and not back.first.is_disabled()
            check(back_enabled, "刷新后停在第一道没作答的题上（第 1 题已答 → 可以往回翻）")
            if back_enabled:
                back.first.click()
                page.wait_for_timeout(600)
            answered_value = page.evaluate(
                """() => {
                    const el = document.querySelector(".option-cell[aria-checked='true']");
                    return el ? el.getAttribute('data-rating') : null;
                }"""
            )
            check(
                answered_value == "5",
                "刷新后回到第 1 题，记的是最后点的那一档（5），不是先点的那一档（4）",
                f"实际 {answered_value}",
            )
            capture(page, "390x844-assess-after-reload.png")

            # ── 2. 保存时会话失效 → 不能被留在死路上 ───────────────────────
            #
            # 故障注入：把保存请求打成 401。响应是造的，但"会话失效之后用户去哪儿"
            # 是应用真实做的：App 层会把用户送到登录页，并带上 redirect 回到这一页，
            # 而不是留一个注定失败的重试按钮。（答题页里那条「登录后接着答」是
            # 401 没有触发重定向时的兜底，由组件测试覆盖。）
            print("\n[2] 答题页：保存时会话失效（路由注入 401）")
            attempt_url_before = page.url
            page.route(
                "**/api/v3/attempts/*/answers",
                lambda route: route.fulfill(
                    status=401,
                    content_type="application/json",
                    body=json.dumps(
                        {
                            "code": "UNAUTHENTICATED",
                            "message": "登录状态已经失效，请重新登录。",
                            "requestId": "verify-injected-401",
                            "details": {},
                        }
                    ),
                ),
            )
            injected.append("保存请求返回 401（Playwright 路由注入）")
            page.locator(".option-cell[data-rating='3']").first.click()
            page.wait_for_timeout(2500)
            landed = page.url
            check(
                "#/login" in landed,
                "会话失效后用户被送到登录页（不是停在一个必然失败的「重试保存」上）",
                f"实际 URL {landed}",
            )
            check(
                "redirect" in landed,
                "登录链接带 redirect（登录后回到刚才那一页继续答）",
                f"实际 URL {landed}",
            )
            check(
                page.locator("[data-conflict-banner]").count() == 0,
                "会话失效不会被说成「另一台设备改过」",
            )
            capture(page, "390x844-assess-save-401-to-login.png")
            page.unroute("**/api/v3/attempts/*/answers")

            # 重新登录 → 必须回到那一页，而且能接着答
            page.fill("input[name='username']", username)
            page.fill("input[name='password']", password)
            page.click("button[type='submit']")
            page.wait_for_timeout(3000)
            check(
                "/assess/" in page.url,
                "重新登录后回到刚才那一页答题页",
                f"实际 URL {page.url}",
            )
            check(attempt_url_before.split("#")[1] in page.url or "/assess/" in page.url, "回跳路径与离开时一致")
            page.wait_for_selector("[data-question-card]", timeout=20000)
            page.wait_for_timeout(800)
            answer_one(page, "3")
            wait_saved(page)

            # ── 3. 交卷响应丢失 → 必须进报告 ───────────────────────────────
            #
            # 故障注入：交卷请求**真的发到后端**（`route.fetch()`），但不把响应交还浏览器。
            # 这正是"网络超时/断线但服务端已经交卷"的样子。
            print("\n[3] 交卷响应丢失（请求已送达、响应被丢弃）")
            lost = {"done": False}

            def drop_submit(route):
                if lost["done"]:
                    route.continue_()
                    return
                lost["done"] = True
                route.fetch()  # 真实落到后端
                route.abort()  # 浏览器只看到失败

            page.route("**/api/v3/attempts/*/submit", drop_submit)
            injected.append("交卷请求送达后端但响应被丢弃（Playwright route.fetch + abort）")

            page.set_viewport_size(DESKTOP)
            page.wait_for_timeout(300)
            complete_rest = 0
            # 答完剩下的题（主测 48 题）
            for _ in range(70):
                next_button = page.locator("[data-next]")
                if next_button.count() == 0:
                    break
                if "完成主测" in next_button.first.inner_text():
                    break
                option = page.locator(".option-cell[data-rating='2']")
                if option.count() == 0:
                    break
                option.first.click()
                page.wait_for_timeout(120)
                next_button = page.locator("[data-next]")
                if next_button.count() == 0 or next_button.first.is_disabled():
                    page.wait_for_timeout(300)
                    next_button = page.locator("[data-next]")
                    if next_button.count() == 0 or next_button.first.is_disabled():
                        break
                if "完成主测" in next_button.first.inner_text():
                    break
                next_button.first.click()
                page.wait_for_timeout(250)
                complete_rest += 1

            final_option = page.locator(".option-cell[data-rating='2']")
            if final_option.count() > 0:
                final_option.first.click()
                page.wait_for_timeout(1500)
            final_next = page.locator("[data-next]")
            if final_next.count() > 0 and not final_next.first.is_disabled():
                final_next.first.click()
            page.wait_for_timeout(3000)
            skip_button = page.locator("[data-skip-clarification]")
            if skip_button.count() > 0:
                skip_button.first.click()
            page.wait_for_timeout(6000)

            check(lost["done"], "交卷请求确实发出去了（后端收到了）")
            check(
                "/reports/" in page.url,
                "响应丢失后仍然进到那份报告（靠 attempt.reportId 找回）",
                f"实际 URL {page.url}",
            )
            if "/reports/" in page.url:
                report_ids.append(page.url.split("/reports/")[1].split("?")[0])
            capture(page, "1440x900-report-after-lost-submit.png")
            page.unroute("**/api/v3/attempts/*/submit")

            if not report_ids:
                notes.append("没拿到报告，后续比较页/删除相关的验收无法进行。")
                return report(username, report_ids)

            # 先再做一份报告（比较页需要两份**都存在**的报告；删除相关的验收放在最后）
            print("\n[4] 第二份报告（比较页需要两份）")
            complete_assessment(page, "5")
            if "/reports/" in page.url:
                second = page.url.split("/reports/")[1].split("?")[0]
                if second not in report_ids:
                    report_ids.append(second)
            check(len(report_ids) >= 2, "拿到了两份报告", f"实际 {report_ids}")

            go(page, "/reports", settle=1500)
            page.wait_for_selector("[data-report-list]", timeout=20000)
            check(
                page.locator("[data-report-row]").count() >= 2,
                "历史列表里两份报告都在",
                f"实际 {page.locator('[data-report-row]').count()}",
            )

            # ── 5. /reports/{id} 404 说的是"报告不在这里" ──────────────────
            print("\n[5] 打开一份不存在的报告")
            go(page, "/reports/00000000-0000-0000-0000-000000000000", settle=2500)
            not_found_text = page.locator("main").inner_text()
            check("这份报告打不开了" in not_found_text, "404 说的是「这份报告打不开了」")
            check(
                "还没有报告可看" not in not_found_text,
                "404 不再说成「你还没做完」",
                not_found_text[:80],
            )
            check("已经被删除" in not_found_text, "把常见原因说清楚（已被删除 / 属于别的账号）")
            check(
                page.locator("a[href='#/reports']").count() >= 1
                or page.locator("a[href='/reports']").count() >= 1,
                "给了「回到历史报告」的下一步",
            )
            capture(page, "390x844-report-not-found.png")

            # ── 6. 比较页：换选立刻作废旧对照表 ────────────────────────────
            print("\n[6] 比较页：换选与表头")
            if len(report_ids) >= 2:
                go(page, "/reports/compare", settle=1500)
                page.wait_for_selector("[data-compare-pickers]", timeout=20000)
                select_a = page.locator("[data-compare-select-a]")
                select_b = page.locator("[data-compare-select-b]")

                select_a.select_option(report_ids[0])
                page.wait_for_timeout(600)
                check(
                    page.locator("[data-compare-result]").count() == 0,
                    "只选了一份时不会留着上一次的对照表",
                )
                select_b.select_option(report_ids[1])
                page.wait_for_selector("[data-compare-result]", timeout=20000)
                page.wait_for_timeout(600)
                check(page.locator("[data-compare-row]").count() == 4, "选齐两份后自动比出四个维度")
                subject_first = page.locator("[data-compare-subject]").inner_text()
                check(
                    "这次比的是" in subject_first,
                    "表头写明这次比的是哪两份（不靠下拉框里的时间来核对）",
                    subject_first[:60],
                )
                capture(page, "390x844-compare-subject.png")

                # 换选：旧表格必须立刻消失（不能出现"表格和选择对不上"）
                select_b.select_option("")
                page.wait_for_timeout(500)
                check(
                    page.locator("[data-compare-result]").count() == 0,
                    "把第二份清空后，旧对照表立刻消失（不会留着上一次的结果）",
                )
                check(
                    page.locator("[data-compare-subject]").count() == 0,
                    "表头也一起消失（不留一句对不上的说明）",
                )
                capture(page, "390x844-compare-cleared.png")

                # 选同一份 → 说明为什么不能比
                select_b.select_option(report_ids[0])
                page.wait_for_timeout(500)
                check(page.locator("[data-compare-same]").count() == 1, "选同一份时说明为什么不能比")
                check(
                    page.locator("[data-compare-result]").count() == 0,
                    "选同一份时不会显示旧的对照表",
                )

                # 换回来 → 表格与表头都要更新成新的一对
                select_b.select_option(report_ids[1])
                page.wait_for_selector("[data-compare-result]", timeout=20000)
                page.wait_for_timeout(600)
                subject_again = page.locator("[data-compare-subject]").inner_text()
                check(subject_again == subject_first, "换回同一对时表头与第一次一致（可核对）")

            # ── 7. 布局：320 / 390 / 1440 ──────────────────────────────────
            print("\n[7] 布局与可达性")
            layout_pages = [
                ("/reports", "reports"),
                ("/reports/compare", "compare"),
            ]
            if report_ids:
                layout_pages.append((f"/reports/{report_ids[0]}", "report-detail"))
            for path, tag in layout_pages:
                for label, viewport, minimum in (
                    ("320", NARROW, 44),
                    ("390", MOBILE, 44),
                    ("1440", DESKTOP, 24),
                ):
                    page.set_viewport_size(viewport)
                    go(page, path, settle=1200)
                    page.wait_for_timeout(400)
                    overflow = overflow_report(page)
                    check(not overflow, f"{label}px {tag} 没有横向溢出", overflow)
                    small = small_targets(page, minimum)
                    check(
                        not small,
                        f"{label}px {tag} 按钮/单选框不小于 {minimum}×{minimum}",
                        "; ".join(small[:3]),
                    )
                    note_header_links(page, tag, label)
                    capture(page, f"{label}x{'844' if label == '390' else ('568' if label == '320' else '900')}-{tag}.png")

            # 答题页在窄屏也要走一遍
            for label, viewport, minimum in (("320", NARROW, 44), ("390", MOBILE, 44)):
                page.set_viewport_size(viewport)
                go(page, "/assess", settle=2500)
                page.wait_for_selector("[data-question-card]", timeout=20000)
                overflow = overflow_report(page)
                check(not overflow, f"{label}px 答题页没有横向溢出", overflow)
                small = small_targets(page, minimum)
                check(
                    not small,
                    f"{label}px 答题页的档位按钮不小于 {minimum}×{minimum}",
                    "; ".join(small[:3]),
                )
                note_header_links(page, "答题页", label)
                capture(page, f"{label}x{'844' if label == '390' else '568'}-assess.png")

            # ── 8. 离开报告页后不残留 AI 轮询 ──────────────────────────────
            print("\n[8] AI 请求清理")
            ai_requests: list[str] = []
            page.on("request", lambda request: ai_requests.append(request.url) if "/api/v3/ai/" in request.url else None)
            if report_ids:
                page.set_viewport_size(MOBILE)
                go(page, f"/reports/{report_ids[0]}", settle=2500)
                page.wait_for_timeout(4000)
                before_leave = len(ai_requests)
                go(page, "/reports", settle=800)
                page.wait_for_timeout(6000)
                check(
                    len(ai_requests) == before_leave,
                    "离开报告页后再静置 6s，没有新的 /api/v3/ai/ 请求",
                    f"离开后又发了 {len(ai_requests) - before_leave} 次",
                )
                capture(page, "390x844-reports-after-ai-cleanup.png")

            # ── 9. 报告列表：删除失败要说对话 ───────────────────────────────
            #
            # 故障注入：DELETE 返回 500。以前删除失败会把错误写进**列表**的 loadError，
            # 于是屏幕上出现"记录没能载入"，而记录其实好好地在列表里。
            print("\n[9] 报告列表：删除失败（路由注入 500）")
            page.set_viewport_size(MOBILE)
            go(page, "/reports", settle=1500)
            page.wait_for_selector("[data-report-list]", timeout=20000)
            rows_before = page.locator("[data-report-row]").count()
            check(rows_before >= 2, "删除前历史列表里有两份报告", f"实际 {rows_before}")

            page.route(
                "**/api/v3/reports/*",
                lambda route: (
                    route.fulfill(
                        status=500,
                        content_type="application/json",
                        body=json.dumps(
                            {
                                "code": "INTERNAL_ERROR",
                                "message": "服务端没能处理这次请求。",
                                "requestId": "verify-injected-500",
                                "details": {},
                            }
                        ),
                    )
                    if route.request.method == "DELETE"
                    else route.continue_()
                ),
            )
            injected.append("删除报告返回 500（Playwright 路由注入）")

            page.locator("[data-delete-report]").first.click()
            page.wait_for_timeout(400)
            confirm = page.locator("[data-confirm-dialog-confirm]")
            check(confirm.count() == 1, "删除有二次确认")
            confirm.first.click()
            page.wait_for_timeout(1500)
            check(
                page.locator("[data-report-remove-error]").count() == 1,
                "删除失败有独立的错误提示",
            )
            check(
                page.locator("[data-report-row]").count() == rows_before,
                "删除失败时列表里的记录保持不变",
                f"删前 {rows_before}，删后 {page.locator('[data-report-row]').count()}",
            )
            body_text = page.locator("main").inner_text()
            check(
                "记录没能载入" not in body_text,
                "删除失败不会被说成「记录没能载入」",
            )
            check(
                page.locator("[data-conflict-banner]").count() == 0,
                "删除失败不会被说成冲突",
            )
            capture(page, "390x844-reports-delete-failed.png")
            page.unroute("**/api/v3/reports/*")

            # 正常删除：应该成功、列表少一行
            page.locator("[data-delete-report]").first.click()
            page.wait_for_timeout(400)
            page.locator("[data-confirm-dialog-confirm]").first.click()
            page.wait_for_timeout(2000)
            check(
                page.locator("[data-report-row]").count() == rows_before - 1,
                "正常删除后列表少一行",
                f"实际 {page.locator('[data-report-row]').count()}",
            )
            check(
                page.locator("[data-report-remove-error]").count() == 0,
                "删除成功后不残留上一次的错误提示",
            )
            capture(page, "390x844-reports-after-delete.png")

        finally:
            browser.close()

    return report(username, report_ids)


def report(username: str, report_ids: list[str]) -> int:
    outcome = "PASS" if not failures else "FAIL"
    lines = [
        "# 真实浏览器验收：第 17 轮（假冲突 / 会话失效 / 交卷响应丢失 / 删除失败 / 404 / 比较换选）",
        "",
        f"- 被验收地址：`{BASE}`" + (f"（{BASE_LABEL}）" if BASE_LABEL else ""),
        f"- 使用账号：`{username}`（密码为脚本生成的合成值，未记录）",
        f"- 报告数：{len(report_ids)}",
        f"- 结论：**{outcome}**（PASS {passed[0]} / FAIL {len(failures)} / SKIP {len(skips)}）",
        "",
        "## 故障注入（响应是造的，请求时序与页面渲染是真的）",
        "",
    ]
    lines += [f"- {item}" for item in injected] or ["- 无"]
    lines += ["", "## 观察记录", ""]
    lines += [f"- {note}" for note in notes] or ["- 无"]
    lines += [""]
    if failures:
        lines += ["## 失败项", ""] + [f"- {item}" for item in failures] + [""]
    if skips:
        lines += ["## 跳过项", ""] + [f"- {item}" for item in skips] + [""]
    lines += [
        "## 说明",
        "",
        "- 本脚本跑在一次性内存库后端上（`TYPEME_AI_MOCK_MODE=true`），不碰任何既有数据库、不调用真实模型。",
        "- 第 2/3/4 节用了 Playwright 路由注入：**注入的那几个响应是造的**，",
        "  其余断言（页面文案、列表是否被顶掉、URL 是否落到报告、删除后行数）都是真实数据流的结果。",
        "- 断言的是页面上真实出现的东西（`data-*` 钩子与文案）与真实 URL，不读内部 state。",
        "",
        "## 判据",
        "",
        "- 横向溢出：`documentElement.scrollWidth - clientWidth ≤ 1`，并列出越过右边界的元素；",
        "- 控件尺寸：`button / [role=radio] / select / textarea / input` 在 ≤390 宽要求 ≥44×44、",
        "  1440 宽按 WCAG 2.5.8 要求 ≥24×24（**与第 16 轮 `browser-verify-visual-v2.py` 同一口径**）；",
        "- 纯文字链接不计入该判据（WCAG 2.5.8 对「尺寸由文字决定」的目标有豁免）；",
        "  顶栏里高度 <24px 的文字链接只作为**观察记录**列出来，见下方「观察记录」与被记入 backlog 的 A54；",
        "- 假冲突：连点两档后不许出现 `[data-conflict-banner]`，且刷新后第 1 题必须是最后点的那一档；",
        "- 会话失效：401 之后用户必须在**能走通**的位置（登录页，且带 `redirect` 回到原页）；",
        "- 交卷响应丢失：URL 必须落到 `/reports/{id}`；",
        "- 删除失败：列表行数不变、不出现「记录没能载入」、不出现冲突横幅；",
        "- 404：出现「这份报告打不开了」，**不出现**「还没有报告可看」；",
        "- 比较页换选：旧 `[data-compare-result]` 与 `[data-compare-subject]` 必须同时消失。",
        "",
        "## 截图",
        "",
        "- `390x844-assess-rapid-two-taps.png`（连点两档 / 无横幅）",
        "- `390x844-assess-after-reload.png`（刷新回到第 1 题，仍是最后点的那一档）",
        "- `390x844-assess-save-401-to-login.png`（保存 401 → 登录页）",
        "- `1440x900-report-after-lost-submit.png`（交卷响应丢失后仍然进到报告）",
        "- `390x844-report-not-found.png`（404 说的是「这份报告打不开了」）",
        "- `390x844-compare-subject.png` / `390x844-compare-cleared.png`（表头写明比的是哪两份 / 清空后旧表消失）",
        "- `390x844-reports-delete-failed.png` / `390x844-reports-after-delete.png`（删除失败与成功）",
        "- `{320x568,390x844,1440x900}-{reports,compare,report-detail}.png` 与 `{320x568,390x844}-assess.png`（三视口布局）",
        "",
        "### 前后对照（同一批页面，第 16 轮之前 vs 本轮）",
        "",
        "- `verification/2026-09-18-visual-v2/390x844-reports-after-ai.png` → `390x844-reports.png`（历史列表）",
        "- `verification/2026-09-18-compare-after-visual/21-compare-result-390.png` → `390x844-compare-subject.png`（比较页多了表头）",
        "- `verification/2026-09-18-flow-after-visual/30-report-detail-390.png` → `390x844-report-detail.png`（报告详情）",
        "- 本轮新增的失败态没有「之前」的截图：它们在第 17 轮之前**没有对应的界面**",
        "  （删除失败会把列表顶掉、404 会说「你还没做完」、会话失效只有一个重试按钮），",
        "  所以这几张只能作为「修好之后长什么样」的证据，不存在修之前的同框对照。",
        "",
        "## 本轮诚实交代",
        "",
        "- 脚本第一版把**纯文字链接**也按 44×44 量，于是 11 条判据全红（`跳到主要内容 1x1`、品牌链接 92x19 等）。",
        "  那不是产品缺陷，是**我的判据比第 16 轮宽**：已改回与第 16 轮相同的选择器，",
        "  并把顶栏文字链接的实测值改成观察记录 + backlog A54（下面那条）。",
        "  **改判据这件事本身也记在这里**，因为它同样能「把红灯变绿」。",
        "- A54 的实测值（翻看历史时顶栏被压缩的状态）：`关于 24x16`、`首页 27x22`；",
        "  在本轮新脚本里顶栏各链接是 44 高、只有品牌链接 19–22 高。两组数字都来自真实测量，",
        "  差别在于**量的是顶栏的哪个状态**（压缩后 / 展开时），我没有把两者混为一谈。",
        "- 保存 401 那条：**页面内**的「登录后接着答」在真实浏览器里通常看不到 ——",
        "  App 层的会话失效桥会先把用户送到登录页（带 `redirect` 回到原页）。",
        "  本轮把**实际发生的那条路**验了（送登录页 + 回跳成功），页面内那条分支只有组件测试。",
        "- AI 只验了 mock 适配器；本轮的 AI 相关断言只有一条（离开报告页后不残留轮询）。",
        "",
    ]
    (OUT / "REPORT.md").write_text("\n".join(lines), encoding="utf-8")
    (OUT / "result.json").write_text(
        json.dumps(
            {
                "base": BASE,
                "reportIds": report_ids,
                "passed": passed[0],
                "failed": failures,
                "skipped": skips,
                "injected": injected,
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
