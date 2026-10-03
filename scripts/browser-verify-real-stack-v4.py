#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""第 31 轮：**真实后端**上的报告页阈值验收（不是 mock）。

为什么单开这一条：`scripts/browser-verify-score-v4.py` 把 `/api/**` 全部 mock 了，
它能回答"前端拿到这份 JSON 会怎么渲染"，**不能**回答"后端真的会下发这份 JSON 吗"。
而阈值文案（"有效作答每 5 题…"）恰恰依赖后端下发 `methodology.boundaryNumerator /
boundaryDenominator`；一旦后端漏发，前端会退回缺省值（每 10 题），
mock 版验收仍然全绿 —— 这就是那类"越验越安心、其实没验到"的缺口。

本脚本走**真实浏览器 + 真实 jar + 真实 MySQL（隔离库）**：
  注册（真实邀请码/CSRF/会话）→ 开始测评 → 逐题作答 → 跳过补充题 → 交卷 → 读报告页。

环境变量：
    TYPEME_BASE  被验收地址（默认 http://127.0.0.1:8099）
    TYPEME_DB    隔离库名（默认 typeme_r31_e2e；只用来插一行邀请码）
    TYPEME_OUT   证据目录（默认 docs/optimization/verification/2026-09-22-real-stack）

纪律：账号名与密码为脚本生成的合成值，不写入报告；恢复码不落盘、不入截图。
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from hashlib import sha256
from pathlib import Path
from uuid import uuid4

from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get("TYPEME_BASE", "http://127.0.0.1:8099")
DB = os.environ.get("TYPEME_DB", "typeme_r31_e2e")
OUT = Path(os.environ.get("TYPEME_OUT", ROOT / "docs/optimization/verification/2026-09-22-real-stack"))
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"

WIDTHS = [320, 390, 1440]
checks: list[dict] = []
notes: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> bool:
    checks.append({"label": label, "passed": bool(ok), "detail": str(detail)})
    print(("PASS  " if ok else "FAIL  ") + label + (("  :: " + str(detail)) if detail else ""))
    return bool(ok)


