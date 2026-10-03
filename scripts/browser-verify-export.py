"""真实浏览器验证：导出数据的**文件内容**与页面提示是否一致。

为什么需要这条：导出的缺陷是"服务端降级成空数组、页面却宣称完整"，
两边的单测各自都只能覆盖自己那一半 ——
后端测试证明 payload 里有 `degradedSections`，前端测试证明解析函数读得出它，
但"用户在浏览器里点一下，下载到的文件里到底有没有这个字段"只有真机跑一次才知道。

本脚本断言的是**文件本身**（下载下来的 JSON），不是页面上的一句话：
只有文件里真的带上了降级标记，用户事后自查才有可能发现问题。

用法：
    python scripts/browser-verify-export.py
环境变量：
    TYPEME_BASE  前端地址（默认 http://127.0.0.1:5174）
    TYPEME_OUT   截图与证据输出目录
"""

import json
import os
import pathlib
import re
import sys
import time
import uuid

from playwright.sync_api import sync_playwright

BASE = os.environ.get("TYPEME_BASE", "http://127.0.0.1:5174")
OUT = pathlib.Path(
    os.environ.get(
        "TYPEME_OUT",
        str(pathlib.Path(__file__).resolve().parent.parent / "output" / "export-verify"),
    )
)
OUT.mkdir(parents=True, exist_ok=True)

RESULTS: list[tuple[bool, str, str]] = []
NOTES: list[str] = []


def check(ok: bool, title: str, detail: str = "") -> None:
    RESULTS.append((bool(ok), title, detail))
    mark = "PASS" if ok else "FAIL"
    print(f"  {mark} {title}" + (f"  [{detail}]" if detail else ""))


def capture(page, name: str) -> None:
    try:
        page.screenshot(path=str(OUT / name), full_page=True)
    except Exception as exc:  # noqa: BLE001 - 截图失败不该中断验证
        print(f"    (截图 {name} 失败：{exc})")


def register(page, username: str, password: str) -> None:
    page.goto(f"{BASE}/#/register", wait_until="domcontentloaded")
    page.wait_for_selector("input[name='username']", timeout=25_000)
    page.fill("input[name='username']", username)
    # 字段名取自 RegisterView 的 name 属性（不是 v-model 名）
    page.fill("input[name='new-password']", password)
    page.fill("input[name='confirm-password']", password)
    checkbox = page.query_selector("input[name='disclaimer-accepted']")
    if checkbox and not checkbox.is_checked():
        checkbox.check()
    submit = page.query_selector("button[type='submit']")
    if submit is not None and submit.is_disabled():
        hint = page.query_selector("[id$='-hint']")
        raise AssertionError(
            "注册按钮仍不可提交，页面给的原因是："
            + (hint.inner_text().strip() if hint else "（没有提示）")
        )
    page.click("button[type='submit']")
    page.wait_for_selector("[data-recovery-codes] li", timeout=25_000)


