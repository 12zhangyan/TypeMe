"""第 98 轮：真实栈验证「比较页一侧无方向」与「交卷状态拆分」。

真实 jar + 真实 MySQL 隔离库 + 真实 Chromium，不 mock `/api`。

构造：
  A：EI 全选中间档（该维平分、没有方向），其余三维都指向正极（有方向）；
  B：四维都指向正极。
比较 A / B 时，EI 只有一侧有方向 —— 必须标成「一侧没有给出方向」，不能是「方向不同」。
同时直接读交卷响应，确认 `status=SUBMITTED`、`reportStatus` 是报告状态。
"""

from __future__ import annotations

import json
import subprocess
import sys
from hashlib import sha256
from pathlib import Path
from uuid import uuid4

from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:8096"
DB = "typeme_r98_e2e"
OUT = Path(__file__).resolve().parent
SHOTS = OUT / "shots"
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"

checks: list[dict] = []


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


API_JS = """
async ([method, path, body, headerName, token, idem]) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers[headerName] = token;
  if (idem) headers['Idempotency-Key'] = idem;
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers,
    body: body === null ? undefined : JSON.stringify(body),
  });
  let parsed = null;
  try { parsed = await res.json(); } catch (e) { parsed = null; }
  return { status: res.status, body: parsed };
}
"""


def rating_toward_positive(question: dict, positive_pole: str) -> int:
    """让这一题指向维度的正极：右侧是正极就选 5，否则选 1。"""
    return 5 if question["rightPole"] == positive_pole else 1


def answers_for(package: dict, tie_ei: bool) -> list[dict]:
    positives = {d["dimension"]: d["positivePole"]["pole"] for d in package["dimensions"]}
    responses = []
    for question in package["questions"]:
        if question["stage"] != "base":
            continue
        if tie_ei and question["dimension"] == "EI":
            rating = 3
        else:
            rating = rating_toward_positive(question, positives[question["dimension"]])
        responses.append({"questionId": question["id"], "kind": "RATING", "rating": rating})
    return responses


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    invitation = seed_invitation()
    username = "r98_" + uuid4().hex[:10]
    password = "R98-Real!2026"

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.set_default_timeout(30000)
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(f"{BASE}/#/register", wait_until="domcontentloaded")
        page.fill("input[name='invitationCode']", invitation)
        page.fill("input[name='username']", username)
        page.fill("input[name='nickname']", "比较走查")
        page.fill("input[name='new-password']", password)
        page.fill("input[name='confirm-password']", password)
        page.locator("input[name='disclaimer-accepted']").check()
        page.click("button[type='submit']")
        page.wait_for_selector("[data-recovery-codes] li", timeout=40000)
        check("真实注册成功", True)

        csrf = page.evaluate(
            "async () => (await (await fetch('/api/v3/auth/csrf', {credentials:'same-origin'})).json())")
        header_name, token = csrf["headerName"], csrf["token"]

        def api(method: str, path: str, body=None, idem: str | None = None) -> dict:
            return page.evaluate(API_JS, [method, path, body, header_name, token, idem])

        def build_report(tie_ei: bool, key: str, label: str) -> tuple[str, dict]:
            created = api("POST", "/api/v3/attempts", {}, f"r98-create-{key}-{uuid4().hex}")
            check(f"{label}：建测评 201", created["status"] == 201, created["status"])
            attempt_id = created["body"]["attemptId"]
            detail = api("GET", f"/api/v3/attempts/{attempt_id}")
            package = detail["body"]["packageContent"]
            responses = answers_for(package, tie_ei)
            patched = api("PATCH", f"/api/v3/attempts/{attempt_id}/answers", {
                "expectedRevision": detail["body"]["revision"],
                "responses": responses,
            })
            check(f"{label}：写入 {len(responses)} 条作答", patched["status"] == 200, patched["status"])
            submitted = api("POST", f"/api/v3/attempts/{attempt_id}/submit", {
                "expectedRevision": patched["body"]["revision"],
                "clarificationSkipped": True,
            }, f"r98-submit-{key}-{uuid4().hex}")
            check(f"{label}：交卷 201", submitted["status"] == 201, submitted["status"])
            return submitted["body"]["reportId"], submitted["body"]

        report_a, submit_a = build_report(True, "a", "A（EI 平分）")
        check("交卷响应的 status 是测评状态 SUBMITTED", submit_a.get("status") == "SUBMITTED",
              submit_a.get("status"))
        check("交卷响应把报告状态放在 reportStatus",
              submit_a.get("reportStatus") in {"REFERENCE", "TENTATIVE", "TIED"},
              submit_a.get("reportStatus"))

        report_b, submit_b = build_report(False, "b", "B（四维都有方向）")
        check("B 的报告状态是 REFERENCE", submit_b.get("reportStatus") == "REFERENCE",
              submit_b.get("reportStatus"))

        compared = api("GET", f"/api/v3/reports/compare?ids={report_a},{report_b}")
        check("比较接口 200", compared["status"] == 200, compared["status"])
        diffs = {row["dimension"]: row for row in compared["body"]["differences"]}
        ei = diffs.get("EI", {})
        check("服务端不再把「一侧无方向」标成 changed",
              ei.get("fromPole") is None and ei.get("toPole") is not None and ei.get("changed") is False,
              ei)
        sn = diffs.get("SN", {})
        check("两侧同向时 changed=false", sn.get("changed") is False, sn)

        page.goto(f"{BASE}/#/reports/compare?a={report_a}&b={report_b}", wait_until="domcontentloaded")
        page.wait_for_selector("[data-compare-result]", timeout=25000)
        ei_row = page.locator('[data-compare-row="EI"]').inner_text()
        check("比较页 EI 行写「一侧没有给出方向」", "一侧没有给出方向" in ei_row, ei_row[:160])
        check("比较页 EI 行不写「方向不同」", "方向不同" not in ei_row, ei_row[:160])
        sn_row = page.locator('[data-compare-row="SN"]').inner_text()
        check("比较页 SN 行写「方向一致」", "方向一致" in sn_row, sn_row[:160])
        page.screenshot(path=str(SHOTS / "compare-one-side-missing-390.png"), full_page=True)
        check("全程没有未捕获的前端异常", not errors, "; ".join(errors[:3]))
        browser.close()

    failed = [c for c in checks if not c["passed"]]
    result = {
        "scope": "真实栈：真 jar + 真 MySQL（隔离库 typeme_r98_e2e）+ 真 Chromium，不 mock /api",
        "base": BASE, "database": DB, "checks": checks,
        "passed": len(checks) - len(failed), "failed": len(failed),
    }
    (OUT / "real-stack-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    print("\n== %d/%d 通过，失败 %d ==" % (result["passed"], len(checks), len(failed)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