def mysql(sql: str) -> str:
    proc = subprocess.run([MYSQL, "-h", "127.0.0.1", "-P", "3306", "-uroot", "-p123456", "-N",
                           "--default-character-set=utf8mb4", "-e", sql],
                          capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise RuntimeError("mysql failed: " + proc.stderr)
    return proc.stdout


def seed_invitation() -> str:
    code = uuid4().hex  # 32 位，符合注册页的 [A-Za-z0-9_-]{32} 校验
    mysql("INSERT INTO {db}.registration_invitation(id, code_hash, created_at, expires_at) VALUES "
          "('{i}', '{h}', NOW(6), DATE_ADD(NOW(6), INTERVAL 1 HOUR))".format(
              db=DB, i=uuid4(), h=sha256(code.encode()).hexdigest()))
    return code


def clear_register_rate_limit() -> str:
    """清掉隔离库里**注册**这一个操作的限流桶。

    为什么需要：验收会反复跑，而注册按来源 IP 有一段固定窗口限流（本轮实测撞到 429，
    `retryAfterSeconds≈2370`）。限流本身是**正确行为**，不是缺陷；但同一条验收脚本
    连跑几次就会被它挡住，红的原因与代码无关。

    边界：**只动隔离库**（DB 默认 typeme_r31_e2e），且只删 register 这一个桶；
    不碰任何别的库、不动登录/找回等其它操作的计数。
    """
    before = mysql(f"SELECT COUNT(*) FROM {DB}.rate_limit_bucket WHERE bucket_key LIKE 'register:%';")
    mysql(f"DELETE FROM {DB}.rate_limit_bucket WHERE bucket_key LIKE 'register:%';")
    return before.strip()


def capture(page, name: str) -> None:
    page.screenshot(path=str(OUT / name), full_page=True)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    cleared = clear_register_rate_limit()
    notes.append(f"启动前清掉隔离库的 register 限流桶（删除前条数 {cleared}）—— 限流本身是正确行为，"
                 "不清理会让重复跑同一条验收时红在 429 上")
    invitation = seed_invitation()
    username = "r31b_" + uuid4().hex[:10]
    password = "R31-Browser!2026"

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.set_default_timeout(30000)
        console_errors: list[str] = []
        page.on("pageerror", lambda e: console_errors.append(str(e)))

        # ── 1. 真实注册（真实表单 + 真实邀请码）─────────────────────────────
        page.goto(f"{BASE}/#/register", wait_until="domcontentloaded")
        page.fill("input[name='invitationCode']", invitation)
        page.fill("input[name='username']", username)
        page.fill("input[name='nickname']", "验收账号")
        page.fill("input[name='new-password']", password)
        page.fill("input[name='confirm-password']", password)
        page.locator("input[name='disclaimer-accepted']").check()
        page.wait_for_timeout(300)
        page.click("button[type='submit']")
        try:
            page.wait_for_selector("[data-recovery-codes] li", timeout=40000)
            check("真实后端上注册成功（真实邀请码 + 真实会话）", True)
        except Exception:
            err = page.locator("[data-register-error]")
            detail = err.first.inner_text() if err.count() else "(没有错误元素)"
            check("真实后端上注册成功（真实邀请码 + 真实会话）", False, detail)
            capture(page, "90-register-failed-390.png")
            raise
        notes.append("注册响应里的恢复码只核对条数，不保存内容")
        check("注册后会话可用（/api/v3/me = 200）",
              page.evaluate("async () => (await fetch('/api/v3/me', {credentials:'same-origin'})).status") == 200)

        # ── 2. 开始测评（真实建测评）─────────────────────────────────────
        # `/assess` 是**选择页**（未答完的 + 可开始的），不是“进去就建一份草稿”；
        # 真实用户路径就是在这里点“开始十六型测评”。
        page.goto(f"{BASE}/#/assess", wait_until="domcontentloaded")
        page.wait_for_selector("[data-start='jung48']", timeout=20000)
        page.locator("[data-start='jung48']").click()
        page.wait_for_timeout(3000)
        check("在选择页点开始 → 真实建出测评并进入 /assess/{id}", "/assess/" in page.url, page.url)
        attempt_id = page.url.split("/assess/")[1].split("?")[0] if "/assess/" in page.url else ""

        # 真实接口下这份测评必须绑在 v4 上
        pkg_id = page.evaluate(
            "async (id) => (await (await fetch('/api/v3/attempts/' + id, {credentials:'same-origin'})).json()).packageId",
            attempt_id)
        check("真实后端把这份草稿绑到 typeme-jung48-zh-v4", pkg_id == "typeme-jung48-zh-v4", pkg_id)

        # ── 3. 逐题作答（真实服务端往返）────────────────────────────────────
        answered = 0
        for _ in range(80):
            nxt = page.locator("[data-next]")
            if nxt.count() == 0:
                break
            if "完成主测" in nxt.first.inner_text():
                break
            cell = page.locator(".option-cell[data-rating='1']")
            if cell.count() == 0:
                break
            cell.first.click()
            page.wait_for_timeout(120)
            try:
                page.wait_for_function(
                    """() => { const b = document.querySelector('[data-next]');
                               return b !== null && !b.disabled; }""", timeout=15000)
            except Exception:
                notes.append(f"第 {answered + 1} 题后「下一题」15s 内未恢复可用")
                break
            page.locator("[data-next]").first.click()
            page.wait_for_timeout(250)
            answered += 1
        check("能连续作答到主测结束", answered >= 40, f"实际 {answered} 题")
        capture(page, "10-assess-390.png")

        # ── 4. 跳过补充题 → 交卷 ────────────────────────────────────────────
        final_cell = page.locator(".option-cell[data-rating='1']")
        if final_cell.count() > 0:
            final_cell.first.click()
        page.wait_for_timeout(1500)
        final_next = page.locator("[data-next]")
        if final_next.count() > 0 and not final_next.first.is_disabled():
            final_next.first.click()
            page.wait_for_timeout(3500)
        skip = page.locator("button:has-text('跳过')")
        if skip.count() > 0:
            notes.append("主测结束时确实安排了补充题，本次按真实路径选择「跳过」")
            skip.first.click()
            page.wait_for_timeout(4000)
        else:
            notes.append("主测结束时没有安排补充题（本次答卷各维都不在边界内）")
        page.wait_for_timeout(3000)
        check("交卷后进入报告详情页", "/reports/" in page.url, page.url)

        # ── 5. 报告页：阈值文案必须来自后端下发的政策 ────────────────────────
        thresholds = page.locator("[data-method-thresholds]")
        check("报告页有阈值说明元素（data-method-thresholds）", thresholds.count() > 0)
        text = thresholds.first.inner_text() if thresholds.count() else ""
        check("真实后端下报告页写明 v4 口径「有效作答每 5 题」",
              "每 5 题" in text, text.replace("\n", " ")[:120])
        check("真实后端下报告页没有退回缺省口径「每 10 题」", "每 10 题" not in text,
              text.replace("\n", " ")[:120])
        overview = page.locator("[data-report-overview]")
        check("报告页有状态区（data-report-overview）", overview.count() > 0)
        status = overview.first.get_attribute("data-status") if overview.count() else None
        check("报告状态是可识别的业务状态（不是空）",
              status in {"REFERENCE", "TENTATIVE", "TIED", "NEEDS_REVIEW"}, status)
        check("报告页有类型码或并列说明（结论层渲染完整）",
              page.locator("[data-type-code]").count() > 0 or page.locator("[data-tied-title]").count() > 0)
        check("整页没有未捕获的前端异常", not console_errors, "; ".join(console_errors[:3]))
        capture(page, "20-report-390.png")

        # ── 6. 三档宽度：不横向溢出 ─────────────────────────────────────────
        for width in WIDTHS:
            page.set_viewport_size({"width": width, "height": 900})
            page.wait_for_timeout(600)
            overflow = page.evaluate(
                "() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})")
            check(f"{width} 宽无横向溢出", overflow["sw"] <= overflow["cw"] + 1, overflow)
            t = page.locator("[data-method-thresholds]")
            check(f"{width} 宽阈值文案仍是「每 5 题」", t.count() > 0 and "每 5 题" in t.first.inner_text())
            capture(page, f"20-report-{width}.png")

        browser.close()

    failed = [c for c in checks if not c["passed"]]
    result = {
        "scope": "真实浏览器 + 真实 jar + 真实 MySQL（隔离库）+ 真实会话；不 mock 任何 /api",
        "base": BASE, "database": DB, "widths": WIDTHS,
        "notes": notes, "checks": checks,
        "passed": len(checks) - len(failed), "failed": len(failed),
    }
    (OUT / "browser-results.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    print("\n== %d/%d 通过，失败 %d ==" % (result["passed"], len(checks), len(failed)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
