"""TypeMe 持续优化验收：跨设备草稿冲突（409）在**真实浏览器**里的走查（2026-09-17，第 12 轮）。

用法（项目根目录）：

    python scripts/browser-verify-conflict.py

前置：
    - 前端 dev server 指向一个**可写测试后端**（建议一次性 H2）；
    - **不需要 AI**，本脚本完全不碰 AI；
    - 数据库必须是一次性的：脚本会真实注册账号、真实作答。**不要指向真实库。**

环境变量：
    TYPEME_BASE     被验收地址（默认 http://127.0.0.1:5174）
    TYPEME_OUT      截图目录（默认 docs/optimization/verification/2026-09-17-conflict）
    TYPEME_LABEL    写进报告的说明

产出：<TYPEME_OUT>/*.png 与 REPORT.md / result.json

为什么需要这条脚本（本轮问题）：
    `ConflictState.pendingQuestionIds` 的注释写着"（重新载入后可以对照查看）"，
    但全仓**只写不读** —— 冲突横幅只告诉用户"本机刚才的改动没有写上去"，
    不说是哪一题、自己选了什么。用户点一下「载入最新进度」就再也无从核对。
    这条脚本用**两个相互独立的浏览器上下文**（各自一份 cookie）制造真实 409，
    并断言横幅逐条列出被丢弃的作答。

纪律：
    - 账号名带随机后缀，密码是脚本生成的合成值，**不写进报告**；
    - 不显示、不保存任何凭据或恢复码内容；
    - 只调用注册、登录、建测评、作答、读详情五个流程，不碰删除/注销/导出。
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
        ROOT / "docs" / "optimization" / "verification" / "2026-09-17-conflict",
    )
)
BASE = os.environ.get("TYPEME_BASE", "http://127.0.0.1:5174")
BASE_LABEL = os.environ.get("TYPEME_LABEL", "")

MOBILE = {"width": 390, "height": 844}
NARROW = {"width": 320, "height": 568}

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


def note(text: str) -> None:
    notes.append(text)
    print(f"  NOTE {text}")


def go(page: Page, path: str) -> None:
    page.goto(f"{BASE}/#{path}", wait_until="domcontentloaded")
    page.wait_for_timeout(700)


def capture(page: Page, name: str) -> None:
    try:
        (OUT / name).parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(OUT / name), full_page=True)
    except Exception as exc:  # 截图失败不应让整轮验收失去意义
        note(f"截图 {name} 失败：{exc}")


def register(page: Page, username: str, password: str) -> None:
    """真实表单注册（含免责声明勾选与恢复码确认），注册即登录。"""
    go(page, "/register")
    page.fill("input[name='username']", username)
    page.fill("input[name='nickname']", "冲突验收")
    page.fill("input[name='new-password']", password)
    page.fill("input[name='confirm-password']", password)
    page.locator("input[name='disclaimer-accepted']").check()
    page.click("button[type='submit']")
    page.wait_for_selector("[data-recovery-codes] li", timeout=25000)
    # 恢复码内容不读取、不保存，只等它出现即可。
    page.locator("[data-recovery-codes] ~ div input[type='checkbox']").first.check()
    page.wait_for_timeout(200)
    page.locator("button:has-text('去')").first.click()
    page.wait_for_timeout(1200)


def login(page: Page, username: str, password: str) -> bool:
    go(page, "/login")
    if page.locator("input[name='username']").count() == 0:
        return False
    page.fill("input[name='username']", username)
    page.fill("input[name='password']", password)
    page.locator("button[type='submit']").first.click()
    page.wait_for_timeout(2500)
    return "/login" not in page.url


def current_revision(page: Page, attempt_id: str) -> int | None:
    """从页面自己的请求里拿到服务端 revision（只读 GET，不改任何数据）。"""
    text = page.evaluate(
        """async (attemptId) => {
            const r = await fetch(`/api/v3/attempts/${attemptId}`, { credentials: 'same-origin' });
            if (!r.ok) return null;
            const d = await r.json();
            return JSON.stringify({ revision: d.revision });
        }""",
        attempt_id,
    )
    if not text:
        return None
    try:
        return int(json.loads(text)["revision"])
    except Exception:
        return None


def reach_question(page: Page, index: int) -> bool:
    """往下走 index 题（每题选第 1 档）。返回是否成功推进到下一题。"""
    for _ in range(index):
        card = page.locator("[data-question-card]")
        if card.count() == 0:
            return False
        rating = page.locator(".option-cell[data-rating='1']")
        if rating.count() == 0:
            return False
        rating.first.click()
        page.wait_for_timeout(200)
        try:
            page.wait_for_function(
                """() => {
                    const b = document.querySelector('[data-next]');
                    return b !== null && !b.disabled;
                }""",
                timeout=15000,
            )
        except Exception:
            return False
        page.locator("[data-next]").first.click()
        page.wait_for_timeout(350)
    return True


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"被验收地址：{BASE}")
    print(f"截图目录：{OUT}")

    username = f"cfv_{secrets.token_hex(4)}"
    password = f"Vf-{secrets.token_hex(6)}"

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            # 两个**独立上下文**＝两份 cookie，模拟"两台设备"。
            ctx_a = browser.new_context(viewport=MOBILE)
            ctx_b = browser.new_context(viewport=MOBILE)
            page_a = ctx_a.new_page()
            page_b = ctx_b.new_page()
            for p in (page_a, page_b):
                p.set_default_timeout(20000)

            # ── 1. 设备 A：注册并开始测评 ─────────────────────────────────
            print("\n[1] 设备 A：注册 + 开始测评")
            register(page_a, username, password)
            go(page_a, "/")
            page_a.locator("[data-primary-entry]").click()
            page_a.wait_for_timeout(2500)
            check("/assess" in page_a.url, "设备 A 进入答题页", f"URL {page_a.url}")
            page_a.wait_for_selector("[data-question-card]", timeout=20000)
            attempt_id = page_a.url.split("/assess/")[1].split("?")[0] if "/assess/" in page_a.url else ""
            check(bool(attempt_id), "拿到 attemptId")
            if not attempt_id:
                raise SystemExit("没有 attemptId，后续无意义")

            # A 答前两题
            check(reach_question(page_a, 2), "设备 A 先答两题")
            revision_a = current_revision(page_a, attempt_id)
            note(f"设备 A 答两题后服务端 revision={revision_a}")
            check(revision_a is not None and revision_a >= 2, "服务端 revision 已推进")

            # ── 2. 设备 B：同一账号登录，进入同一份草稿 ───────────────────
            print("\n[2] 设备 B：同账号登录同一份草稿")
            check(login(page_b, username, password), "设备 B 用同一账号登录成功")
            go(page_b, f"/assess/{attempt_id}")
            page_b.wait_for_selector("[data-question-card]", timeout=20000)
            check(
                page_b.locator("[data-question-card]").count() == 1,
                "设备 B 打开了同一份草稿（跨设备续答）",
            )
            # B 只读地确认自己看到的是同一份进度
            b_revision = current_revision(page_b, attempt_id)
            note(f"设备 B 看到 revision={b_revision}")
            check(
                b_revision == revision_a,
                "两台设备看到同一个 revision（同一份草稿）",
                f"A={revision_a} B={b_revision}",
            )

            # ── 3. 让 A 的 revision 过期：B 改一次答案 ────────────────────
            print("\n[3] 设备 B 改一题 → 设备 A 手里的 revision 过期")
            # B 在当前题选第 5 档并等保存完成（B 自己的 revision 是新的，不会冲突）
            b_rating = page_b.locator(".option-cell[data-rating='5']")
            check(b_rating.count() > 0, "设备 B 能选档位")
            b_rating.first.click()
            page_b.wait_for_timeout(1500)
            revision_b = current_revision(page_b, attempt_id)
            note(f"设备 B 改答后 revision={revision_b}")
            check(
                revision_b is not None and revision_a is not None and revision_b > revision_a,
                "另一台设备把 revision 推进了（A 手里那份已过期）",
                f"A={revision_a} B={revision_b}",
            )

            # ── 4. 关键：A 在真实 UI 上作答 → 必须 409，且横幅说清丢了什么 ──
            print("\n[4] 设备 A 继续作答：必须撞 409，且横幅逐条列出被丢弃的作答")
            card_before = page_a.locator("[data-question-card]").inner_text()[:60]
            # 记录 A 这次选的档位（用第 4 档，与前面选的第 1 档区分开，便于断言文案）
            a_rating = page_a.locator(".option-cell[data-rating='4']")
            check(a_rating.count() > 0, "设备 A 仍可点档位（界面没有提前锁死）")
            a_rating.first.click()
            page_a.wait_for_timeout(2500)

            banner = page_a.locator("[data-conflict-banner]")
            check(banner.count() == 1, "设备 A 出现同步冲突横幅（而不是静默覆盖另一台设备）")
            if banner.count() == 1:
                capture(page_a, "10-conflict-banner-390.png")
                banner_text = banner.inner_text()
                check("另一台设备改过这次的进度" in banner_text, "横幅说清了原因")
                lost = page_a.locator("[data-lost-answer]")
                check(
                    lost.count() >= 1,
                    "横幅**逐条列出**被丢弃的作答（题号 + 自己选了什么）",
                    f"条数 {lost.count()}；横幅文本 {banner_text[:160]!r}",
                )
                if lost.count() >= 1:
                    first = lost.first.inner_text()
                    note(f"被丢弃的作答展示为：{first!r}")
                    check("第" in first, "列出的是题号，不是内部 id", f"实际 {first!r}")
                    check(
                        not any(ch.isascii() and ch.isalpha() for ch in first),
                        "界面上不出现任何内部标识（英文 id 等）",
                        f"实际 {first!r}",
                    )
                    check(
                        "很像右边" in first or "更像右边" in first,
                        "列出了用户当时选的那一档（第 4 档应显示为「更像右边」）",
                        f"实际 {first!r}",
                    )
                check(
                    "重新作答" in banner_text,
                    "横幅说明了载入之后需要重新作答（用户知道该做什么）",
                    f"横幅文本 {banner_text[:160]!r}",
                )

            # ── 5. 解题：载入最新进度后，以另一台设备为准 ─────────────────
            print("\n[5] 载入最新进度：以另一台设备为准，且能继续作答")
            reload_button = page_a.locator("[data-reload-latest]")
            check(reload_button.count() == 1, "横幅提供「载入最新进度」出路")
            reload_button.first.click()
            page_a.wait_for_timeout(2500)
            check(
                page_a.locator("[data-conflict-banner]").count() == 0,
                "载入后冲突态解除（横幅消失）",
            )
            next_button = page_a.locator("[data-next]")
            check(next_button.count() > 0, "载入后仍能继续作答")
            if next_button.count() > 0:
                page_a.locator(".option-cell[data-rating='2']").first.click()
                page_a.wait_for_timeout(1500)
                check(
                    page_a.locator("[data-conflict-banner]").count() == 0,
                    "载入后新的作答不再冲突（用的是刚读到的最新 revision）",
                )
            note(f"冲突前后 A 的题卡：{card_before!r}")

            # ── 6. 窄屏：横幅在 320 下不溢出 ─────────────────────────────
            print("\n[6] 窄屏 320：冲突横幅不横向溢出")
            go(page_a, f"/assess/{attempt_id}")
            page_a.wait_for_timeout(1500)
            # 再制造一次冲突，专门看窄屏横幅
            page_b.reload(wait_until="domcontentloaded")
            page_b.wait_for_timeout(1500)
            b2 = page_b.locator(".option-cell[data-rating='3']")
            if b2.count() > 0:
                b2.first.click()
                page_b.wait_for_timeout(1500)
            page_a.set_viewport_size(NARROW)
            a2 = page_a.locator(".option-cell[data-rating='5']")
            if a2.count() > 0:
                a2.first.click()
                page_a.wait_for_timeout(2500)
            if page_a.locator("[data-conflict-banner]").count() == 1:
                capture(page_a, "11-conflict-banner-320.png")
                overflow = page_a.evaluate(
                    "() => document.documentElement.scrollWidth > window.innerWidth + 1"
                )
                check(not overflow, "320px 下冲突横幅没有横向溢出")
            else:
                note("第二次冲突未复现（可能是 revision 恰好一致），320 布局项按 SKIP 处理")
                skips.append("320px 冲突横幅布局")

            ctx_a.close()
            ctx_b.close()
        finally:
            browser.close()

    return report()


def report() -> int:
    outcome = "PASS" if not failures else "FAIL"
    lines = [
        "# 真实浏览器验收：跨设备草稿冲突（409）（2026-09-17）",
        "",
        f"- 被验收地址：`{BASE}`" + (f"（{BASE_LABEL}）" if BASE_LABEL else ""),
        f"- 结论：**{outcome}**（PASS {passed[0]} / FAIL {len(failures)} / SKIP {len(skips)}）",
        "",
        "## 这条脚本在验什么",
        "",
        "用两个**独立浏览器上下文**（各自一份 cookie，等价于两台设备）打开同一份草稿：",
        "设备 B 先改一题把 revision 推进，设备 A 再作答时手里的 `expectedRevision` 已过期。",
        "断言的是**用户看到的东西**：横幅必须逐条列出被丢弃的作答（第几题 · 选了什么），",
        "而不是只说一句「本机刚才的改动没有写上去」。",
        "",
    ]
    if notes:
        lines += ["## 观察记录", ""] + [f"- {item}" for item in notes] + [""]
    if failures:
        lines += ["## 失败项", ""] + [f"- {item}" for item in failures] + [""]
    if skips:
        lines += ["## 跳过项", ""] + [f"- {item}" for item in skips] + [""]
    lines += [
        "## 说明",
        "",
        "- 账号名带随机后缀，密码为脚本生成的合成值，未记录；恢复码内容不读取、不保存。",
        "- 冲突是**真实制造**的（另一台设备真的改了数据），不是在 console 里伪造请求。",
        "- 只调用注册、登录、建测评、作答、读详情；不碰删除/注销/导出。",
        "",
    ]
    (OUT / "REPORT.md").write_text("\n".join(lines), encoding="utf-8")
    (OUT / "result.json").write_text(
        json.dumps(
            {
                "base": BASE,
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
    raise SystemExit(main())
