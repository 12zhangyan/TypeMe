"""TypeMe 持续优化验收：管理后台 · AI 设置页（2026-09-17）。

用法（项目根目录）：

    python scripts/browser-verify-admin.py            # 分两段跑，中间由调用方重启后端
    python scripts/browser-verify-admin.py --phase1   # 只注册 + 验"非管理员看不到入口"
    python scripts/browser-verify-admin.py --phase2   # 验管理员能读能写

为什么要分两段：管理员是**启动期引导**出来的（`typeme.admin.bootstrap-username`
只在"系统里一个 ADMIN 都没有"时把指定账号提升为 ADMIN），所以顺序必须是
"先有账号 → 再重启后端"。脚本没法自己重启后端（那是运行环境的事），
所以把这一步显式交给调用方，并把账号名写进 <TYPEME_OUT>/account.txt 供第二段复用。

前置：
    - 一个**可写的一次性测试后端**（建议文件型 H2：内存库重启就没了）；
    - `TYPEME_SECURITY_SETTINGS_SECRET` 必须配置，否则"保存密钥"会按设计返回 503；
    - 第一段与第二段必须指向**同一个数据库**。不要指向真实库。

环境变量：TYPEME_BASE / TYPEME_OUT / TYPEME_LABEL，含义同其他验收脚本。
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
        ROOT / "docs" / "optimization" / "verification" / "2026-09-17-admin",
    )
)
BASE = os.environ.get("TYPEME_BASE", "http://127.0.0.1:5174")
BASE_LABEL = os.environ.get("TYPEME_LABEL", "")

NARROW = {"width": 320, "height": 568}
MOBILE = {"width": 390, "height": 844}
DESKTOP = {"width": 1440, "height": 900}

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


def skip(label: str, why: str) -> None:
    skips.append(f"{label} —— {why}")
    print(f"  SKIP {label} —— {why}")


def capture(page: Page, name: str) -> None:
    page.screenshot(path=str(OUT / name))


def go(page: Page, hash_path: str) -> None:
    page.goto(f"{BASE}/#{hash_path}", wait_until="domcontentloaded")
    page.wait_for_timeout(500)


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


def register_and_open_account(page: Page) -> tuple[str, str]:
    """注册一个测试账号，停在账号页。返回 (用户名, 密码)。"""
    username = f"adm_{secrets.token_hex(4)}"
    password = f"Vf-{secrets.token_hex(6)}"
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
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "account.txt").write_text(f"{username}\n{password}\n", encoding="utf-8")
    return username, password


def login(page: Page, username: str, password: str) -> None:
    go(page, "/login")
    page.fill("input[name='username']", username)
    page.fill("input[name='password']", password)
    page.click("button[type='submit']")
    page.wait_for_timeout(2000)


def phase1(page: Page, username: str, password: str) -> None:
    print("\n[1] 普通账号：看不到后台入口，直接访问也拿不到内容")
    go(page, "/account")
    page.wait_for_timeout(1500)
    check(
        page.locator("[data-admin-entry]").count() == 0,
        "账号页**不显示**管理后台入口（普通用户）",
    )

    go(page, "/admin")
    page.wait_for_selector("[data-admin-checking], [data-admin-denied], [data-admin-unavailable]", timeout=20000)
    page.wait_for_timeout(1200)
    check(page.locator("[data-admin-denied]").count() == 1, "直接打开 /admin → 显示「只对管理员开放」")
    check(
        page.locator("[data-admin-summary]").count() == 0,
        "没有权限时**不显示**任何设置内容",
    )
    denied_text = page.locator("[data-admin-denied]").inner_text() if page.locator("[data-admin-denied]").count() else ""
    check("不是加载失败" in denied_text, "并明确说明这不是加载失败")
    check("bootstrap-username" in denied_text, "并给出获得权限的具体办法（bootstrap 配置项）")
    capture(page, "10-admin-denied-390.png")
    if page.locator("[data-admin-unavailable]").count() == 1:
        # 后端没连上时也要能自证：这条分支本身就说明"没问到"和"没权限"分开了。
        notes.append("后端未就绪，denied 分支未覆盖")


def phase2(page: Page, username: str, password: str) -> None:
    print("\n[2] 管理员（已由后端启动引导提升）：能读能写")
    login(page, username, password)
    go(page, "/account")
    page.wait_for_timeout(2000)
    entry = page.locator("[data-admin-entry]")
    if entry.count() == 0:
        # 权限探测没成功：可能是后端没配 bootstrap，或后端没重启。
        probe = page.evaluate(
            """async () => {
                const r = await fetch('/api/v3/admin/ai-settings', { credentials: 'include' });
                return r.status;
            }"""
        )
        skip("管理后台写路径验收", f"账号 {username} 不是管理员（GET /admin/ai-settings → {probe}）")
        notes.append(
            "第二段需要后端以 typeme.admin.bootstrap-username=<第一段注册的账号> 重启一次；"
            "本次没做到，因此管理员写路径未被真实验证。"
        )
        capture(page, "20-account-no-admin-entry-390.png")
        return

    check(True, "账号页出现「管理后台」入口（管理员）")
    entry.locator("a").first.click()
    page.wait_for_timeout(1800)
    check("#/admin" in page.url, "点入口进入 /admin", page.url)
    page.wait_for_selector("[data-admin-summary]", timeout=20000)
    check(True, "后台设置页载入成功（非 denied）")
    capture(page, "21-admin-settings-390.png")

    # ── 只写不读：密钥输入框必须是空的 ───────────────────────────────
    key_input = page.locator("[data-admin-key-input]")
    check(key_input.count() == 1, "有密钥输入框")
    check((key_input.input_value() or "") == "", "密钥输入框是空的（不预填已保存的密钥）")
    page_text = page.locator("main").inner_text()
    check("sk-" not in page_text, "页面文本里不出现任何密钥值")
    check(page.locator("[data-admin-key-fingerprint]").count() == 1, "显示密钥指纹（用于确认换没换）")

    # ── 未改动时不能保存 ────────────────────────────────────────────
    save = page.locator("[data-admin-save]")
    check(save.is_disabled(), "没有改动时「保存设置」被禁用")
    check("还没有改动" in page.locator("[data-admin-dirty]").inner_text(), "并说明原因")

    # ── 改一项数字 → 保存 → 刷新后仍在 ──────────────────────────────
    before = page.locator("[data-admin-number='dailyLimitPerUser']").input_value()
    new_value = "4" if before != "4" else "5"
    page.locator("[data-admin-number='dailyLimitPerUser']").fill(new_value)
    page.wait_for_timeout(400)
    check(not save.is_disabled(), "改动后可以保存")
    dirty = page.locator("[data-admin-dirty]").inner_text()
    check("dailyLimitPerUser" in dirty, "提示里列出将提交的字段名", dirty)
    save.click()
    page.wait_for_selector("[data-admin-saved]", timeout=20000)
    check(True, "保存成功并给出反馈")
    check(
        page.locator("[data-admin-number='dailyLimitPerUser']").input_value() == new_value,
        "保存后表单显示的是服务端回写的值",
    )

    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("[data-admin-number='dailyLimitPerUser']", timeout=20000)
    page.wait_for_timeout(1200)
    check(
        page.locator("[data-admin-number='dailyLimitPerUser']").input_value() == new_value,
        "刷新后仍是新值（确实写进了服务端，不是只改了本地表单）",
    )
    check(
        "还没有人在后台改过" not in page.locator("[data-admin-updated]").inner_text(),
        "「最近修改」有了记录",
    )

    # ── 还回去，避免留下被改过的测试环境 ───────────────────────────
    page.locator("[data-admin-number='dailyLimitPerUser']").fill(before)
    page.wait_for_timeout(400)
    page.locator("[data-admin-save]").click()
    page.wait_for_selector("[data-admin-saved]", timeout=20000)
    page.wait_for_timeout(600)
    check(
        page.locator("[data-admin-number='dailyLimitPerUser']").input_value() == before,
        f"已把该值改回原值 {before}（不给测试环境留改动）",
    )

    # ── 非法输入被拦住 ──────────────────────────────────────────────
    page.locator("[data-admin-number='maxTokens']").fill("0")
    page.wait_for_timeout(400)
    check(page.locator("[data-admin-save]").is_disabled(), "填 0 时保存被禁用")
    check("要填正整数" in page.locator("main").inner_text(), "并逐字段说明原因")
    page.locator("[data-admin-number='maxTokens']").fill("")

    # ── 缺协议的 baseUrl 被拦住 ─────────────────────────────────────
    page.locator("[data-admin-base-url]").fill("api.example.com")
    page.wait_for_timeout(400)
    check(page.locator("[data-admin-save]").is_disabled(), "baseUrl 缺协议时保存被禁用")
    check("http:// 或 https://" in page.locator("main").inner_text(), "并说明要填完整地址")
    page.locator("[data-admin-base-url]").fill("")
    page.wait_for_timeout(300)

    # ── 用户概览：只读 ──────────────────────────────────────────────
    users = page.locator("[data-admin-users]")
    check(users.count() == 1, "显示账号概览表")
    check(page.locator(f"[data-admin-user='{username}']").count() == 1, "表里有当前账号")
    check(users.locator("button").count() == 0, "概览是只读的（没有改角色/禁用按钮）")
    check("不提供" in page.locator("main").inner_text(), "并说明为什么没有这些操作")

    # ── 布局：320 / 1440 ───────────────────────────────────────────
    for label, viewport, shot in (("320px", NARROW, "22-admin-320.png"), ("1440px", DESKTOP, "23-admin-1440.png")):
        page.set_viewport_size(viewport)
        page.wait_for_timeout(500)
        overflow = overflow_report(page)
        check(not overflow, f"{label} 后台页没有横向溢出", overflow)
        capture(page, shot)

    page.set_viewport_size(MOBILE)
    page.wait_for_timeout(300)


def load_previous() -> dict:
    """读上一段的结果。

    分两段跑时第二段会重新写 REPORT.md，如果直接覆盖，第一段的 5 项断言就从证据里消失了
    （报告看起来只有第二段）。所以这里把上一段的计数合并进来 —— 证据文件必须反映
    **跑过的全部内容**，否则它就不再是证据。

    ⚠️ 同一个 phase 跑第二遍会**重复计数**（上一段的数字里已经含了这一遍要加的）。
    所以重跑某一段时必须带 `--reset`，否则数字会虚高 —— 一个虚高的通过数比没有数字更糟。
    """
    path = OUT / "result.json"
    if not path.exists():
        return {"passed": 0, "failed": [], "skipped": [], "notes": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {"passed": 0, "failed": [], "skipped": [], "notes": []}
    return {
        "passed": int(data.get("passed", 0)),
        "failed": list(data.get("failed", [])),
        "skipped": list(data.get("skipped", [])),
        "notes": list(data.get("notes", [])),
    }


def main() -> int:
    args = sys.argv[1:]
    OUT.mkdir(parents=True, exist_ok=True)
    if "--reset" not in args:
        previous = load_previous()
        passed[0] = previous["passed"]
        failures.extend(previous["failed"])
        skips.extend(previous["skipped"])
        notes.extend(previous["notes"])
        if previous["passed"]:
            print(f"已合并上一段结果：PASS {previous['passed']} / FAIL {len(previous['failed'])}")
    else:
        print("--reset：从零开始计数（同一段重跑时必须这样，避免重复计数）")
    print(f"被验收地址：{BASE}{(' （' + BASE_LABEL + '）') if BASE_LABEL else ''}")
    print(f"截图目录：{OUT}")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            page = browser.new_page(viewport=MOBILE)
            page.set_default_timeout(20000)

            if "--phase2" in args:
                if not (OUT / "account.txt").exists():
                    print("找不到 account.txt：请先跑 --phase1 并确保用的是同一个数据库。")
                    return 2
                username, password = (OUT / "account.txt").read_text(encoding="utf-8").split()
                phase2(page, username, password)
            elif "--phase1" in args:
                username, password = register_and_open_account(page)
                print(f"  已注册测试账号：{username}")
                phase1(page, username, password)
            else:
                username, password = register_and_open_account(page)
                print(f"  已注册测试账号：{username}")
                phase1(page, username, password)
                notes.append("单次运行时不会重启后端，因此管理员写路径不会被验证；请分两段跑。")
        finally:
            browser.close()

    outcome = "PASS" if not failures else "FAIL"
    lines = [
        "# 真实浏览器验收：管理后台 · AI 设置（2026-09-17）",
        "",
        f"- 被验收地址：`{BASE}`" + (f"（{BASE_LABEL}）" if BASE_LABEL else ""),
        f"- 结论：**{outcome}**（PASS {passed[0]} / FAIL {len(failures)} / SKIP {len(skips)}）",
        "",
    ]
    if notes:
        lines += ["## 观察记录", ""] + [f"- {note}" for note in notes] + [""]
    if skips:
        lines += ["## 跳过项", ""] + [f"- {item}" for item in skips] + [""]
    if failures:
        lines += ["## 失败项", ""] + [f"- {item}" for item in failures] + [""]
    lines += [
        "## 说明",
        "",
        "- 断言的是页面上真实出现的东西（`data-admin-*` 钩子与文案），不是组件内部 state。",
        "- 特意断言：普通账号看不到入口、直接访问 /admin 得到「不是加载失败」的权限说明、",
        "  密钥输入框为空、页面文本里不出现 `sk-`、未改动时不能保存、非法值被拦住、",
        "  账号概览里没有改角色/禁用按钮。",
        "- 改完的值会被改回原值，不给测试环境留改动。",
        "",
    ]
    (OUT / "REPORT.md").write_text("\n".join(lines), encoding="utf-8")
    (OUT / "result.json").write_text(
        json.dumps(
            {"base": BASE, "passed": passed[0], "failed": failures, "skipped": skips, "notes": notes},
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