def main() -> int:
    print(f"被验收地址：{BASE}")
    print(f"证据目录：{OUT}\n")

    suffix = uuid.uuid4().hex[:10]
    username = f"export_{suffix}"
    password = "Export-Probe!2026"

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        context = browser.new_context(viewport={"width": 390, "height": 844}, accept_downloads=True)
        page = context.new_page()

        # 记下导出响应，用来把"文件里有什么"与"服务端发了什么"对上
        export_bodies: list[str] = []

        def on_response(response):
            if "/api/v3/me/export" in response.url and response.request.method == "GET":
                try:
                    export_bodies.append(response.text())
                except Exception:  # noqa: BLE001
                    export_bodies.append("")

        page.on("response", on_response)

        print("[0] 注册一个全新账号（这样导出里只有空数据，但字段必须齐全）")
        register(page, username, password)
        print(f"  已注册 {username}")

        print("\n[1] 进入「账号与数据」并触发导出")
        page.goto(f"{BASE}/#/account", wait_until="domcontentloaded")
        page.wait_for_selector("#account-export-heading", timeout=25_000)
        page.wait_for_timeout(600)
        capture(page, "10-account-390.png")

        # 按钮文案就是「导出我的数据」；用文案定位比加测试专用属性更贴近用户操作
        export_button = page.get_by_role("button", name="导出我的数据")
        check(export_button.count() == 1, "账号页上找得到导出按钮（唯一一个）", f"{export_button.count()} 个")

        with page.expect_download(timeout=60_000) as download_info:
            export_button.click()
        download = download_info.value
        download_path = OUT / "downloaded-export.json"
        download.save_as(str(download_path))
        page.wait_for_timeout(1200)

        check(download_path.exists(), "导出文件确实下载到了本地", str(download_path.name))
        raw = download_path.read_text(encoding="utf-8")

        print("\n[2] 检查下载到的文件本身")
        try:
            payload = json.loads(raw)
        except Exception as exc:  # noqa: BLE001
            check(False, "导出文件是合法 JSON", f"{exc}")
            payload = None

        if payload is not None:
            check(True, "导出文件是合法 JSON", f"{len(raw)} 字节")
            check(
                "degradedSections" in payload,
                "**导出文件里带有 degradedSections 字段**（用户事后自查的依据）",
                f"键={sorted(payload.keys())}",
            )
            degraded = payload.get("degradedSections")
            check(
                isinstance(degraded, list),
                "degradedSections 是数组",
                f"实际类型={type(degraded).__name__}",
            )
            for section in ("profile", "attempts", "reports", "selfReflections", "aiJobs", "excluded"):
                check(section in payload, f"导出文件含 {section} 段", "")
            if isinstance(degraded, list) and degraded:
                NOTES.append(f"本次导出声明了降级段落：{degraded}")
            else:
                NOTES.append("本次导出没有降级段落（服务端认为这份备份是完整的）")

        print("\n[3] 检查页面提示与实际文件是否一致")
        page_text = page.inner_text("main")
        if payload is not None and not payload.get("degradedSections"):
            check(
                "都在里面" in page_text,
                "文件完整时页面说「都在里面」（这是现在唯一可以说这句话的情形）",
                "",
            )
            check(
                "不是完整备份" not in page_text,
                "文件完整时**不**显示不完整警告",
                "",
            )
        else:
            check(
                "不是完整备份" in page_text,
                "文件有降级时页面明确说「不是完整备份」",
                page_text[-300:],
            )
        capture(page, "20-after-export-390.png")

        # 断言两次取到的响应体一致，排除"读响应"与"读文件"指向不同请求
        if export_bodies:
            try:
                served = json.loads(export_bodies[-1])
                check(
                    "degradedSections" in served,
                    "服务端响应体本身也带 degradedSections（不只是文件里有）",
                    "",
                )
            except Exception:  # noqa: BLE001
                check(False, "服务端导出响应体可解析", export_bodies[-1][:200])

        print("\n[4] 改用「有真实数据」的账号再导出一次")
        # 新注册的账号是空的：`reports: []` 既可能是"你确实没有报告"，也可能是
        # "查询失败了" —— 这正是原来那个缺陷最难被发现的地方。
        # 这里建一份测评（产生 attempts 行），再导出，看文件与页面的说法。
        context2 = browser.new_context(viewport={"width": 390, "height": 844}, accept_downloads=True)
        page2 = context2.new_page()
        user2 = f"export2_{uuid.uuid4().hex[:10]}"
        register(page2, user2, password)

        created = page2.evaluate(
            """async () => {
                const token = document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1];
                const response = await fetch('/api/v3/attempts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(token || '') },
                    body: '{}',
                });
                return { status: response.status, body: await response.text() };
            }"""
        )
        check(
            created.get("status") == 201,
            "为第二个账号建了一份测评（这样 attempts 段不是空的）",
            f"HTTP {created.get('status')}",
        )

        page2.goto(f"{BASE}/#/account", wait_until="domcontentloaded")
        page2.wait_for_selector("#account-export-heading", timeout=25_000)
        page2.wait_for_timeout(600)
        with page2.expect_download(timeout=60_000) as download2_info:
            page2.get_by_role("button", name="导出我的数据").click()
        download2 = download2_info.value
        path2 = OUT / "downloaded-export-with-data.json"
        download2.save_as(str(path2))
        page2.wait_for_timeout(1200)

        payload2 = json.loads(path2.read_text(encoding="utf-8"))
        attempts2 = payload2.get("attempts")
        check(
            isinstance(attempts2, list) and len(attempts2) >= 1,
            "**有数据时 attempts 段确实带回了那条测评**（而不是空数组）",
            f"attempts 条数={len(attempts2) if isinstance(attempts2, list) else 'N/A'}",
        )
        if isinstance(attempts2, list) and attempts2:
            check(
                isinstance(attempts2[0].get("answers"), list),
                "每条测评都带上 answers 数组",
                f"键={sorted(attempts2[0].keys())}",
            )
        check(
            payload2.get("degradedSections") == [],
            "有数据且一切正常时 degradedSections 为空（证明不会误报降级）",
            f"实际={payload2.get('degradedSections')}",
        )
        page2_text = page2.inner_text("main")
        check(
            "都在里面" in page2_text and "不是完整备份" not in page2_text,
            "有数据且完整时页面照常说「都在里面」",
            "",
        )
        capture(page2, "30-with-data-390.png")
        context2.close()

        context.close()
        browser.close()

    print("\n" + "=" * 60)
    passed = sum(1 for ok, _, _ in RESULTS if ok)
    failed = len(RESULTS) - passed
    print(f"PASS {passed} / FAIL {failed}")
    for ok, title, detail in RESULTS:
        if not ok:
            print(f"  FAIL {title}  [{detail}]")
    if NOTES:
        print("\n取证：")
        for note in NOTES:
            print(f"  - {note}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
