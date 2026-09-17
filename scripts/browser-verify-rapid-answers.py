"""TypeMe 探索性 QA：快速连点是否会伪造出「另一台设备」冲突（2026-09-17，第 15 轮）。

用法（项目根目录）：

    python scripts/browser-verify-rapid-answers.py

要查的假设（H1）
----------------
`AssessView.chooseRating()` 是"先写本地答案 → `await assessment.select()` → 里面 `flush()` 发 PATCH"。
`[data-next]` 只按 `submitting || loading` 禁用，**不看 `saveState`**，选项本身也没有
"saving 期间禁用"。于是快速连点两下会发出**两个带同一个 `expectedRevision`** 的 PATCH；
服务端 `AttemptService.patchAnswers` 也校验 revision，第二个必然 409。
而前端把**任何** 409 都当成"另一台设备改过这份进度"，弹出阻断式横幅 ——
`chooseRating` 之后会拒绝继续作答，直到用户点「载入最新进度」。

如果 H1 成立，用户只是手快点了两下，却被系统告知"另一台设备改过进度"，
并且本机那条作答被判为"没写上去"。这与产品明确关心的"快速连点不丢答案"直接冲突。

验收口径
--------
只在**同一个问题上极快地连点两次**（不涉及任何第二台设备），然后检查：
1. 页面上**不该**出现冲突横幅 —— 出现即 H1 成立；
2. 那次作答最终应当被保存（`data-save-state` 回到「已保存」）。

前置
----
- 前端 dev server 指向一个可写测试后端；
- 数据库必须是一次性的（本脚本会注册账号、建测评）。**不要指向真实库。**
- **本脚本不消耗任何 AI 额度**：全程只用注册 / 建测评 / 作答保存（PATCH）三个接口，
  不碰 AI 分析。

环境变量：
    TYPEME_BASE     被验收地址（默认 http://127.0.0.1:5174）
    TYPEME_OUT      截图目录（默认 docs/optimization/verification/2026-09-17-rapid-answers）
    TYPEME_LABEL    写进报告的说明

产出：<TYPEME_OUT>/*.png 与 REPORT.md / result.json

纪律：账号名带随机后缀、密码是脚本生成的合成值，**不写进报告**；不显示或保存任何 token。
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
        ROOT / "docs" / "optimization" / "verification" / "2026-09-17-rapid-answers",
    )
)
BASE = os.environ.get("TYPEME_BASE", "http://127.0.0.1:5174")
BASE_LABEL = os.environ.get("TYPEME_LABEL", "")
MOBILE = {"width": 390, "height": 844}

passed: list[str] = []
failed: list[str] = []
notes: list[str] = []
conflict_seen: list[str] = []


def check(condition: bool, label: str, detail: str = "") -> None:
    if condition:
        passed.append(label)
        print(f"  PASS {label}" + (f"  [{detail}]" if detail else ""))
    else:
        failed.append(f"{label}" + (f"  [{detail}]" if detail else ""))
        print(f"  FAIL {label}" + (f"  [{detail}]" if detail else ""))


def capture(page: Page, name: str) -> None:
    page.screenshot(path=str(OUT / name), full_page=False)
    print(f"  截图 {name}")


def go(page: Page, hash_path: str) -> None:
    page.goto(f"{BASE}/#{hash_path}", wait_until="domcontentloaded")
    page.wait_for_timeout(1200)


def save_state(page: Page) -> str:
    node = page.locator("[data-save-state]")
    return node.first.inner_text().strip() if node.count() > 0 else ""


def conflict_banner_present(page: Page) -> bool:
    """页面上是否出现阻断式冲突提示。

    判据用**用户可见文字**而不是内部类名：横幅文案里含"另一台设备"，
    这正是本项目里"冲突"对用户的那句话。
    """
    body = page.locator("main").inner_text()
    return "另一台设备" in body


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


def enter_assessment(page: Page) -> None:
    go(page, "/")
    page.locator("[data-primary-entry]").click()
    page.wait_for_timeout(2500)
    page.wait_for_selector("[data-question-card]", timeout=20000)


def busy_until(page: Page, timeout_ms: int = 12000) -> None:
    """等到保存状态离开「正在保存…」或超时。"""
    waited = 0
    while waited < timeout_ms:
        if "正在保存" not in save_state(page):
            return
        page.wait_for_timeout(200)
        waited += 200


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"被验收地址：{BASE}{(' （' + BASE_LABEL + '）') if BASE_LABEL else ''}")
    print(f"截图目录：{OUT}")

    username = f"rapid_{secrets.token_hex(4)}"
    password = f"Rp-{secrets.token_hex(6)}"

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            page = browser.new_page(viewport=MOBILE)
            page.set_default_timeout(20000)

            print("\n[0] 注册并进入答题页")
            register(page, username, password)
            enter_assessment(page)
            check(
                page.locator("[data-question-card]").count() == 1,
                "进入了答题页并看到题面",
            )
            check(save_state(page) != "", "页面上有保存状态指示", save_state(page))

            # ── H1：同一个问题上极快连点两次 ────────────────────────────────
            print("\n[1] H1：同一题极快连点两次（不涉及任何第二台设备）")
            # 先确保没有残留冲突
            check(not conflict_banner_present(page), "开始前页面上没有冲突提示")

            # 网络取证：把 PATCH 的 expectedRevision 与响应码都记下来。
            # 只断言"页面上没有冲突"是不够的 —— 如果第二个请求根本没发出去，
            # 那条断言照样会通过，却什么也没证明。
            patch_calls: list[dict] = []
            page.on(
                "request",
                lambda req: patch_calls.append(
                    {
                        "kind": "req",
                        "revision": (req.post_data_json or {}).get("expectedRevision"),
                        "question": [
                            (r or {}).get("questionId")
                            for r in ((req.post_data_json or {}).get("responses") or [])
                        ],
                        "rating": [
                            (r or {}).get("rating")
                            for r in ((req.post_data_json or {}).get("responses") or [])
                        ],
                        "current": (req.post_data_json or {}).get("currentQuestionId"),
                    }
                )
                if req.method == "PATCH" and "answers" in req.url
                else None,
            )
            page.on(
                "response",
                lambda res: patch_calls.append(
                    {"kind": "res", "status": res.status, "url": res.url}
                )
                if res.request.method == "PATCH" and "answers" in res.url
                else None,
            )

            # 第一次点：立刻返回（不等待保存完成）
            page.locator(".option-cell[data-rating='1']").first.click()
            # 第二次点：同一个问题、另一个档位，中间不给保存任何完成机会
            page.locator(".option-cell[data-rating='5']").first.click()
            page.wait_for_timeout(600)

            reqs = [c for c in patch_calls if c["kind"] == "req"]
            resps = [c for c in patch_calls if c["kind"] == "res"]
            revisions = [c["revision"] for c in reqs]
            statuses = [c["status"] for c in resps]
            notes.append(
                f"Playwright 连点（有稳定性检查，比较慢）：{len(reqs)} 个 PATCH，"
                f"expectedRevision={revisions}；响应码={statuses}"
            )
            print(f"  取证[人工速度]：PATCH={len(reqs)} revision={revisions} 响应={statuses}")
            human_revisions = list(revisions)

            raced = conflict_banner_present(page)
            if raced:
                conflict_seen.append("同一题连点两次后出现『另一台设备』冲突提示")
            capture(page, "30-rapid-same-question-390.png")

            # ── H1b：把两次写入塞进**同一个 JS 执行回合** ────────────────────
            #
            # 这才是"手快"的物理上界：两次点击同步连发，微任务（第一个 flush 的
            # await 续体）要等当前宏任务结束后才跑，所以第二次写入必然发生在
            # 第一次响应回来**之前** —— 两个 PATCH 一定带同一个 expectedRevision。
            # 如果这样都不冲突，说明真的没有这个竞态。
            print("\n[1b] H1b：把两次写入塞进同一个 JS 回合（手快的物理上界）")
            patch_calls.clear()
            result = page.evaluate(
                """() => {
                    const nodes = [...document.querySelectorAll('.option-cell')];
                    const left = nodes.find((n) => n.dataset.rating === '1');
                    const right = nodes.find((n) => n.dataset.rating === '5');
                    if (!left || !right) return { ok: false, found: nodes.length };
                    left.click();
                    const afterFirst = document.querySelector('[data-save-state]')?.textContent?.trim();
                    right.click();
                    return { ok: true, afterFirst };
                }"""
            )
            check(result.get("ok") is True, "同一个 JS 回合内确实点到了两档", f"{result}")
            page.wait_for_timeout(1500)
            busy_until(page)
            page.wait_for_timeout(1200)

            atomic_reqs = [c for c in patch_calls if c["kind"] == "req"]
            atomic_resps = [c for c in patch_calls if c["kind"] == "res"]
            atomic_revisions = [c["revision"] for c in atomic_reqs]
            atomic_statuses = [c["status"] for c in atomic_resps]
            notes.append(
                f"同一 JS 回合内连点两档：{len(atomic_reqs)} 个 PATCH，"
                f"expectedRevision={atomic_revisions}；响应码={atomic_statuses}"
            )
            print(
                f"  取证[同回合连点两档]：PATCH={len(atomic_reqs)} revision={atomic_revisions} "
                f"响应={atomic_statuses}\n"
                f"    题目={[r.get('question') for r in atomic_reqs]}\n"
                f"    档位={[r.get('rating') for r in atomic_reqs]}\n"
                f"    currentQuestionId={[r.get('current') for r in atomic_reqs]}"
            )

            atomic_conflict = conflict_banner_present(page)
            if atomic_conflict and not raced:
                conflict_seen.append("同一 JS 回合内连点两次后出现『另一台设备』冲突提示")
            capture(page, "32-atomic-rapid-390.png")

            # ── H1c：审查指出的第二条重叠路径 ────────────────────────────────
            #
            # `chooseRating()` 的 PATCH 还在飞时立刻点「下一题」：
            # `next()` → `rememberPosition()` → `flush(null)` 会再发一个 PATCH。
            # 两个请求同样带同一个 revision。这条路径**不需要**用户点两次选项，
            # 只需要"选完马上下一题"—— 比连点更接近真实手速。
            print("\n[1c] H1c：选完立刻点「下一题」（chooseRating 与 flush(null) 重叠）")
            patch_calls.clear()
            result2 = page.evaluate(
                """() => {
                    const nodes = [...document.querySelectorAll('.option-cell')];
                    const mid = nodes.find((n) => n.dataset.rating === '3');
                    const nextBtn = document.querySelector('[data-next]');
                    if (!mid || !nextBtn) return { ok: false };
                    mid.click();
                    nextBtn.click();
                    return { ok: true };
                }"""
            )
            check(result2.get("ok") is True, "同一个 JS 回合内完成『选一档 + 下一题』", f"{result2}")
            page.wait_for_timeout(1800)
            busy_until(page)
            page.wait_for_timeout(1500)

            next_path_reqs = [c for c in patch_calls if c["kind"] == "req"]
            next_path_resps = [c for c in patch_calls if c["kind"] == "res"]
            next_path_revisions = [c["revision"] for c in next_path_reqs]
            next_path_statuses = [c["status"] for c in next_path_resps]
            notes.append(
                f"同一 JS 回合内『选一档 + 下一题』：{len(next_path_reqs)} 个 PATCH，"
                f"expectedRevision={next_path_revisions}；响应码={next_path_statuses}"
            )
            print(
                f"  取证[选完即下一题]：PATCH={len(next_path_reqs)} revision={next_path_revisions} "
                f"响应={next_path_statuses}\n"
                f"    题目={[r.get('question') for r in next_path_reqs]}\n"
                f"    档位={[r.get('rating') for r in next_path_reqs]}\n"
                f"    currentQuestionId={[r.get('current') for r in next_path_reqs]}"
            )
            if conflict_banner_present(page):
                conflict_seen.append("『选完立刻下一题』后出现『另一台设备』冲突提示")
            capture(page, "33-select-then-next-390.png")

            final_conflict = conflict_banner_present(page)
            final_state = save_state(page)
            if final_conflict and not raced and not atomic_conflict:
                conflict_seen.append("连点两次后（稍后）出现『另一台设备』冲突提示")

            all_reqs = len(reqs) + len(atomic_reqs) + len(next_path_reqs)
            check(
                all_reqs >= 2,
                "探针确实发出了多个 PATCH（否则后面的断言什么也证明不了）",
                f"人工速度 {len(reqs)} / 同回合两档 {len(atomic_reqs)} / 选完即下一题 {len(next_path_reqs)}",
            )
            note_revisions = (
                f"人工速度 revision={human_revisions}、同回合两档 revision={atomic_revisions}、"
                f"选完即下一题 revision={next_path_revisions}"
            )
            check(
                not final_conflict,
                "**同一台设备上的快速操作不该产生冲突**",
                f"实际保存状态：{final_state}；{note_revisions}",
            )
            check(
                "已保存" in final_state,
                "快速操作之后作答最终被保存下来",
                f"实际保存状态：{final_state}",
            )
            if final_conflict:
                notes.append(
                    "复现：在同一题上先点第 1 档、紧接着点第 5 档，页面出现"
                    "『另一台设备已经改过这份进度』，而全程只有这一个浏览器上下文。"
                )

            # 冲突一旦出现，后续作答会被阻断；这里记录它是否真的阻断了
            if final_conflict:
                page.locator(".option-cell[data-rating='3']").first.click()
                page.wait_for_timeout(800)
                blocked_text = page.locator("main").inner_text()
                blocked = "先处理上方的同步提示" in blocked_text
                notes.append(
                    "连点造成冲突后，再选任何一档都被拒绝继续作答"
                    f"（页面提示：{'出现' if blocked else '未出现'}『先处理上方的同步提示』）。"
                )
                capture(page, "31-after-false-conflict-390.png")

            # ── 对照：正常节奏（等保存完成再点下一档）必须毫无问题 ──────────
            print("\n[2] 对照：正常节奏（等保存完成再点下一档）")
            page.locator(".option-cell[data-rating='3']").first.click()
            busy_until(page)
            page.wait_for_timeout(1000)
            check(
                not conflict_banner_present(page),
                "正常节奏下没有冲突",
                f"保存状态：{save_state(page)}",
            )
            check("已保存" in save_state(page), "正常节奏下作答已保存", save_state(page))

            return finish(username)
        finally:
            browser.close()


def finish(username: str) -> int:
    print(f"\n{'=' * 60}")
    print(f"PASS {len(passed)} / FAIL {len(failed)}")
    for item in failed:
        print(f"  FAIL {item}")

    OUT.mkdir(parents=True, exist_ok=True)
    lines = [
        "# 探索性 QA：快速连点是否会**伪造**出「另一台设备」冲突（2026-09-17，第 15 轮）",
        "",
        f"- 被验收地址：`{BASE}`{(' （' + BASE_LABEL + '）') if BASE_LABEL else ''}",
        f"- 使用账号：`{username}`（密码为脚本生成的合成值，未记录）",
        f"- 结论：**{'PASS（未复现）' if not failed else 'FAIL（问题复现）'}**"
        f"（PASS {len(passed)} / FAIL {len(failed)}）",
        "",
        "## 假设 H1",
        "",
        "`AssessView.chooseRating()` 先写本地答案、再 `await flush()` 发 PATCH；",
        "`[data-next]` 只按 `submitting || loading` 禁用、**不看 `saveState`**，选项也没在",
        "保存期间禁用。所以快速连点两下 = 两个带**同一个** `expectedRevision` 的 PATCH，",
        "服务端 `AttemptService.patchAnswers:196` 必然让第二个 409。",
        "而前端把任何 409 都翻译成「另一台设备已经改过这份进度」，并进入阻断态。",
        "",
        "## 观察记录",
        "",
    ]
    lines += [f"- {line}" for line in notes] or ["- （无）"]
    if conflict_seen:
        lines += ["", "## 复现到的现象", ""]
        lines += [f"- {line}" for line in conflict_seen]
    lines += ["", "## 断言", ""]
    lines += [f"- PASS：{item}" for item in passed]
    lines += [f"- FAIL：{item}" for item in failed]
    lines += [
        "",
        "## 本脚本的边界",
        "",
        "- **不消耗 AI 额度**：全程只用注册 / 建测评 / 作答保存三个接口。",
        "- 只在**单个**浏览器上下文里操作，因此任何「另一台设备」提示都必然是伪造的。",
        "- 用的是脚本注册的一次性合成账号，作答为固定选项，不含真实个人信息。",
    ]
    (OUT / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (OUT / "result.json").write_text(
        json.dumps(
            {
                "base": BASE,
                "passed": passed,
                "failed": failed,
                "notes": notes,
                "conflictSeen": conflict_seen,
                "username": username,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"报告：{OUT / 'REPORT.md'}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
