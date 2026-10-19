"""第 97 轮：真实栈深走查 —— 跨会话冲突、补充题答完、报告比较、AI 关闭。

**不 mock 任何 /api**：真实 jar + 真实 MySQL 隔离库 `typeme_r97_e2e` + 真实 Chromium。
本脚本只连 127.0.0.1:8098 与隔离库，跑完由调用方删库；账号/密码为脚本生成的合成值。

覆盖：
  1. 注册（真实邀请码 / CSRF / 会话），另一个浏览器上下文用同一账号**重新登录**（第二个会话）；
  2. A 建测评并答 1 题；B 打开同一份草稿、答 1 题（revision 前进）；A 再答 → 409 冲突横幅；
  3. 冲突时：下一题禁用、说出丢的是哪一题、库里**没有**把 A 那次被拒的作答写进去；
  4. 点「载入最新进度」→ 横幅消失、B 的作答保留；
  5. A 答完 48 题 → 进补充题 → 答完 16 题交卷 → 报告页；
  6. 报告页 AI 关闭态（`data-ai-disabled`）与固定报告可读；
  7. 第二份测评（全部选 1）答完 + 跳过补充题 → 第二份报告；
  8. 两份真实报告的 `/reports/compare` 对照表与「同一内容包」；
  9. 历史列表两行、都是十六型。
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from hashlib import sha256
from pathlib import Path
from uuid import uuid4

from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[3]
BASE = os.environ.get("TYPEME_BASE", "http://127.0.0.1:8098")
DB = os.environ.get("TYPEME_DB", "typeme_r97_e2e")
OUT = Path(__file__).resolve().parent
SHOTS = OUT / "shots"
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"

checks: list[dict] = []
notes: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> bool:
    checks.append({"label": label, "passed": bool(ok), "detail": str(detail)})
    print(("PASS  " if ok else "FAIL  ") + label + (("  :: " + str(detail)) if detail else ""))
    return bool(ok)


def mysql(sql: str) -> str:
    proc = subprocess.run(
        [MYSQL, "-h", "127.0.0.1", "-P", "3306", "-uroot", "-p123456", "-N",
         "--default-character-set=utf8mb4", "-e", sql],
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise RuntimeError("mysql failed: " + proc.stderr)
    return proc.stdout


def seed_invitation() -> str:
    code = uuid4().hex
    mysql("INSERT INTO {db}.registration_invitation(id, code_hash, created_at, expires_at) VALUES "
          "('{i}', '{h}', NOW(6), DATE_ADD(NOW(6), INTERVAL 1 HOUR))".format(
              db=DB, i=uuid4(), h=sha256(code.encode()).hexdigest()))
    return code


def capture(page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / name), full_page=True)


def answer_jung(page, count: int, rating: int = 5) -> int:
    done = 0
    for _ in range(count):
        cell = page.locator(f".option-cell[data-rating='{rating}']")
        if cell.count() == 0:
            break
        cell.first.click()
        page.wait_for_timeout(120)
        try:
            page.wait_for_function(
                """() => { const b = document.querySelector('[data-next]');
                           return b !== null && !b.disabled; }""", timeout=15000)
        except Exception:
            notes.append(f"第 {done + 1} 题后「下一题」15s 未恢复可用")
            break
        page.locator("[data-next]").first.click()
        page.wait_for_timeout(220)
        done += 1
    return done


def attempt_detail(page, attempt_id: str) -> dict:
    return page.evaluate(
        "async (id) => (await (await fetch('/api/v3/attempts/' + id, {credentials:'same-origin'})).json())",
        attempt_id)


def main() -> int:
    invitation = seed_invitation()
    username = "r97_" + uuid4().hex[:10]
    password = "R97-Real!2026"

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.set_default_timeout(30000)
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        # ── 1. 注册（真实邀请码）────────────────────────────────────────
        page.goto(f"{BASE}/#/register", wait_until="domcontentloaded")
        page.fill("input[name='invitationCode']", invitation)
        page.fill("input[name='username']", username)
        page.fill("input[name='nickname']", "冲突走查")
        page.fill("input[name='new-password']", password)
        page.fill("input[name='confirm-password']", password)
        page.locator("input[name='disclaimer-accepted']").check()
        page.click("button[type='submit']")
        page.wait_for_selector("[data-recovery-codes] li", timeout=40000)
        check("真实注册成功", True)

        # ── 2. 第二个会话：同一账号重新登录 ─────────────────────────────
        context_b = browser.new_context(viewport={"width": 390, "height": 844})
        page_b = context_b.new_page()
        page_b.set_default_timeout(30000)
        page_b.goto(f"{BASE}/#/login", wait_until="domcontentloaded")
        page_b.fill("input[name='username']", username)
        page_b.fill("input[name='password']", password)
        page_b.click("button[type='submit']")
        page_b.wait_for_function(
            "async () => (await fetch('/api/v3/me', {credentials:'same-origin'})).status === 200",
            timeout=20000)
        check("第二个会话用同一账号登录成功（独立会话）", True)

        # ── 3. A 建测评并答 1 题 ────────────────────────────────────────
        page.goto(f"{BASE}/#/assess", wait_until="domcontentloaded")
        page.wait_for_selector("[data-start='jung48']", timeout=20000)
        page.locator("[data-start='jung48']").click()
        page.wait_for_selector("[data-question-card]", timeout=30000)
        attempt_id = page.url.split("/assess/")[1].split("?")[0]
        check("建出测评并进入答题页", "/assess/" in page.url, page.url)
        answered_a = answer_jung(page, 1, rating=4)
        check("会话 A 先答 1 题", answered_a == 1, answered_a)
        ids_a = {item["questionId"] for item in attempt_detail(page, attempt_id)["answers"]}

        # ── 4. B 打开同一份草稿、答 1 题（revision 前进）────────────────
        page_b.goto(f"{BASE}/#/assess/{attempt_id}", wait_until="domcontentloaded")
        page_b.wait_for_selector("[data-question-card]", timeout=30000)
        answered_b = answer_jung(page_b, 1, rating=2)
        check("会话 B 打开同一草稿并答 1 题", answered_b == 1, answered_b)
        before = attempt_detail(page_b, attempt_id)
        ids_before = {item["questionId"] for item in before["answers"]}
        conflict_target = (ids_before - ids_a).pop()
        notes.append(f"冲突发生在题目 {conflict_target}；冲突前已答 {sorted(ids_before)}")

        # ── 5. A 再答 → 冲突横幅，且不静默覆盖 ─────────────────────────
        page.locator(".option-cell[data-rating='5']").first.click()
        page.wait_for_selector("[data-conflict-banner]", timeout=15000)
        banner = page.locator("[data-conflict-banner]").inner_text()
        check("冲突横幅出现并说明是另一台设备", "另一台设备" in banner, banner[:120])
        check("冲突后「下一题」被禁用", page.locator("[data-next]").is_disabled())
        lost = page.locator("[data-lost-answer]")
        check("横幅列出本机没写上去的那一题", lost.count() >= 1,
              lost.first.inner_text() if lost.count() else "(没有条目)")
        detail = attempt_detail(page, attempt_id)
        answered_ids = {item["questionId"] for item in detail["answers"]}
        check("被 409 拒绝的那一题没有写进服务端（不静默覆盖 B）",
              answered_ids == ids_before and len(detail["answers"]) == len(ids_before),
              sorted(answered_ids))
        capture(page, "01-conflict-390.png")

        # ── 6. 载入最新进度 → 横幅消失，B 的作答保留 ────────────────────
        page.locator("[data-reload-latest]").first.click()
        page.wait_for_function(
            "() => document.querySelector('[data-conflict-banner]') === null", timeout=20000)
        page.wait_for_timeout(500)
        detail = attempt_detail(page, attempt_id)
        answers_now = {item["questionId"]: item.get("rating") for item in detail["answers"]}
        check("载入后横幅消失", page.locator("[data-conflict-banner]").count() == 0)
        check("B 的作答在载入后仍然保留",
              set(answers_now) == ids_before and answers_now.get(conflict_target) == 2,
              answers_now)
        check("A 被拒的那一题仍未写入", set(answers_now) == ids_before, sorted(answers_now))
        capture(page, "02-after-reload-390.png")

        # ── 7. 答完主测 → 补充题答完 → 交卷 → 报告页 ────────────────────
        more = answer_jung(page, 60, rating=5)
        check("主测可以一路答完", answered_a + answered_b + more >= 48, answered_a + answered_b + more)
        page.wait_for_selector("[data-start-clarification]", timeout=20000)
        check("主测结束提供补充题入口", page.locator("[data-start-clarification]").count() == 1)
        page.locator("[data-start-clarification]").click()
        page.wait_for_selector("[data-back-to-base]", timeout=20000)
        check("补充题进行中保留「回到主测改答」出口", page.locator("[data-back-to-base]").count() == 1)
        check("补充题进行中保留「跳过补充题」出口",
              page.locator("[data-skip-clarification-in-progress]").count() == 1)
        clar = answer_jung(page, 20, rating=4)
        check("补充题可以答完", clar >= 16, clar)
        page.wait_for_timeout(2500)
        check("答完补充题后进入报告页", "/reports/" in page.url, page.url)
        report_one = page.url.split("/reports/")[1].split("?")[0] if "/reports/" in page.url else ""
        capture(page, "03-report-clarified-390.png")

        # ── 8. 报告页：固定报告可读 + AI 关闭态 ────────────────────────
        check("报告页有固定报告概览", page.locator("[data-report-overview]").count() == 1)
        ai_disabled = page.locator("[data-ai-disabled]")
        check("AI 关闭时页面明确说明暂未开放", ai_disabled.count() == 1,
              ai_disabled.first.inner_text()[:80] if ai_disabled.count() else "(没有该元素)")
        check("AI 关闭不影响固定报告阅读", page.locator("[data-plain-report]").count() >= 1)

        # ── 9. 第二份测评：全选 1，跳过补充题 ──────────────────────────
        page.goto(f"{BASE}/#/assess", wait_until="domcontentloaded")
        page.wait_for_selector("[data-start='jung48']", timeout=20000)
        page.locator("[data-start='jung48']").click()
        page.wait_for_selector("[data-question-card]", timeout=30000)
        second = page.url.split("/assess/")[1].split("?")[0]
        answered2 = answer_jung(page, 60, rating=1)
        check("第二份测评答完 48 题", answered2 >= 48, answered2)
        skip = page.locator("[data-skip-clarification]")
        if skip.count():
            skip.first.click()
            page.wait_for_timeout(4000)
        page.wait_for_timeout(1500)
        check("第二份测评交卷后进入报告页", "/reports/" in page.url and second not in page.url, page.url)
        report_two = page.url.split("/reports/")[1].split("?")[0] if "/reports/" in page.url else ""
        check("两份报告编号不同", report_one != report_two and report_two != "", f"{report_one} / {report_two}")

        # ── 10. 两份真实报告的比较页 ───────────────────────────────────
        page.goto(f"{BASE}/#/reports/compare?a={report_one}&b={report_two}", wait_until="domcontentloaded")
        page.wait_for_selector("[data-compare-result]", timeout=25000)
        subject = page.locator("[data-compare-subject]").first.inner_text()
        check("比较页写明这次比的是哪两份", subject.count("份") >= 1, subject[:120])
        check("同一内容包时不显示「版本不同」", page.locator("[data-compare-different-package]").count() == 0)
        rows = page.locator("[data-compare-row]")
        check("比较表给出四个维度", rows.count() == 4, rows.count())
        capture(page, "04-compare-390.png")

        # ── 11. 历史列表两行 ───────────────────────────────────────────
        page.goto(f"{BASE}/#/reports", wait_until="domcontentloaded")
        page.wait_for_selector("[data-report-rows]", timeout=20000)
        check("历史列表有两份十六型报告", page.locator("[data-report-row]").count() == 2,
              page.locator("[data-report-row]").count())
        check("全程没有未捕获的前端异常", not errors, "; ".join(errors[:3]))

        context_b.close()
        browser.close()

    failed = [c for c in checks if not c["passed"]]
    result = {
        "scope": "真实栈：真实 jar + 真实 MySQL（隔离库 typeme_r97_e2e）+ 真实 Chromium，不 mock /api",
        "base": BASE, "database": DB, "notes": notes,
        "checks": checks, "passed": len(checks) - len(failed), "failed": len(failed),
    }
    (OUT / "real-stack-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    print("\n== %d/%d 通过，失败 %d ==" % (result["passed"], len(checks), len(failed)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
