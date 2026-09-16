"""核对用户反馈的场景：把 32 题都答成"两边相近"（S/N 恰好 24，距中点 0）。

目的：确认当前实现是否还会在 S/N 一分之内强行给出字母
（用户自认 ENFP 却得到 ESFP 的那个问题）。

用法：python scripts/_check_sn_boundary.py [base]
"""

from __future__ import annotations

import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5173"


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 390, "height": 900})
        errors: list[str] = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))

        page.goto(f"{BASE}/#/", wait_until="load")
        page.wait_for_timeout(1200)
        page.evaluate("() => localStorage.clear()")
        page.goto(f"{BASE}/#/quiz", wait_until="load")
        page.wait_for_timeout(1500)

        # 全部选中间档（"两边相近"），直到可以交卷
        for _ in range(60):
            radios = page.locator("[role='radio']")
            if radios.count() < 5:
                break
            radios.nth(2).click()
            page.wait_for_timeout(120)
            if "查看报告" in page.inner_text("body"):
                break
            nxt = page.locator("button:has-text('下一题')").locator("visible=true")
            if nxt.count() == 0:
                break
            nxt.first.click()
            page.wait_for_timeout(140)

        body_quiz = page.inner_text("body")
        print("交卷前状态含『查看报告』:", "查看报告" in body_quiz)

        submit = page.locator("button:has-text('查看报告')").locator("visible=true")
        if submit.count() > 0:
            submit.first.click()
            page.wait_for_timeout(3000)

        print("URL:", page.url)
        body = page.inner_text("body")
        print()
        print("=== 结果页关键表现 ===")
        checks = {
            "出现『未定』（不再强行给字母）": "未定" in body,
            "出现『两侧相近』": "两侧相近" in body,
            "点明接近中点/不确定": any(w in body for w in ["接近中点", "暂不确定", "没有主导侧"]),
            "仍然出现四字母类型码": any(code in body for code in ["ISFJ", "ESFJ", "ENFP", "INFP"]),
            "出现 ESFP 或 ENFP 字面": ("ESFP" in body) or ("ENFP" in body),
            "运行错误为空": not errors,
        }
        for label, ok in checks.items():
            print(("  PASS " if ok else "  FAIL ") + label)
        if errors:
            print("  errors:", errors[:3])

        print()
        print("=== 结果页前 40 行文本 ===")
        for line in [l for l in body.splitlines() if l.strip()][:40]:
            print("  |", line.strip()[:80])

        page.screenshot(path="docs/2026-09-15/verification/19-sn-boundary-current.png", full_page=True)
        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
