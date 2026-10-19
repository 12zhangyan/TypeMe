"""第 97 轮补充：真实栈账号与异常路径。

真实 jar + 真实 MySQL 隔离库（`typeme_r97_e2e`）+ 真实 Chromium；不 mock 任何 /api。

覆盖：
  1. 注册 → 完成一份十六型测评（48 题 + 跳过补充题）→ 报告页；
  2. 账号页导出：真实下载 JSON，校验结构、`degradedSections` 为空、页面说"都在里面"；
  3. 改昵称：成功后账号页与 `/me` 同步；
  4. 改密码输错当前密码：错误里带服务端的精确说法（不是登录页的"用户名或密码不对"）；
  5. 删除报告：列表行消失；再用旧链接打开显示"报告打不开了"而不是"还没做完"；
  6. 会话被服务端注销后继续作答：页面给出去登录的回路，且不谎称"已保存"。
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
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


def main() -> int:
    invitation = seed_invitation()
    username = "r97e_" + uuid4().hex[:10]
    password = "R97-Edge!2026"

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 390, "height": 844}, accept_downloads=True)
        page = context.new_page()
        page.set_default_timeout(30000)
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        # ── 1. 注册 + 完成一份测评 ─────────────────────────────────────
        page.goto(f"{BASE}/#/register", wait_until="domcontentloaded")
        page.fill("input[name='invitationCode']", invitation)
        page.fill("input[name='username']", username)
        page.fill("input[name='nickname']", "边界走查")
        page.fill("input[name='new-password']", password)
        page.fill("input[name='confirm-password']", password)
        page.locator("input[name='disclaimer-accepted']").check()
        page.click("button[type='submit']")
        page.wait_for_selector("[data-recovery-codes] li", timeout=40000)
        user_id = page.evaluate(
            "async () => (await (await fetch('/api/v3/me', {credentials:'same-origin'})).json()).userId")
        check("注册成功并拿到 userId", bool(user_id), user_id)

        page.goto(f"{BASE}/#/assess", wait_until="domcontentloaded")
        page.wait_for_selector("[data-start='jung48']", timeout=20000)
        page.locator("[data-start='jung48']").click()
        page.wait_for_selector("[data-question-card]", timeout=30000)
        answer_jung(page, 60, rating=5)
        skip = page.locator("[data-skip-clarification]")
        if skip.count():
            skip.first.click()
            page.wait_for_timeout(4000)
        page.wait_for_timeout(1500)
        check("第一份报告生成", "/reports/" in page.url, page.url)
        report_id = page.url.split("/reports/")[1].split("?")[0] if "/reports/" in page.url else ""

        # ── 2. 导出真实 JSON ──────────────────────────────────────────
        page.goto(f"{BASE}/#/account", wait_until="domcontentloaded")
        page.wait_for_selector("text=导出数据", timeout=20000)
        with tempfile.TemporaryDirectory() as tmp:
            with page.expect_download(timeout=30000) as download_info:
                page.get_by_role("button", name="导出我的数据").click()
            download = download_info.value
            saved = Path(tmp) / "export.json"
            download.save_as(str(saved))
            payload = json.loads(saved.read_text(encoding="utf-8"))
            check("导出的是 JSON 文件", download.suggested_filename.endswith(".json"),
                  download.suggested_filename)
            check("导出包含账号资料与解包后的测评/报告",
                  payload.get("profile", {}).get("username", "").lower() == username.lower()
                  and isinstance(payload.get("attempts"), list)
                  and isinstance(payload.get("reports"), list),
                  list(payload.keys()))
            check("导出没有降级段落（是完整备份）", payload.get("degradedSections") == [],
                  payload.get("degradedSections"))
            check("导出里确有这次测评的答案与报告",
                  any(item.get("answers") for item in payload.get("attempts", []))
                  and any(item.get("id") for item in payload.get("reports", [])),
                  f"attempts={len(payload.get('attempts', []))} reports={len(payload.get('reports', []))}")
            check("导出不含密码/恢复码/会话",
                  isinstance(payload.get("excluded"), list)
                  and {"passwordHash", "recoveryCodeHash", "sessions"} <= set(payload["excluded"]),
                  payload.get("excluded"))
        success = page.locator(".notice-success").filter(has_text="都在里面")
        check("页面说这份备份是完整的", success.count() >= 1,
              success.first.inner_text()[:80] if success.count() else "(没有成功提示)")

        # ── 3. 改昵称：页面与 /me 同步 ────────────────────────────────
        nickname = "新昵称" + uuid4().hex[:4]
        page.fill("input[name='nickname']", nickname)
        page.get_by_role("button", name="保存昵称").click()
        page.wait_for_timeout(1200)
        me = page.evaluate(
            "async () => (await (await fetch('/api/v3/me', {credentials:'same-origin'})).json())")
        check("改昵称后 /me 返回新昵称", me.get("nickname") == nickname, me.get("nickname"))
        check("改昵称后输入框与提示都是新昵称",
              page.input_value("input[name='nickname']") == nickname
              and "昵称已经改好了" in page.locator("body").inner_text(),
              page.input_value("input[name='nickname']"))

        # ── 4. 改密码输错当前密码：服务端说明要原样出现 ────────────────
        page.fill("input[name='current-password']", "Wrong-Current!2026")
        page.fill("input[name='new-password']", "Another-Pass!2026")
        page.fill("input[name='confirm-password']", "Another-Pass!2026")
        page.get_by_role("button", name="修改密码").click()
        page.wait_for_timeout(1500)
        err = page.locator("[data-account-error-password]")
        err_text = err.first.inner_text() if err.count() else ""
        check("改密码错误显示在该区块", err.count() == 1, err_text[:100])
        check("错误里带服务端原话（当前密码不正确）", "当前密码不正确" in err_text, err_text[:140])

        # ── 5. 删除报告：旧链接要如实说打不开 ─────────────────────────
        page.goto(f"{BASE}/#/reports", wait_until="domcontentloaded")
        page.wait_for_selector(f"[data-report-row='{report_id}']", timeout=20000)
        page.locator(f"[data-delete-report='{report_id}']").click()
        page.get_by_role("button", name="删除", exact=True).last.click()
        page.wait_for_timeout(2500)
        check("删除后列表里没有这份报告",
              page.locator(f"[data-report-row='{report_id}']").count() == 0)
        page.goto(f"{BASE}/#/reports/{report_id}", wait_until="domcontentloaded")
        page.wait_for_timeout(2000)
        body = page.locator("body").inner_text()
        check("旧链接如实说报告打不开",
              ("打不开" in body or "不存在" in body or "已经删除" in body),
              body[:200].replace("\n", " "))
        check("旧链接不会被说成「还没做完」", "还没做完" not in body, body[:200].replace("\n", " "))

        # ── 6. 会话被服务端注销后继续作答 ─────────────────────────────
        page.goto(f"{BASE}/#/assess", wait_until="domcontentloaded")
        page.wait_for_selector("[data-start='jung48']", timeout=20000)
        page.locator("[data-start='jung48']").click()
        page.wait_for_selector("[data-question-card]", timeout=30000)
        answer_jung(page, 1, rating=4)
        # 服务端注销这个账号的全部会话（模拟过期/被清掉）
        mysql(f"DELETE FROM {DB}.app_user_session WHERE user_id = '{user_id}';")
        page.locator(".option-cell[data-rating='3']").first.click()
        page.wait_for_timeout(2500)
        url_now = page.url
        page_text = page.locator("body").inner_text()
        went_to_login = "/login" in url_now
        check("会话失效后页面给出去登录的回路",
              went_to_login or "登录" in page_text,
              f"url={url_now} text={page_text[:120]}".replace("\n", " "))
        save_state = page.locator("[data-save-state]")
        state_text = save_state.first.inner_text() if save_state.count() else ""
        check("会话失效时不会谎称「已保存」", "已保存" not in state_text, state_text)
        capture(page, "01-session-expired-390.png")

        check("全程没有未捕获的前端异常", not errors, "; ".join(errors[:3]))
        context.close()
        browser.close()

    failed = [c for c in checks if not c["passed"]]
    result = {
        "scope": "真实栈账号与异常路径（真实 jar + 真实 MySQL 隔离库 + 真实 Chromium，不 mock /api）",
        "base": BASE, "database": DB, "notes": notes,
        "checks": checks, "passed": len(checks) - len(failed), "failed": len(failed),
    }
    (OUT / "real-stack-edges-result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    print("\n== %d/%d 通过，失败 %d ==" % (result["passed"], len(checks), len(failed)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
