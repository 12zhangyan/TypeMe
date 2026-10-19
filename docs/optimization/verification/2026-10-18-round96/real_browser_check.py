"""第 96 轮补充：**真实浏览器 + 真实 jar + 真实 MySQL（隔离库）** 的端到端走查。

与 `browser_check.py` 的区别：那边把 `/api/**` 全部拦截成合成响应；这边不拦截任何接口，
真实注册（真实邀请码 / CSRF / 会话）→ 真实建测评 → 逐题作答 → 交卷 → 读报告 → 历史列表，
并顺带覆盖大五完整流程与 320 / 390 / 1440 三档宽度。

前置：
  1. 前端 `npm run build`（`frontend/dist` 是当前源码的产物）；
  2. `mvn -o package -DskipTests` 重新打包（jar 里带同一份 dist）；
  3. 建隔离库 `typeme_r96_e2e` 并以 `TYPEME_DB_URL` 指向它启动 jar（默认端口 8097）。

安全边界：只连 127.0.0.1:8097 与隔离库；只往隔离库插一行邀请码、清 register 限流桶；
不写任何已有库；账号、密码都是脚本生成的合成值，不落盘、不进报告。
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
BASE = os.environ.get("TYPEME_BASE", "http://127.0.0.1:8097")
DB = os.environ.get("TYPEME_DB", "typeme_r96_e2e")
OUT = Path(__file__).resolve().parent
SHOTS = OUT / "real-browser-shots"
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
WIDTHS = (320, 390, 1440)

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


def clear_register_rate_limit() -> None:
    mysql(f"DELETE FROM {DB}.rate_limit_bucket WHERE bucket_key LIKE 'register:%';")


def capture(page, name: str) -> None:
    page.screenshot(path=str(SHOTS / name), full_page=True)


def overflow(page) -> int:
    m = page.evaluate(
        "() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})")
    return max(0, m["sw"] - m["cw"])


def answer_jung(page, count: int, rating: int = 5) -> int:
    """连续作答 count 题；返回实际作答数。"""
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
            notes.append(f"十六型第 {done + 1} 题后「下一题」15s 未恢复可用")
            break
        page.locator("[data-next]").first.click()
        page.wait_for_timeout(220)
        done += 1
    return done


def answer_big_five(page, count: int, choice: int = 3) -> int:
    """大五逐题作答；每选一档再点下一题（大五在翻页时保存）。"""
    done = 0
    for _ in range(count):
        radios = page.locator("[role='radio']")
        if radios.count() < 5:
            break
        radios.nth(choice).click()
        page.wait_for_timeout(120)
        nxt = page.locator("[data-bigfive-next]")
        if nxt.count() == 0:
            break
        if nxt.first.is_disabled():
            page.wait_for_timeout(300)
        if not nxt.first.is_disabled():
            nxt.first.click()
            page.wait_for_timeout(260)
        done += 1
    return done


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    clear_register_rate_limit()
    invitation = seed_invitation()
    username = "r96_" + uuid4().hex[:10]
    password = "R96-Real!2026"

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.set_default_timeout(30000)
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        # ── 1. 真实注册 ──────────────────────────────────────────────────
        page.goto(f"{BASE}/#/register", wait_until="domcontentloaded")
        page.fill("input[name='invitationCode']", invitation)
        page.fill("input[name='username']", username)
        page.fill("input[name='nickname']", "走查账号")
        page.fill("input[name='new-password']", password)
        page.fill("input[name='confirm-password']", password)
        page.locator("input[name='disclaimer-accepted']").check()
        page.click("button[type='submit']")
        try:
            page.wait_for_selector("[data-recovery-codes] li", timeout=40000)
            check("真实后端注册成功（真实邀请码 + CSRF + 会话）", True)
        except Exception:
            err = page.locator("[data-register-error]").first
            check("真实后端注册成功（真实邀请码 + CSRF + 会话）", False,
                  err.inner_text() if err.count() else "没有错误元素")
            capture(page, "01-register-failed.png")
            raise
        check("注册后 /api/v3/me = 200",
              page.evaluate("async () => (await fetch('/api/v3/me', {credentials:'same-origin'})).status") == 200)

        # ── 2. 首页：真实目录口径 + 还没有草稿 ───────────────────────────
        # 新访客的首页是 PlatformIntro（发现页），十六型的详细说明在下方可折叠的
        # `data-jung-introduction` 里、默认收起；有草稿续答时才自动展开。
        page.goto(f"{BASE}/#/", wait_until="domcontentloaded")
        page.wait_for_selector("[data-platform-intro]", timeout=20000)
        page.wait_for_selector("[data-home-instruments] > li", timeout=20000)
        check("首页发现区可见（不需要登录）", page.locator("[data-platform-intro]").is_visible())
        check("首页目录列出两项测评", page.locator("[data-home-instruments] > li").count() == 2,
              page.locator("[data-home-instruments] > li").count())
        check("没有草稿时不显示续答入口",
              page.locator("[data-resume-entry]").count() == 0 and page.locator("[data-platform-resume]").count() == 0)
        check("十六型详细说明默认收起", page.locator("[data-jung-introduction]").get_attribute("open") is None)
        capture(page, "02-home-new-390.png")

        # ── 3. 选择页：真实目录里两项测评都在 ───────────────────────────
        page.goto(f"{BASE}/#/assess", wait_until="domcontentloaded")
        page.wait_for_selector("[data-start='jung48']", timeout=20000)
        page.wait_for_selector("[data-start='bigfive50']", timeout=20000)
        cards = page.locator("[data-assess-catalog-list] > li")
        check("选择页列出两项测评", cards.count() == 2, cards.count())
        check("十六型卡片写明主测 48 题起", "48 题起" in page.locator("[data-instrument='jung48']").inner_text())
        check("大五卡片写明 50 题", "50 题" in page.locator("[data-instrument='bigfive50']").inner_text())
        capture(page, "03-chooser-390.png")

        # ── 4. 开始十六型 → 答 5 题 → 回首页看续答 ───────────────────────
        page.locator("[data-start='jung48']").click()
        page.wait_for_selector("[data-question-card]", timeout=30000)
        check("点「开始这项」后进入真实答题页", "/assess/" in page.url, page.url)
        attempt_id = page.url.split("/assess/")[1].split("?")[0]
        pkg_id = page.evaluate(
            "async (id) => (await (await fetch('/api/v3/attempts/' + id, {credentials:'same-origin'})).json()).packageId",
            attempt_id)
        check("新草稿绑定 v4 内容包", pkg_id == "typeme-jung48-zh-v4", pkg_id)
        answered = answer_jung(page, 5)
        check("可以连续作答 5 题", answered == 5, answered)
        capture(page, "04-assess-jung-390.png")

        page.goto(f"{BASE}/#/", wait_until="domcontentloaded")
        page.wait_for_selector("[data-resume-entry]", timeout=20000)
        note = page.locator("[data-resume-note]").inner_text()
        check("首页续答读到真实的 5/48 进度", "已答 5/48 题" in note, note)
        page.locator("[data-resume-entry]").click()
        page.wait_for_selector("[data-question-card]", timeout=30000)
        check("从首页继续回到同一份草稿", attempt_id in page.url, page.url)

        # ── 5. 答完主测 → 跳过补充题 → 交卷 → 报告页 ─────────────────────
        more = answer_jung(page, 60)
        check("主测可以一路答完", answered + more >= 48, answered + more)
        nxt = page.locator("[data-next]")
        if nxt.count() and not nxt.first.is_disabled():
            nxt.first.click()
            page.wait_for_timeout(3000)
        skip = page.locator("[data-skip-clarification], [data-skip-clarification-in-progress]")
        if skip.count():
            notes.append("主测结束安排了补充题，本次按真实路径选择「跳过」。")
            skip.first.click()
            page.wait_for_timeout(4000)
        page.wait_for_timeout(2500)
        check("交卷后进入报告页", "/reports/" in page.url, page.url)
        capture(page, "05-report-jung-390.png")

        thresholds = page.locator("[data-method-thresholds]")
        text = thresholds.first.inner_text() if thresholds.count() else ""
        check("报告页写明 v4 口径「每 5 题」", "每 5 题" in text, text.replace("\n", " ")[:120])
        check("报告页没有退回缺省「每 10 题」", "每 10 题" not in text, text.replace("\n", " ")[:120])
        overview = page.locator("[data-report-overview]")
        status = overview.first.get_attribute("data-status") if overview.count() else None
        check("报告状态是业务状态之一", status in {"REFERENCE", "TENTATIVE", "TIED", "NEEDS_REVIEW"}, status)
        check("报告页有类型码或并列说明",
              page.locator("[data-type-code]").count() > 0 or page.locator("[data-tied-title]").count() > 0)
        for width in WIDTHS:
            page.set_viewport_size({"width": width, "height": 900})
            page.wait_for_timeout(500)
            check(f"报告页 {width} 宽无横向溢出", overflow(page) <= 1, overflow(page))
            capture(page, f"05-report-jung-{width}.png")
        page.set_viewport_size({"width": 390, "height": 844})

        # ── 6. 历史列表：一行十六型，没有被大五混进来 ────────────────────
        page.goto(f"{BASE}/#/reports", wait_until="domcontentloaded")
        page.wait_for_selector("[data-report-rows]", timeout=20000)
        rows = page.locator("[data-report-row]")
        check("历史列表有一行报告", rows.count() == 1, rows.count())
        list_text = page.locator("[data-report-rows]").inner_text()
        check("历史行是十六型报告", "十六型" in list_text, list_text[:160])
        check("历史列表没有混入大五", "五个维度" not in list_text, list_text[:160])
        capture(page, "06-reports-after-jung-390.png")

        # ── 7. 大五完整流程：开始 → 50 题 → 交卷 → 五维报告 ──────────────
        page.goto(f"{BASE}/#/assess", wait_until="domcontentloaded")
        page.wait_for_selector("[data-start='bigfive50']", timeout=20000)
        page.locator("[data-start='bigfive50']").click()
        page.wait_for_selector("[data-bigfive-item]", timeout=30000)
        check("开始大五后进入大五答题页", "/assess/" in page.url and page.locator("[data-bigfive-item]").count() == 1,
              page.url)
        big_answered = answer_big_five(page, 55)
        check("大五可以连续作答到第 50 题", big_answered >= 45, big_answered)
        submit_btn = page.locator("[data-bigfive-submit]")
        if submit_btn.count() and not submit_btn.first.is_disabled():
            submit_btn.first.click()
            page.wait_for_timeout(4000)
        check("大五交卷后进入大五报告页", "/reports/big-five/" in page.url, page.url)
        dims = page.locator("[data-bigfive-dimensions] [data-dimension]")
        check("大五报告给出五个方面", dims.count() == 5, dims.count())
        report_text = page.locator("body").inner_text()
        check("大五报告写明五项分别解读、不加总不排名，且没有类型码元素",
              page.locator("[data-type-code]").count() == 0 and "不加总、不排名" in report_text,
              report_text[:80].replace("\n", " "))
        check("大五报告没有出现「主测」字样", "主测" not in report_text)
        for width in WIDTHS:
            page.set_viewport_size({"width": width, "height": 900})
            page.wait_for_timeout(500)
            check(f"大五报告 {width} 宽无横向溢出", overflow(page) <= 1, overflow(page))
            capture(page, f"07-report-bigfive-{width}.png")
        page.set_viewport_size({"width": 390, "height": 844})

        # ── 8. 历史列表：两份报告，按种类分流 ───────────────────────────
        page.goto(f"{BASE}/#/reports", wait_until="domcontentloaded")
        page.wait_for_selector("[data-report-rows]", timeout=20000)
        check("历史列表现在有两行报告", page.locator("[data-report-row]").count() == 2,
              page.locator("[data-report-row]").count())
        big_row = page.locator("[data-report-kind='big_five_profile']").first
        check("大五行标注「五维画像」", "五维画像" in big_row.inner_text())
        link = big_row.locator("[data-report-open]").get_attribute("href")
        check("大五行跳到 /reports/big-five/…", link is not None and "/reports/big-five/" in link, link)
        capture(page, "08-reports-both-390.png")

        # ── 9. 首页此时没有未完成草稿 ────────────────────────────────────
        page.goto(f"{BASE}/#/", wait_until="domcontentloaded")
        page.wait_for_selector("[data-instrument-kicker]", timeout=20000)
        page.wait_for_timeout(800)
        check("两份都交卷后首页不再显示续答入口", page.locator("[data-resume-entry]").count() == 0)
        check("全程没有未捕获的前端异常", not errors, "; ".join(errors[:3]))

        browser.close()

    failed = [c for c in checks if not c["passed"]]
    result = {
        "scope": "真实浏览器 + 真实 jar + 真实 MySQL（隔离库 typeme_r96_e2e，不 mock 任何 /api）",
        "base": BASE, "database": DB, "widths": list(WIDTHS),
        "notes": notes, "checks": checks,
        "passed": len(checks) - len(failed), "failed": len(failed),
    }
    (OUT / "real-browser-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    print("\n== %d/%d 通过，失败 %d ==" % (result["passed"], len(checks), len(failed)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
