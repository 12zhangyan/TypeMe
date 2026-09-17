"""TypeMe 持续优化验收：新测主流程在**真实浏览器**里的走查（2026-09-17）。

用法（项目根目录）：

    python scripts/browser-verify-jung-flow.py

前置：
    - 前端 dev server 指向一个**可写测试后端**（本脚本会真实注册账号、创建测评、提交答卷）；
    - 建议后端跑在一次性数据库上（例如内存 H2）。**不要指向含有真实用户数据的库。**

环境变量：
    TYPEME_BASE     被验收地址（默认 http://127.0.0.1:5174，即转发到测试后端的 dev server）
    TYPEME_OUT      截图目录（默认 docs/optimization/verification/2026-09-17-flow）
    TYPEME_LABEL    写进报告的说明

产出：<TYPEME_OUT>/*.png 与 REPORT.md / result.json

纪律：
    - 账号名带随机后缀，密码是脚本生成的合成值，**不写进报告**；
    - 恢复码只落到 `_local-secrets.json`（本目录，已被 `.gitignore` 排除的 output 或
      verification 目录的 `_` 前缀文件），不进 REPORT.md、不进截图；
    - 不调用删除/注销/导出接口，只有注册、建测评、作答、交卷、读报告。
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
        ROOT / "docs" / "optimization" / "verification" / "2026-09-17-flow",
    )
)
BASE = os.environ.get("TYPEME_BASE", "http://127.0.0.1:5174")
BASE_LABEL = os.environ.get("TYPEME_LABEL", "")

MOBILE = {"width": 390, "height": 844}
NARROW = {"width": 320, "height": 568}
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


def capture(page: Page, name: str) -> None:
    page.screenshot(path=str(OUT / name))


def go(page: Page, hash_path: str) -> None:
    page.goto(f"{BASE}/#{hash_path}", wait_until="domcontentloaded")
    page.wait_for_timeout(500)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"被验收地址：{BASE}{(' （' + BASE_LABEL + '）') if BASE_LABEL else ''}")
    print(f"截图目录：{OUT}")

    username = f"verify_{secrets.token_hex(4)}"
    password = f"Vf-{secrets.token_hex(6)}"

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            page = browser.new_page(viewport=MOBILE)
            page.set_default_timeout(20000)

            # ── 1. 注册（走真实表单，不用接口代劳）─────────────────────────
            print("\n[1] 注册流程（真实表单 + 真实接口）")
            go(page, "/register")
            page.fill("input[name='username']", username)
            page.fill("input[name='nickname']", '验收账号')
            page.fill("input[name='new-password']", password)
            page.fill("input[name='confirm-password']", password)
            capture(page, "10-register-filled-390.png")

            # 免责声明同意项（2026-09-17 起为必填）。先验证"不勾不能提交"，
            # 再勾上继续 —— 这正是这条要求存在的意义，不能只测勾上之后能过。
            submit = page.locator("button[type='submit']")
            disclaimer = page.locator("input[name='disclaimer-accepted']")
            check(disclaimer.count() == 1, "注册页有免责声明勾选框")
            check(
                not submit.is_enabled(),
                "未勾选免责声明时「创建账号」不可点（不会替用户同意）",
                "按钮却是可点的",
            )
            check(
                page.locator("label[for^='reg-disclaimer-']").count() == 1,
                "勾选框有整句可点的 label",
            )
            disclaimer.check()
            page.wait_for_timeout(300)
            check(submit.is_enabled(), "勾选免责声明后「创建账号」可点")
            import time as _time

            started = _time.perf_counter()
            submit.click()
            # 注册要真的算 PBKDF2（生产档 210000 轮），实测本机 ≈4.5s。
            # 这里等的是**恢复码出现**，不是"睡够时间"。
            page.wait_for_selector("[data-recovery-codes] li", timeout=25000)
            elapsed = _time.perf_counter() - started
            notes.append(f"注册（真实表单提交 → 恢复码出现）耗时 {elapsed:.1f}s（PBKDF2 生产档）")

            codes_visible = page.locator("[data-recovery-codes] li").count()
            check(
                codes_visible > 0,
                "注册成功并显示一次性恢复码",
                f"恢复码条目 {codes_visible} 条；页面片段 {page.locator('main').inner_text()[:120]!r}",
            )
            capture(page, "11-register-recovery-390.png")
            # 恢复码不落盘、不进报告：这里只记条数。
            notes.append(f"注册返回的恢复码条数：{codes_visible}（内容不保存、不截图外传）")

            # 注册本身就是登录（契约：注册响应带完整资料 + 建立会话）。
            # 在**同一个页面**上确认会话可用，避免把"新开页面还没加载完"误判成掉线。
            me_after_register = page.evaluate(
                "async () => (await fetch('/api/v3/me', { credentials: 'same-origin' })).status"
            )
            check(
                me_after_register == 200,
                "注册后会话立即可用（GET /api/v3/me）",
                f"status={me_after_register}",
            )

            # 勾"已抄下"才能离开（这条本身也是产品要求）
            leave_button = page.locator("button:has-text('去「账号与数据」')")
            check(
                leave_button.is_disabled(),
                "未勾选「已抄下恢复码」时不能离开该页",
            )
            page.check("input[type='checkbox']")
            page.wait_for_timeout(200)
            check(not leave_button.is_disabled(), "勾选后可以离开该页")
            leave_button.click()
            page.wait_for_timeout(1500)
            check("/account" in page.url, "离开后落在账号页", f"URL {page.url}")

            # ── 2. 账号页（同一页面继续，避免把测试框架的多页面 cookie 行为误判成掉线）──
            print("\n[2] 账号与数据页")
            go(page, "/account")
            page.wait_for_timeout(2500)
            account_text = page.locator("main").inner_text()
            check("导出数据" in account_text, "账号页有数据导出区块")
            check("注销账号" in account_text, "账号页有注销区块")
            check("恢复码" in account_text, "账号页有恢复码区块")
            check("修改密码" in account_text, "账号页有改密区块")
            check(
                page.locator("button:has-text('我想注销账号')").count() > 0,
                "注销入口要两步才危险：先点「我想注销账号」展开确认区",
            )
            small_targets = page.evaluate(
                """() => {
                  const bad = [];
                  for (const el of document.querySelectorAll('button')) {
                    const box = el.getBoundingClientRect();
                    if (box.width === 0 || box.height === 0) continue;
                    if (box.height < 24) bad.push(el.textContent.trim().slice(0, 12) + ':' + Math.round(box.height));
                  }
                  return bad;
                }"""
            )
            check(not small_targets, "账号页按钮高度都 ≥24px", f"{small_targets}")
            capture(page, "40-account-390.png")

            # ── 3. 首页 → 开始测评 → 答题 ──────────────────────────────────
            print("\n[3] 首页主按钮 → 答题页（真实作答）")
            go(page, "/")
            page.locator("[data-primary-entry]").click()
            page.wait_for_timeout(2500)
            check(
                "/assess" in page.url,
                "首页主按钮进入 /assess",
                f"实际 URL {page.url}",
            )
            attempt_id = page.url.split("/assess/")[1].split("?")[0] if "/assess/" in page.url else ""
            progress_text = page.locator("[data-question-card], body").first.inner_text()[:80]
            notes.append(f"进入答题页后首屏可读文本片段：{progress_text!r}")
            capture(page, "20-assess-390.png")

            # 依次作答：每题选第 1 档，点「下一题」。
            # 刻意**最后一道主测题先不交**：交卷后题卡会被 review/补充题界面替换，
            # 而"刷新恢复""回退改答"这两个业务要点必须在仍在答题时验证。
            answered = 0
            for _ in range(70):
                next_button = page.locator("[data-next]")
                if next_button.count() == 0:
                    break
                label = next_button.first.inner_text()
                if "完成主测" in label:
                    break
                rating = page.locator(".option-cell[data-rating='1']")
                if rating.count() == 0:
                    break
                rating.first.click()
                page.wait_for_timeout(150)
                next_button = page.locator("[data-next]")
                if next_button.count() == 0:
                    break
                # 保存是服务端往返，按钮在保存期间是禁用的；点禁用按钮会静默无进展。
                # 2026-09-17 复跑时这里偶发失败（页面停在 16/48）：读按钮状态与真正点下去之间
                # 隔着一次保存往返，读到的"可用"可能已经过期。所以改成显式等它可用，
                # 而不是读一次就点。等不到就交给 Playwright 超时并留痕，不再静默停住。
                try:
                    page.wait_for_function(
                        """() => {
                            const b = document.querySelector('[data-next]');
                            return b !== null && !b.disabled;
                        }""",
                        timeout=15000,
                    )
                except Exception:
                    notes.append(
                        f"第 {answered + 1} 次作答后「下一题」在 15s 内没有恢复可用"
                        f"（题卡：{page.locator('[data-question-card]').first.inner_text()[:60]!r}）"
                    )
                    break
                next_button.first.click()
                page.wait_for_timeout(300)
                answered += 1
            notes.append(f"本次实际点击作答 {answered} 次（每题选第 1 档），最后一道主测题留到 3b 之后再交")
            # 记录作答结束后页面停在哪儿：这一项在 2026-09-17 的复跑中偶发失败
            # （停在 16/48），只报"没推进到主测结束"根本无法定位是脚本节奏还是产品问题。
            # 所以把当时的题号与按钮文案一起记下来。
            _card = page.locator("[data-question-card]")
            _progress = _card.first.inner_text()[:60] if _card.count() else "(无题卡)"
            _next = page.locator("[data-next]")
            _next_label = _next.first.inner_text() if _next.count() else "(无「下一题」按钮)"
            _next_disabled = _next.first.is_disabled() if _next.count() else None
            notes.append(
                f"作答循环结束时停在 {_progress!r}；按钮文案 {_next_label!r}；禁用={_next_disabled}"
            )
            check(answered >= 40, "答题流程能连续推进到主测结束", f"只推进了 {answered} 题")
            capture(page, "21-assess-later-390.png")

            # ── 3b. 还差最后一题时，验证两个业务要点 ───────────────────────
            print("\n[3b] 作答中途：刷新恢复与回退改答")
            position_before = page.locator("[data-question-card]").first.inner_text()[:60]
            page.reload(wait_until="domcontentloaded")
            page.wait_for_timeout(3000)
            position_after = page.locator("[data-question-card]").first.inner_text()[:60]
            check(
                position_after == position_before and position_after != "",
                "刷新后回到同一题（未交卷的作答进度不丢）",
                f"刷新前 {position_before!r} / 刷新后 {position_after!r}",
            )
            notes.append(f"刷新前后题卡文案一致：{position_before!r}")

            previous_button = page.locator("[data-previous]")
            check(previous_button.count() > 0, "答题页有「上一题」入口")
            if previous_button.count() > 0 and not previous_button.first.is_disabled():
                previous_button.first.click()
                page.wait_for_timeout(1200)
                back_position = page.locator("[data-question-card]").first.inner_text()[:60]
                check(
                    back_position != position_after,
                    "「上一题」确实回到前一道题",
                    f"仍在 {back_position!r}",
                )
                # 回退后改一次答案，再前进，确认改动被接受而不是被静默丢弃。
                changed = page.locator(".option-cell[data-rating='5']")
                if changed.count() > 0:
                    changed.first.click()
                    page.wait_for_timeout(400)
                forward = page.locator("[data-next]")
                check(forward.count() > 0, "回退改答后仍有「下一题」可继续")
                if forward.count() > 0:
                    forward.first.click()
                    page.wait_for_timeout(1000)
                    check(
                        page.locator("[data-question-card]").count() > 0,
                        "改答后被接受的题已保存，且能前进到下一题（不静默丢弃）",
                    )
            else:
                notes.append("第一题上「上一题」为禁用态，跳过回退检查。")

            # 交最后一题：进入主测收尾（可能安排补充题）。
            # 注意必须等「下一题」重新可用 —— 保存是服务端往返，点太快会点在被禁用的按钮上，
            # 于是页面停在最后一题（这属于脚本节奏问题，不是产品缺陷）。
            final_rating = page.locator(".option-cell[data-rating='1']")
            if final_rating.count() > 0:
                final_rating.first.click()
            page.wait_for_timeout(1500)
            final_next = page.locator("[data-next]")
            if final_next.count() > 0 and not final_next.first.is_disabled():
                final_next.first.click()
                page.wait_for_timeout(3500)
            answered += 1

            # ── 3c. 跳过补充题 → 交卷 ──────────────────────────────────────
            print("\n[3c] 补充题与交卷")
            skip_button = page.locator("button:has-text('跳过')")
            if skip_button.count() > 0:
                notes.append("主测结束时有维度处于边界，服务端安排了补充题；本次按真实路径选择「跳过」。")
                skip_button.first.click()
                page.wait_for_timeout(3500)
            else:
                notes.append("主测结束时没有安排补充题（各维方向都不在边界内）。")

            page.wait_for_timeout(2500)
            check(
                "/reports/" in page.url,
                "交卷后进入报告详情页",
                f"URL {page.url}；页面片段 {page.locator('main').inner_text()[:120]!r}",
            )

            # ── 3d. 归属边界：另一个会话打不到这份草稿 ─────────────────────
            # 资源访问必须按当前认证用户校验归属，不能信任客户端传的 owner。
            # 用**独立的浏览器上下文**（各自的 cookie jar）注册第二个账号，用它的会话
            # 去读/写别人的 attempt；服务端对"不存在"与"不属于你"返回同形 404。
            print("\n[3d] 归属边界：他人会话访问这份草稿")
            check(
                bool(attempt_id),
                "已记下这份草稿的 attemptId（跨账号校验需要它）",
                "URL 里没抓到 attemptId",
            )
            other_context = browser.new_context(viewport=MOBILE)
            other_page = other_context.new_page()
            other_page.set_default_timeout(20000)
            other_username = f"probe_{secrets.token_hex(4)}"
            other_page.goto(f"{BASE}/#/register", wait_until="domcontentloaded")
            other_page.wait_for_timeout(800)
            other_page.fill("input[name='username']", other_username)
            other_page.fill("input[name='new-password']", "Other-Probe!2026")
            other_page.fill("input[name='confirm-password']", "Other-Probe!2026")
            other_page.locator("input[name='disclaimer-accepted']").check()
            other_page.click("button[type='submit']")
            other_page.wait_for_selector("[data-recovery-codes] li", timeout=25000)
            intruder = other_page.evaluate(
                """async (id) => {
                  const csrf = await (await fetch('/api/v3/auth/csrf')).json();
                  const read = await fetch('/api/v3/attempts/' + id, { credentials: 'same-origin' });
                  const write = await fetch('/api/v3/attempts/' + id + '/answers', {
                    method: 'PATCH',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json', [csrf.headerName]: csrf.token },
                    body: JSON.stringify({ expectedRevision: 0, responses: [], currentQuestionId: 'EI-01' }),
                  });
                  return { read: read.status, write: write.status };
                }""",
                attempt_id,
            )
            check(
                intruder["read"] == 404,
                "另一个账号读别人的草稿返回 404（不泄露存在性）",
                f"status={intruder['read']}",
            )
            check(
                intruder["write"] in (404, 403),
                "另一个账号写别人的草稿被拒（404/403）",
                f"status={intruder['write']}",
            )
            notes.append(f"跨账号访问同一 attempt：GET {intruder['read']} / PATCH {intruder['write']}")
            other_context.close()

            # ── 4. 报告页 ─────────────────────────────────────────────────

            print("\n[4] 报告页")
            detail_text = page.locator("main").inner_text()
            check(len(detail_text) > 200, "报告详情页渲染出长正文", f"正文长度 {len(detail_text)}")
            check(
                "不是心理诊断" in detail_text or "参考" in detail_text,
                "报告详情页保留定位与免责说明",
            )
            capture(page, "30-report-detail-390.png")

            go(page, "/reports")
            page.wait_for_timeout(2500)
            body = page.locator("main").inner_text()
            check(len(body) > 50, "报告列表页渲染出内容", f"正文长度 {len(body)}")
            check(
                "历史报告" in body or "报告" in body,
                "报告列表页能看到本次报告",
            )
            capture(page, "30-reports-list-390.png")

            # ── 5. 窄屏与桌面：顶栏高度、横向溢出（同一页面换视口）─────────
            print("\n[5] 窄屏 / 桌面布局（登录态）")
            for label, viewport in (("320", NARROW), ("390", MOBILE), ("1440", DESKTOP)):
                page.set_viewport_size(viewport)
                go(page, "/reports")
                page.wait_for_timeout(1500)
                overflow = page.evaluate(
                    "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
                )
                header = page.eval_on_selector("header", "(el) => el.getBoundingClientRect().height")
                check(overflow <= 0, f"{label}px 报告页没有横向溢出", f"多出 {overflow}px")
                notes.append(
                    f"{label}px 报告页顶栏高 {header:.0f}px（视口高 {viewport['height']}px，"
                    f"占 {header / viewport['height'] * 100:.1f}%）"
                )
                capture(page, f"31-reports-{label}.png")

            # 答题页是主流程里操作最密的一屏：在 320 宽上单独确认没有横向溢出
            page.set_viewport_size(NARROW)
            go(page, f"/assess/{attempt_id}" if attempt_id else "/assess")
            page.wait_for_timeout(2000)
            assess_overflow = page.evaluate(
                "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
            )
            check(assess_overflow <= 0, "320px 答题页没有横向溢出", f"多出 {assess_overflow}px")
            capture(page, "32-assess-320.png")
            page.set_viewport_size(MOBILE)
        finally:
            browser.close()

    report = [
        "# 浏览器验收报告 —— 新测主流程（2026-09-17）",
        "",
        f"- 被验收地址：`{BASE}`" + (f"（{BASE_LABEL}）" if BASE_LABEL else ""),
        "- 账号：本次生成的**合成账号**（用户名与密码不写入本报告）",
        "- 后端：指向一次性测试库；本轮未触碰 `typeme_dev`",
        f"- PASS {passed[0]} / FAIL {len(failures)} / SKIP {len(skips)}",
        "",
        "## 失败项",
        "",
    ]
    report += [f"- {item}" for item in failures] or ["- 无"]
    report += ["", "## 跳过项（未验证，不计入通过）", ""]
    report += [f"- {item}" for item in skips] or ["- 无"]
    report += ["", "## 实测数据", ""]
    report += [f"- {item}" for item in notes] or ["- 无"]
    report += ["", "## 截图", ""]
    report += [f"- `{p.name}`" for p in sorted(OUT.glob("*.png"))]
    report += [
        "",
        "## 复现方式",
        "",
        "```powershell",
        "# 1) 起一个可写测试后端（示例：内存 H2），注意不要指向真实库",
        "cd backend",
        "$env:JAVA_HOME='D:\\develop\\jdk-21'",
        "$env:SPRING_DATASOURCE_URL='jdbc:h2:mem:typeme_verify;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1'",
        "$env:SPRING_DATASOURCE_DRIVER_CLASS_NAME='org.h2.Driver'; $env:SERVER_PORT='8099'",
        "mvn.cmd org.codehaus.mojo:exec-maven-plugin:3.1.0:java -Dexec.mainClass=com.typeme.TypeMeApplication -Dexec.classpathScope=test",
        "# 2) 起前端 dev server 并指向它",
        "cd ..\\frontend; $env:VITE_DEV_API_TARGET='http://127.0.0.1:8099'; npm.cmd run dev -- --host 127.0.0.1 --port 5174",
        "# 3) 跑本脚本",
        "python scripts/browser-verify-jung-flow.py",
        "```",
        "",
    ]
    (OUT / "REPORT.md").write_text("\n".join(report), encoding="utf-8")
    (OUT / "result.json").write_text(
        json.dumps(
            {"passed": passed[0], "failures": failures, "skips": skips, "notes": notes},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"\nPASS {passed[0]} / FAIL {len(failures)} / SKIP {len(skips)}")
    print(f"报告：{OUT / 'REPORT.md'}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
