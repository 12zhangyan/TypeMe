"""TypeMe 验收：账号页（A38 服务端原文 / A39 按钮层级 / A59 报障编号用法一句话）。

用法（项目根目录，需要 Vite dev server + 后端都已启动）：

    python scripts/browser-verify-account-page.py

环境变量：
    TYPEME_BASE（默认 http://127.0.0.1:5176）
    TYPEME_OUT （默认 docs/optimization/verification/2026-09-18-account-page）

看什么：
    1. **A38**：在「修改密码」里故意输错当前密码 —— 服务端给的原话（「当前密码不正确。」）
       必须露在页面上。这一页曾经把它整段丢掉，只剩给登录页写的「用户名或密码不对」，
       而这几个表单里根本没有用户名字段。
    2. **A59**：同一次失败里必须带上「反馈问题时把这个编号一起发过来」——
       这句之前因为"布尔 prop 缺省被 Vue 转成 false"而**在所有页面都没渲染过**。
    3. **A39**：这一页是平权的六个设置区块，不该有主色按钮（原来「修改密码」是唯一的
       `btn-primary`，等于暗示它是这一页最该做的事）；真正危险的动作必须是 danger 色，
       而且要点开面板 + 勾确认 + 输密码才能按。
    4. 320 / 390 / 1440 三个宽度下无横向溢出、五个区块的动作都够大够得着。
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
        ROOT / "docs" / "optimization" / "verification" / "2026-09-18-account-page",
    )
)
BASE = os.environ.get("TYPEME_BASE", "http://127.0.0.1:5176")

VIEWPORTS = [("320", 320, 720), ("390", 390, 844), ("1440", 1440, 900)]

failures: list[str] = []
skips: list[str] = []
notes: list[str] = []
passed = [0]
shots: list[str] = []


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
    shots.append(name)


def register(page: Page, username: str, password: str) -> None:
    page.goto(f"{BASE}/#/register", wait_until="domcontentloaded")
    page.wait_for_timeout(600)
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


def measure_layout(page: Page) -> dict:
    return page.evaluate(
        """() => {
            const doc = document.documentElement;
            const wide = [];
            for (const el of document.querySelectorAll('main *')) {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.right > doc.clientWidth + 1) {
                    wide.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 40)}`);
                }
            }
            return {
                scrollWidth: doc.scrollWidth,
                clientWidth: doc.clientWidth,
                overflowing: wide.slice(0, 5),
            };
        }"""
    )


def button_box(page: Page, text: str) -> dict | None:
    locator = page.get_by_role("button", name=text, exact=False)
    if locator.count() == 0:
        return None
    box = locator.first.bounding_box()
    return box


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"被验收地址：{BASE}")
    print(f"截图目录：{OUT}")

    username = f"r19acct_{secrets.token_hex(4)}"
    password = f"Vf-{secrets.token_hex(6)}"

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 390, "height": 844})
            page.set_default_timeout(20000)

            print("\n[0] 注册一个一次性测试账号")
            register(page, username, password)
            check(True, "注册成功")

            print("\n[1] 打开账号页")
            page.goto(f"{BASE}/#/account", wait_until="domcontentloaded")
            page.wait_for_timeout(2500)
            page.wait_for_selector("input[name='nickname']", timeout=20000)
            check(True, "账号页渲染出来了")

            # ── 2. 五个区块的动作都在，且够大够得着 ─────────────────────────
            print("\n[2] 六个区块的动作")
            actions = ["保存昵称", "修改密码", "生成新的恢复码", "导出我的数据", "我想注销账号"]
            for label in actions:
                box = button_box(page, label)
                if box is None:
                    check(False, f"「{label}」按钮存在")
                    continue
                check(
                    box["height"] >= 44,
                    f"「{label}」命中区高度 ≥44px",
                    f"{round(box['width'])}x{round(box['height'])}",
                )

            # ── 3. A39：这一页不该有主色按钮，危险动作必须是 danger ────────
            print("\n[3] A39 按钮层级")
            styling = page.evaluate(
                """() => {
                    const of = (text) => {
                        const btn = [...document.querySelectorAll('button')]
                            .find((b) => (b.textContent || '').includes(text));
                        if (!btn) return null;
                        const cs = getComputedStyle(btn);
                        return { cls: btn.className, bg: cs.backgroundColor, color: cs.color };
                    };
                    const primaries = [...document.querySelectorAll('.btn-primary')].length;
                    return { primaryCount: primaries, password: of('修改密码'), danger: of('永久删除') };
                }"""
            )
            check(
                styling["primaryCount"] == 0,
                "这一页没有主色按钮（六个区块是平权的，不该用一个主色暗示优先级）",
                f"primaryCount={styling['primaryCount']}",
            )
            if styling["password"]:
                check(
                    "btn-secondary" in styling["password"]["cls"],
                    "「修改密码」已改为次级按钮",
                    styling["password"]["cls"],
                )
            notes.append(f"修改密码按钮样式：{styling['password']}")
            # 危险动作此刻还没打开面板，所以 danger 按钮不该在页面上
            check(
                page.locator(".btn-danger").count() == 0,
                "没点开注销面板时页面里没有「永久删除」按钮（危险动作不能顺手就能点到）",
            )

            # ── 4. A38 + A59：故意输错当前密码 ─────────────────────────────
            print("\n[4] A38/A59：输错当前密码")
            page.fill("input[name='current-password']", "definitely-wrong-2026")
            # 两次新密码必须一致：不一致时按钮本身就是禁用的（那样点不到，也验不出服务端原文）
            new_password = f"Vf-{secrets.token_hex(6)}"
            page.fill("input[name='new-password']", new_password)
            page.fill("input[name='confirm-password']", new_password)
            page.get_by_role("button", name="修改密码").first.click()
            page.wait_for_timeout(3000)
            capture(page, "390x844-account-password-error.png")

            notice = page.locator("[data-account-error-password]")
            check(notice.count() == 1, "失败提示挂在「修改密码」这一段里（不是页面顶部）")
            if notice.count() == 0:
                skip("没有失败提示块，后面两条断言无从谈起")
            else:
                text = notice.first.inner_text()
                check(
                    "服务器说明" in text and "当前密码不正确" in text,
                    "A38：服务端原话（当前密码不正确。）露出来了",
                    text.replace("\n", " ")[:120],
                )
                check(
                    "反馈问题时把这个编号一起发过来" in text,
                    "A59：报障编号的用法说明这次真的渲染了",
                    text.replace("\n", " ")[:160],
                )
                check("报障编号" in text, "编号本身也在")
                # 主文案与服务器说明是两件事：主文案会按错误码翻译，两者都要能看到
                check(
                    text.strip().splitlines()[0].strip() != "服务器说明：当前密码不正确。",
                    "主文案不是把服务端原文抄一遍（两行各有各的用处）",
                    text.replace("\n", " ")[:80],
                )

            # ── 5. 注销面板：危险动作的进入条件 ────────────────────────────
            print("\n[5] 注销面板")
            page.get_by_role("button", name="我想注销账号").click()
            page.wait_for_timeout(600)
            capture(page, "390x844-account-delete-panel.png")
            danger = page.locator(".btn-danger")
            check(danger.count() == 1, "点开后出现「永久删除我的账号」")
            if danger.count() == 1:
                check(danger.first.is_disabled(), "没勾确认、没输密码时它是禁用状态")
                check(
                    "永久删除" in danger.first.inner_text(),
                    "按钮文案说清了不可逆（不是「确定」这种含糊说法）",
                    danger.first.inner_text(),
                )
                danger_style = page.evaluate(
                    """() => {
                        const btn = document.querySelector('.btn-danger');
                        const other = [...document.querySelectorAll('.btn-secondary')][0];
                        return { danger: getComputedStyle(btn).backgroundColor,
                                 secondary: other ? getComputedStyle(other).backgroundColor : null };
                    }"""
                )
                check(
                    danger_style["secondary"] is None
                    or danger_style["danger"] != danger_style["secondary"],
                    "危险按钮的颜色与次级按钮不同（一眼分得开）",
                    f"{danger_style}",
                )
                notes.append(f"危险/次级背景色：{danger_style}")
            page.get_by_role("button", name="先不删了").click()
            page.wait_for_timeout(600)
            check(
                page.locator("input[name='nickname']").count() == 1,
                "关掉面板后账号还在（这一轮没有真的注销任何人）",
            )

            # ── 6. 三个宽度下的横向溢出 ───────────────────────────────────
            print("\n[6] 320 / 390 / 1440 的横向溢出")
            for label, width, height in VIEWPORTS:
                page.set_viewport_size({"width": width, "height": height})
                page.wait_for_timeout(700)
                layout = measure_layout(page)
                check(
                    layout["scrollWidth"] <= layout["clientWidth"] + 1,
                    f"{label}px 无横向滚动",
                    f"scrollWidth={layout['scrollWidth']} clientWidth={layout['clientWidth']} 溢出元素={layout['overflowing']}",
                )
                if label != "390":
                    capture(page, f"{label}x{height}-account.png")
                for action in ("保存昵称", "修改密码", "我想注销账号"):
                    box = button_box(page, action)
                    check(
                        box is not None and box["height"] >= 44,
                        f"{label}px 下「{action}」仍够大",
                        "未找到" if box is None else f"{round(box['width'])}x{round(box['height'])}",
                    )
        finally:
            browser.close()

    verdict = "PASS" if not failures else "FAIL"
    print(f"\n{verdict} {passed[0]} / FAIL {len(failures)} / SKIP {len(skips)}")

    lines = [
        "# 账号页验收：服务端原文、报障编号用法、按钮层级（A38 / A39 / A59）",
        "",
        f"- 被验收地址：`{BASE}`",
        f"- 使用账号：`{username}`（一次性合成账号，密码未记录）",
        f"- 结论：**{verdict}**（PASS {passed[0]} / FAIL {len(failures)} / SKIP {len(skips)}）",
        "",
        "## 这一轮改了什么",
        "",
        "- **A38（这一页曾经丢掉服务端原话）**：`FormErrorNotice` 把那段提示块的字段集合固定在一处，",
        "  账号页五个表单都用它 —— 输错当前密码时，服务端给的「当前密码不正确。」会单独一行显示，",
        "  而不是只剩给登录页写的「用户名或密码不对」（这一页根本没有用户名字段）。",
        "- **A59（新发现）**：`requestHint` 是布尔 prop，而 Vue 会把**缺席的布尔 prop 转成 `false`**，",
        "  于是模板里 `v-if=\"requestHint !== false\"` 永远不成立 —— 「反馈问题时把这个编号一起发过来，",
        "  能直接查到这次请求。」这句话在**所有页面上都没渲染过**，而组件注释写的是\"默认显示\"。",
        "  修法是 `withDefaults(..., { requestHint: true })`：默认值由类型系统保证，而不是靠模板条件。",
        "- **A39（按钮层级）**：这一页是平权的六个设置区块（昵称、密码、恢复码、导出、注销、自我理解），",
        "  原来只有「修改密码」是 `btn-primary`，等于用主色暗示它是这一页最该做的事；已统一为次级，",
        "  层级交给区块标题承担。危险动作仍然是 `btn-danger`，而且要先点开面板、勾确认、输密码。",
        "",
    ]
    if notes:
        lines += ["## 观察记录", ""] + [f"- {item}" for item in notes] + [""]
    if shots:
        lines += ["## 截图", ""] + [f"- `{name}`" for name in shots] + [""]
    if failures:
        lines += ["## 失败项", ""] + [f"- {item}" for item in failures] + [""]
    if skips:
        lines += ["## 跳过项", ""] + [f"- {item}" for item in skips] + [""]
    lines += [
        "## 判据",
        "",
        "- **服务端原文必须露出来**：主文案是按错误码翻译的，服务端原话是另一件事；",
        "  两者不能只留一个 —— 用户要知道「到底哪一项不对」。",
        "- **报障编号要带用法**：只给一串编号，用户不知道拿它做什么。",
        "- **一页一个主色按钮**是本站口径；没有单一主行动的页面应当是零主色，而不是挑一个凑数。",
        "- **危险动作必须有门槛**：默认不可见、要二次确认、要重新输密码、颜色与其它按钮不同。",
        "- **320 / 390 / 1440 无横向溢出**，动作按钮命中区 ≥44px。",
        "",
        "## 诚实交代",
        "",
        "1. 这条脚本**没有真的注销任何账号**：只点开面板、确认危险按钮是禁用的，然后「先不删了」。",
        "   真正执行注销的链路（删除任务、数据清理）由后端测试覆盖，不在这里点。",
        "2. A38/A59 的文案断言只覆盖「修改密码」这一支；其它四个表单共用同一个组件，",
        "   由 `frontend/src/components/formErrorNotice.spec.ts` 的字段集合测试钉住。",
        "3. A39 的「层级」是用**可测量的东西**判的（页面里 `.btn-primary` 数量为 0、修改密码是",
        "   `.btn-secondary`、危险按钮背景色不同），不是靠「看起来更舒服」。",
        "4. 这一页在真实浏览器里只跑了 390 宽的交互；320/1440 只量布局与按钮尺寸。",
    ]
    (OUT / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (OUT / "result.json").write_text(
        json.dumps(
            {
                "verdict": verdict,
                "passed": passed[0],
                "failed": failures,
                "skipped": skips,
                "notes": notes,
                "screenshots": shots,
                "username": username,
                "base": BASE,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"报告：{OUT / 'REPORT.md'}")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
