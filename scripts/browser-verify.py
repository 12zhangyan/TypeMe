"""TypeMe 可信度调整验收（**OEJTS 四维可选旧版本路径**）：真实浏览器走完「作答 → 报告 → 分享」全流程。

用法（项目根目录）：
    python scripts/browser-verify.py

> 站点默认量表已经是 **IPIP-50 大五**（见 `scripts/browser-verify-ipip.py`）。
> 这个脚本验收的是**可选旧版本 OEJTS 1.2（32 题）**，因此每个浏览器 context 都会先写入
> 内容版本偏好（`typeme.package.v1 = oejts32-zh1-report2`），让页面从 OEJTS 开始 ——
> 那也正是用户在首页「内容版本」里能做的选择，走的是同一条真实路径。

前置：
    - 前端 dev server（`npm run dev`，默认 http://127.0.0.1:5173）。
    - 后端**可选**：起着且已部署 v2 内容包时走 API 路径；否则页面用同 ID 内置副本，
      这本身就是一条要验收的降级路径。

环境变量：
    TYPEME_BASE   被测地址（默认 http://127.0.0.1:5173）
    TYPEME_LABEL  写进报告的说明
    TYPEME_OUT    截图与导出图目录（默认 docs/2026-09-15/verification/assessment-v2）

产出：
    <TYPEME_OUT>/*.png
    <TYPEME_OUT>/REPORT.md

本脚本对应 `docs/2026-09-15/TypeMe-测评可信度调整-开发方案.md` §10.3 / §10.4 的浏览器验收：
    全中立无默认类型、全部无法判断、部分维度不足、边界改答只影响一维、
    帮助展开不改变答案、混合数字与无法判断的刷新恢复、三类真实导出图、
    手机/PC 主流程、无横向溢出、无答案外发。
任何一条失败都会打印 FAIL 并计入退出码。
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

# Windows 控制台默认是 GBK：直接 print 中文/Unicode 减号会抛 UnicodeEncodeError，
# 也会把日志显示成乱码。这里显式改成 UTF-8 并允许替换无法编码的字符。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get("TYPEME_OUT", ROOT / "docs" / "2026-09-15" / "verification" / "assessment-v2"))
BASE = os.environ.get("TYPEME_BASE", "http://127.0.0.1:5173")
BASE_LABEL = os.environ.get("TYPEME_LABEL", "")

MOBILE = {"width": 390, "height": 844}
NARROW = {"width": 320, "height": 568}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1440, "height": 900}
LANDSCAPE = {"width": 844, "height": 390}

# 站点默认包（IPIP-50）之外的可选旧版本，本脚本验收的就是它。
LEGACY_PACKAGE_ID = "oejts32-zh1-report2"
PREFERRED_PACKAGE_KEY = "typeme.package.v1"


def new_context(browser, **kwargs):  # noqa: ANN001
    """每个 context 先写入内容版本偏好，让页面从 OEJTS 旧版本开始。

    站点默认已换成 IPIP-50，而**没有任何作答时**版本选择只存在本地偏好里；
    新 context 是空白 storage，不写这条偏好就会装载默认的大五包，
    本脚本全部 32 题 / 四字母断言都会测到错误的量表上。
    """
    context = browser.new_context(**kwargs)
    # add_init_script 收到**脚本正文**（不是箭头函数表达式：写成 `() => {...}` 只会
    # 创建一个没人调用的函数，偏好永远写不进去）。
    context.add_init_script(
        "try { localStorage.setItem('%s', '%s') } catch (e) {}"
        % (PREFERRED_PACKAGE_KEY, LEGACY_PACKAGE_ID)
    )
    return context

ALL_TYPE_CODES = [
    "INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP",
    "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP",
]
# 类型文章里的通行描述名（未定报告里一个都不该出现）
TYPE_NAMES = [
    "价值探索者", "系统规划者", "灵感连接者", "活力参与者", "细节照顾者",
]

failures: list[str] = []
notes: list[str] = []
passed = [0]


def check(condition: bool, label: str, detail: str = "") -> None:
    if condition:
        passed[0] += 1
        print(f"  PASS {label}")
    else:
        print(f"  FAIL {label} {detail}")
        failures.append(f"{label} {detail}".strip())


def no_horizontal_overflow(page: Page, label: str) -> None:
    metrics = page.evaluate(
        """() => ({
              scrollWidth: document.documentElement.scrollWidth,
              clientWidth: document.documentElement.clientWidth,
              bodyScroll: document.body.scrollWidth,
            })"""
    )
    check(
        metrics["scrollWidth"] <= metrics["clientWidth"] + 1
        and metrics["bodyScroll"] <= metrics["clientWidth"] + 1,
        f"{label} 无横向溢出",
        f"(scrollWidth={metrics['scrollWidth']} clientWidth={metrics['clientWidth']})",
    )


class Console:
    """只收集真正的运行时错误（未捕获异常 / 显式 console.error）。"""

    NETWORK_NOISE = "failed to load resource"

    def __init__(self, page: Page) -> None:
        self.errors: list[str] = []
        page.on("console", self._on_console)
        page.on("pageerror", lambda exc: self.errors.append(f"pageerror: {exc}"))

    def _on_console(self, message) -> None:  # noqa: ANN001
        if message.type != "error":
            return
        text = message.text or ""
        if self.NETWORK_NOISE in text.lower():
            return
        self.errors.append(f"console.error: {text}")

    def reset(self) -> None:
        self.errors.clear()


class Network:
    """记录所有请求，用来证明**没有把答案发出去**。"""

    def __init__(self, page: Page) -> None:
        self.requests: list[dict[str, str]] = []
        page.on("request", self._on_request)

    def _on_request(self, request) -> None:  # noqa: ANN001
        self.requests.append(
            {
                "method": request.method,
                "url": request.url,
                "body": request.post_data or "",
            }
        )

    def reset(self) -> None:
        self.requests.clear()

    def answer_leaks(self) -> list[str]:
        """有没有请求把逐题答案/分数带出去。"""
        leaks: list[str] = []
        for item in self.requests:
            url = item["url"]
            if item["method"] not in ("GET", "HEAD", "OPTIONS"):
                leaks.append(f"{item['method']} {url}")
            if url.count("%3A") > 3 or url.count(":,") > 3:
                leaks.append(f"URL 里疑似含逐题答案：{url[:120]}")
            if '"responses"' in item["body"] or '"answers"' in item["body"]:
                leaks.append(f"请求体里含 responses/answers：{url[:120]}")
        return leaks

    def foreign_hosts(self) -> list[str]:
        hosts = set()
        for item in self.requests:
            url = item["url"]
            if not url.startswith("http"):
                continue
            host = url.split("/")[2].split(":")[0]
            if host not in ("127.0.0.1", "localhost"):
                hosts.add(host)
        return sorted(hosts)


def shot(page: Page, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(OUT / name), full_page=False)
    print(f"  shot {name}")


def vis(page: Page, selector: str):
    """只取可见元素（同一动作在手机/PC 由不同节点渲染，另一处必然 display:none）。"""
    return page.locator(selector).locator("visible=true").first


def flat(text: str) -> str:
    return "".join(text.split())


def goto(page: Page, hash_path: str) -> None:
    page.goto(f"{BASE}/#{hash_path}", wait_until="load")
    page.wait_for_timeout(900)


def jump_to_question(page: Page, index: int) -> None:
    """跳到第 index 题（0 基），手机与 PC 的入口不同，这里统一处理。

    PC（≥1024px）的答题卡是左栏常驻的 `.qnum`，**没有**底部「答题卡」按钮；
    手机/平板才是抽屉。写死点按钮会在 PC 上直接超时。
    """
    drawer_button = page.locator("button:has-text('答题卡')").locator("visible=true")
    if drawer_button.count() > 0:
        drawer_button.first.click()
        page.wait_for_timeout(500)
        page.locator("[role='dialog'][aria-label='答题卡'] .qnum").nth(index).click()
    else:
        page.locator("aside .qnum").nth(index).click()
    page.wait_for_timeout(550)


def seed(page: Page, value: str) -> None:
    """用 dev-only 的 ?seed= 写入一份可复现答卷（见 frontend/src/dev/seed.ts）。"""
    page.goto(f"{BASE}/#/result?seed={value}", wait_until="load")
    page.wait_for_timeout(1400)
    page.goto(f"{BASE}/#/result", wait_until="load")
    page.wait_for_timeout(1600)


def seed_and_open_report(page: Page, value: str, label: str) -> None:
    """播种并**确认真的停在报告页**。

    不加这一条时，任何让结果页 replace 回答题页的回归都会让后续断言在答题页上假通过
    （答题页里也有「两边相近」这类词），整段验收就失去意义。
    """
    seed(page, value)
    if "#/result" not in page.url or page.locator("[data-report-hero]").count() == 0:
        check(False, f"{label} 播种后停在报告页", f"(url={page.url})")
        return
    check(True, f"{label} 播种后停在报告页")


def session_responses(page: Page) -> dict:
    raw = page.evaluate("() => localStorage.getItem('typeme.quiz.v3')")
    if not raw:
        return {}
    return json.loads(raw).get("responses", {})


def dimension_text(page: Page, dimension: str) -> str:
    node = page.locator(f"[data-dimension-text][data-dimension='{dimension}']")
    return node.first.inner_text() if node.count() else ""


def expect_no_type_code(text: str, label: str) -> None:
    for code in ALL_TYPE_CODES:
        check(code not in text, f"{label} 不出现类型码 {code}")
    for name in TYPE_NAMES:
        check(name not in text, f"{label} 不出现类型描述名「{name}」")


def read_report_model(page: Page) -> dict:
    """直接读取 Pinia 里的展示模型。

    页面、分享图片、复制文字、下载文件名与无障碍名称都消费同一个 `ReportViewModel`，
    因此对模型的断言同时覆盖了全部导出渠道；DOM 断言则验证页面确实用了它。

    ⚠️ 必须取 **store 实例**（`pinia._s.get('quiz')`），不能取 `pinia.state.value.quiz`：
    后者只是原始 state，没有 getter，`report` 会是 undefined，整段模型断言会假失败。
    """
    return page.evaluate(
        """() => {
            const app = document.querySelector('#app')?.__vue_app__;
            const pinia = app?.config?.globalProperties?.$pinia;
            const store = pinia?._s?.get ? pinia._s.get('quiz') : null;
            if (!store || !store.activePackage) return { available: false };
            const report = store.report;
            return {
                available: true,
                packageId: store.activePackage.packageId,
                source: store.packageSource,
                suggestedTypeCode: report ? report.suggestedTypeCode : null,
                overallStatus: report ? report.overallStatus : null,
                shareKind: report ? report.share.kind : null,
                shareText: report ? report.share.text : '',
                shareFilename: report ? report.share.filename : '',
                shareAlt: report ? report.share.alt : '',
                shareHeadline: report ? report.share.headline : null,
                shareTypeLine: report ? report.share.typeLine : null,
                reportId: report ? report.reportId : null,
                dimensionStatuses: report
                    ? report.dimensionRows.map((row) => row.dimension + ':' + row.status)
                    : [],
            };
        }"""
    )


def generate_and_export(
    page: Page, out_name: str, label: str, expected_filename: str
) -> bool:
    """点「生成分享卡片」→ 校验预览 → 真实下载到 OUT/<out_name>。

    `expected_filename` 是**展示模型里的文件名**（`report.share.filename`）：
    下载建议文件名必须与它一致，否则「未定结果在导出渠道回退成某个类型」这类缺陷
    会从文件名这一路漏过去。
    """
    vis(page, "button:has-text('生成分享卡片')").click()
    page.wait_for_timeout(1800)
    dialog = page.locator("[role='dialog'][aria-label='分享卡片预览']")
    if dialog.count() != 1:
        check(False, f"{label} 分享预览能打开")
        return False
    check(True, f"{label} 分享预览能打开")
    image = dialog.locator("img").first
    natural = image.evaluate("el => ({w: el.naturalWidth, h: el.naturalHeight})")
    check(
        (natural["w"], natural["h"]) in ((1080, 1920), (540, 960)),
        f"{label} 导出图尺寸为 1080×1920（或低内存 540×960）",
        str(natural),
    )
    alt = image.get_attribute("alt") or ""
    check(len(alt) > 10, f"{label} 图片有可读的无障碍名称", alt[:60])
    with page.expect_download(timeout=25000) as download_info:
        dialog.locator("button:has-text('下载图片')").click()
    download = download_info.value
    suggested = download.suggested_filename
    target = OUT / out_name
    download.save_as(str(target))
    size = target.stat().st_size if target.exists() else 0
    check(target.exists() and size > 5000, f"{label} 真实导出成功", f"{target.name} {size} bytes")
    check(
        suggested == expected_filename,
        f"{label} 下载文件名与展示模型一致",
        f"(suggested={suggested} expected={expected_filename})",
    )
    status = dialog.locator("[role='status']").inner_text()
    check("已发起下载" in status, f"{label} 下载提示如实（已发起下载）", status[:40])
    check("相册" not in status, f"{label} 不谎称已保存到相册")
    notes.append(f"{label}：导出 {out_name}（{size} bytes，建议文件名 {suggested}）")
    return True


def assert_model_share(page: Page, label: str, expect_code: str | None) -> None:
    """对展示模型的导出渠道做一次统一断言。"""
    model = read_report_model(page)
    check(model.get("available") is True, f"{label} 报告展示模型可读", str(model)[:120])
    if not model.get("available"):
        return
    for field in ("shareText", "shareAlt", "shareFilename"):
        value = str(model.get(field) or "")
        check(len(value) > 0, f"{label} 模型字段 {field} 非空")
    if expect_code is None:
        check(model.get("suggestedTypeCode") is None, f"{label} 模型没有完整类型")
        check(model.get("shareHeadline") is None, f"{label} 图片没有大字类型码")
        check(model.get("shareTypeLine") is None, f"{label} 图片没有类型信息行")
        for field in ("shareText", "shareAlt", "shareFilename"):
            expect_no_type_code(str(model.get(field) or ""), f"{label} 模型 {field}")
    else:
        check(model.get("suggestedTypeCode") == expect_code, f"{label} 模型给出参考组合 {expect_code}")
        check(model.get("shareHeadline") == expect_code, f"{label} 图片大字是参考组合")
        check(expect_code in str(model.get("shareText")), f"{label} 复制文字含类型码")


def warmup(browser) -> None:  # noqa: ANN001
    """先访问一次首页，等 Vite 把依赖预打包完。

    刚启动的 dev server 首次访问会触发依赖优化并自动刷新页面；不等它完成就断言，
    会读到一份还没挂载 Vue 的 HTML，于是首页文案断言假失败。
    """
    context = new_context(browser,viewport=DESKTOP)
    page = context.new_page()
    for _ in range(6):
        page.goto(f"{BASE}/#/", wait_until="load")
        page.wait_for_timeout(1500)
        if len(page.inner_text("body")) > 400:
            break
    context.close()
    print("  warmup 完成")


def main() -> int:  # noqa: C901
    OUT.mkdir(parents=True, exist_ok=True)
    api_path = "unknown"

    with sync_playwright() as p:
        browser = p.chromium.launch()
        warmup(browser)

        # ── 1. 首页（手机 / PC / 平板 / 窄屏） ──────────────────────────
        print("\n[1] 首页与开始前说明")
        for label, viewport in (
            ("mobile", MOBILE),
            ("pc", DESKTOP),
            ("tablet", TABLET),
            ("narrow320", NARROW),
        ):
            context = new_context(browser,
                viewport=viewport, device_scale_factor=2 if viewport == MOBILE else 1
            )
            page = context.new_page()
            console = Console(page)
            page.goto(f"{BASE}/#/", wait_until="load")
            page.wait_for_timeout(1200)
            text = page.inner_text("body")
            flat_text = flat(text)
            check("了解你的偏好" in text and "保留还不确定的部分" in text, f"{label} 首页主文案")
            # 说明与教学例子里有空格（「32 组」「左边是 1」），必须先归一化再比较，
            # 否则断言会因为没有那个空格而假失败。
            check(flat("32 组日常描述") in flat_text, f"{label} 首页测试前说明")
            check("暂时无法判断" in text, f"{label} 首页提到无法判断")
            check(
                flat("两边都读完：左边是 1，右边是 5。") in flat_text,
                f"{label} 教学例子第 1 条",
            )
            check(
                flat("3 表示理解之后觉得两侧差不多符合") in flat_text,
                f"{label} 教学例子第 2 条",
            )
            check("题目版本" in text, f"{label} 首页有题目版本选择")
            check("大五人格 50 题" in text, f"{label} 列出大五版")
            check("快速版 32 题" in text, f"{label} 列出 OEJTS 旧版本")
            for forbidden in (
                "oejts32-zh1-report2",
                "oejts32-zh2-preview-r1",
                "draft",
                "审校",
                "内容状态",
                "修订",
                "专业认证版",
            ):
                check(flat(forbidden) not in flat_text, f"{label} 首页不出现维护向字样「{forbidden}」")
            check("开始测试" in text, f"{label} 首页主按钮")
            check("你会得到什么" in text, f"{label} 首页价值三项")
            check("结果示例" in text and "不是你的结果" in text, f"{label} 首页示例标注")
            check("常见问题" in text, f"{label} 首页 FAQ")
            check("未获得" in text and "CC BY-NC-SA 4.0" in text, f"{label} 首页署名与许可")
            no_horizontal_overflow(page, f"{label} 首页")
            if label == "mobile":
                box = page.locator("button:has-text('开始测试')").first.bounding_box()
                check(
                    box is not None and box["y"] + box["height"] <= MOBILE["height"],
                    "mobile 首屏可见主按钮",
                    f"(bottom={None if box is None else round(box['y'] + box['height'])})",
                )
            shot(page, f"10-landing-{label}.png")
            check(not console.errors, f"{label} 首页无控制台错误", str(console.errors[:3]))

            if label == "pc":
                # 内容路径问 store（`packageSource`）：首页不展示这一行，
                # 靠文案猜会把 API 路径误报成 fallback。
                api_path = (
                    page.evaluate(
                        """() => {
                            const app = document.querySelector('#app')?.__vue_app__;
                            const pinia = app?.config?.globalProperties?.$pinia;
                            const store = pinia?._s?.get ? pinia._s.get('quiz') : null;
                            return store?.packageSource ?? null;
                        }"""
                    )
                    or "unknown"
                )
            context.close()

        # ── 2. 答题页：帮助、无法判断、计数、刷新恢复（手机） ────────────
        print("\n[2] 答题页（手机 390×844，真实作答）")
        context = new_context(browser,viewport=MOBILE, device_scale_factor=2)
        page = context.new_page()
        console = Console(page)
        network = Network(page)
        page.goto(f"{BASE}/#/", wait_until="load")
        page.wait_for_timeout(900)
        page.evaluate("() => localStorage.clear()")
        page.reload(wait_until="load")
        page.wait_for_timeout(900)
        goto(page, "/quiz")
        network.reset()

        check(page.locator("[role='radio']").count() == 5, "答题页有 5 个等权选项")
        check("哪一侧更接近平常的你？" in page.inner_text("body"), "答题页有题卡提示")
        shot(page, "20-quiz-mobile-q1.png")

        # 帮助展开不改变答案：未作答时展开，仍然没有答案
        vis(page, "button:has-text('这题是什么意思？')").click()
        page.wait_for_timeout(400)
        help_text = page.inner_text("body")
        check("如果仍不能判断" in help_text or "暂时无法判断" in help_text, "帮助文字在题卡内展开")
        check("先选择一个位置" in page.inner_text("body"), "展开帮助不产生答案（仍提示先选择）")
        check(session_responses(page) == {}, "展开帮助后会话里没有任何回答")
        shot(page, "21-quiz-mobile-help-open.png")

        # 选一个数字，再反复展开/收起帮助：答案不能变
        page.locator("[role='radio']").nth(2).click()
        page.wait_for_timeout(400)
        before_responses = session_responses(page)
        check(before_responses.get("1") == {"kind": "rating", "value": 3}, "第 1 题已保存为数字 3")
        for _ in range(2):
            vis(page, "button:has-text('这题是什么意思？')").click()
            page.wait_for_timeout(250)
        check(session_responses(page) == before_responses, "反复展开/收起帮助不改变答案与分数")
        vis(page, "button:has-text('这题是什么意思？')").click()
        page.wait_for_timeout(300)

        # 「暂时无法判断」：独立状态，不是 3 分
        page.locator("button:has-text('暂时无法判断')").first.click()
        page.wait_for_timeout(400)
        responses = session_responses(page)
        check(responses.get("1", {}).get("kind") == "unknown", "点「暂时无法判断」写入 unknown 状态")
        check(responses.get("1", {}).get("value") is None, "无法判断不携带任何分值（不是 3 分）")
        # 三档计数在手机上是「已处理 n/32」；「已选择倾向 / 待判断 / 尚未处理」的明细在 PC 左栏。
        check("已处理 1/32" in page.inner_text("body"), "顶部计数显示已处理 1/32")

        # 再点数字应替换 unknown（两者不可能同时存在）
        page.locator("[role='radio']").nth(4).click()
        page.wait_for_timeout(400)
        responses = session_responses(page)
        check(responses.get("1") == {"kind": "rating", "value": 5}, "再点数字会原子替换 unknown")

        # 键盘：数字键选择后焦点回到组内选项
        page.locator("#question-heading").click()
        page.keyboard.press("2")
        page.wait_for_timeout(400)
        check(session_responses(page).get("1") == {"kind": "rating", "value": 2}, "数字键可选择")
        focused_role = page.evaluate("() => document.activeElement?.getAttribute('role')")
        check(focused_role == "radio", "数字键选后焦点在选项上", str(focused_role))

        # 答题卡：状态标签 + 跳题
        vis(page, "button:has-text('答题卡')").click()
        page.wait_for_timeout(600)
        drawer = page.locator("[role='dialog'][aria-label='答题卡']")
        check(drawer.count() == 1, "答题卡抽屉打开")
        check(drawer.locator(".qnum").count() == 32, "答题卡有 32 个题号")
        label1 = drawer.locator(".qnum").first.get_attribute("aria-label") or ""
        check("已选倾向" in label1, "题号 accessible name 说明已选倾向", label1)
        label2 = drawer.locator(".qnum").nth(1).get_attribute("aria-label") or ""
        check("未处理" in label2, "题号 accessible name 说明未处理", label2)
        drawer.locator(".qnum").nth(4).click()
        page.wait_for_timeout(600)
        check("第 5 题" in page.locator("#question-heading").inner_text(), "点题号可跳到第 5 题")

        # 未作答时「下一题」给出提示且不前进
        vis(page, "button:has-text('下一题')").click()
        page.wait_for_timeout(400)
        check("先选择一个位置" in page.inner_text("body"), "未处理时「下一题」给出可见提示")
        check("第 5 题" in page.locator("#question-heading").inner_text(), "未处理时不前进")

        # 混合数字 + 无法判断，然后刷新恢复
        page.locator("[role='radio']").nth(1).click()
        page.wait_for_timeout(300)
        vis(page, "button:has-text('答题卡')").click()
        page.wait_for_timeout(500)
        page.locator("[role='dialog'][aria-label='答题卡'] .qnum").nth(7).click()
        page.wait_for_timeout(500)
        page.locator("button:has-text('暂时无法判断')").first.click()
        page.wait_for_timeout(400)
        expected = session_responses(page)
        goto(page, "/quiz")
        page.wait_for_timeout(900)
        restored = session_responses(page)
        check(restored == expected, "刷新后混合（数字 + 无法判断）记录完整恢复")
        check("已处理 3/32" in page.inner_text("body"), "刷新后已处理数量保留")
        vis(page, "button:has-text('答题卡')").click()
        page.wait_for_timeout(500)
        label8 = page.locator("[role='dialog'][aria-label='答题卡'] .qnum").nth(7).get_attribute(
            "aria-label"
        )
        check("待判断" in (label8 or ""), "刷新后待判断题号仍标为待判断", str(label8))
        page.locator("[role='dialog'][aria-label='答题卡'] button:has-text('关闭')").click()
        page.wait_for_timeout(400)
        shot(page, "22-quiz-mobile-mixed.png")
        check(not console.errors, "答题过程无控制台错误", str(console.errors[:3]))
        context.close()

        # ── 3. 全中立：所有渠道都没有默认类型（手机 + PC） ──────────────
        print("\n[3] 全中立（四维相近）—— 不得出现任何默认类型")
        for label, viewport in (("mobile", MOBILE), ("pc", DESKTOP)):
            context = new_context(browser,
                viewport=viewport,
                device_scale_factor=2 if viewport == MOBILE else 1,
                accept_downloads=True,
            )
            page = context.new_page()
            console = Console(page)
            seed_and_open_report(page, "3", label)
            text = page.inner_text("body")
            check("没有显示明确方向" in flat(text), f"{label} 全中立标题来自内容包")
            model = read_report_model(page)
            check(model.get("overallStatus") == "undetermined", f"{label} 整体状态是 undetermined")
            check(model.get("shareKind") == "undetermined", f"{label} 分享版式是 undetermined")
            check(
                model.get("shareFilename") == "typeme-profile-undetermined.png",
                f"{label} 文件名是 undetermined 而不是类型",
                str(model.get("shareFilename")),
            )
            check(
                all(item.endswith(":balanced") for item in model.get("dimensionStatuses", [])),
                f"{label} 四维状态都是 balanced",
                str(model.get("dimensionStatuses")),
            )
            assert_model_share(page, label, None)
            # 页面渠道
            expect_no_type_code(text, f"{label} 全中立页面")
            check("本次问卷参考组合" not in text, f"{label} 全中立不出现「参考组合」标题")
            check("可选参考阅读" not in text, f"{label} 无参考组合时不提供类型参考阅读")
            # 「信息不足」在方法说明里是解释性文字，因此这里用维度条上的「未计分」判定：
            # 它只在真的有信息不足维度时出现。
            check("未计分" not in text, f"{label} 全中立没有未计分的维度")
            share_text = page.locator("[data-share-text]").inner_text()
            expect_no_type_code(share_text, f"{label} 全中立页面上的复制文字")
            check("没有形成完整参考类型" in share_text, f"{label} 复制文字说明未形成完整类型")
            no_horizontal_overflow(page, f"{label} 全中立报告")
            shot(page, f"30-result-undetermined-{label}.png")
            if label == "pc":
                ok = generate_and_export(
                    page,
                    "share-export-undetermined-1080x1920.png",
                    "均衡（未定）",
                    "typeme-profile-undetermined.png",
                )
                check(ok, "均衡导出成功")
                shot(page, "31-share-undetermined-pc.png")
            check(not console.errors, f"{label} 全中立无控制台错误", str(console.errors[:3]))
            context.close()

        # ── 4. 部分维度未定（SN 略偏）：完整类型为空，其他维照常 ─────────
        print("\n[4] 部分维度未定（−12/+4/−8/+10）")
        for label, viewport in (("mobile", MOBILE), ("pc", DESKTOP)):
            context = new_context(browser,
                viewport=viewport,
                device_scale_factor=2 if viewport == MOBILE else 1,
                accept_downloads=True,
            )
            page = context.new_page()
            console = Console(page)
            seed_and_open_report(page, "ref-partial", label)
            text = page.inner_text("body")
            expect_no_type_code(text, f"{label} 部分未定页面")
            check("还有待观察的部分" in text, f"{label} 部分未定标题")
            check("略偏" in text, f"{label} 待观察维度写出「略偏」")
            model = read_report_model(page)
            check(model.get("overallStatus") == "partial", f"{label} 整体状态是 partial")
            check(
                model.get("shareFilename") == "typeme-profile-partial.png",
                f"{label} 部分未定文件名固定为 partial",
                str(model.get("shareFilename")),
            )
            check(
                any(item.endswith(":tentative") for item in model.get("dimensionStatuses", [])),
                f"{label} 存在待观察维度",
                str(model.get("dimensionStatuses")),
            )
            assert_model_share(page, label, None)
            check("可选参考阅读" not in text, f"{label} 部分未定时不提供类型参考阅读")
            share_text = page.locator("[data-share-text]").inner_text()
            expect_no_type_code(share_text, f"{label} 部分未定页面上的复制文字")
            check("没有形成完整参考类型" in share_text, f"{label} 部分未定复制文字说明未形成类型")
            no_horizontal_overflow(page, f"{label} 部分未定报告")
            shot(page, f"32-result-partial-{label}.png")
            if label == "pc":
                ok = generate_and_export(
                    page,
                    "share-export-partial-1080x1920.png",
                    "部分未定",
                    "typeme-profile-partial.png",
                )
                check(ok, "部分未定导出成功")
                shot(page, "33-share-partial-pc.png")
            check(not console.errors, f"{label} 部分未定无控制台错误", str(console.errors[:3]))
            context.close()

        # ── 5. 有明确参考组合（−12/+8/−8/+10 → INFP） ───────────────────
        print("\n[5] 有参考组合 → INFP")
        for label, viewport in (("mobile", MOBILE), ("pc", DESKTOP)):
            context = new_context(browser,
                viewport=viewport,
                device_scale_factor=2 if viewport == MOBILE else 1,
                accept_downloads=True,
            )
            page = context.new_page()
            console = Console(page)
            seed_and_open_report(page, "ref-typed", label)
            text = page.inner_text("body")
            check("INFP" in text, f"{label} 参考组合显示 INFP")
            model = read_report_model(page)
            check(model.get("overallStatus") == "typed", f"{label} 整体状态是 typed")
            check(
                model.get("shareFilename") == "typeme-profile-INFP.png",
                f"{label} 文件名为 typeme-profile-INFP.png",
                str(model.get("shareFilename")),
            )
            assert_model_share(page, label, "INFP")
            check("可选参考阅读" in text, f"{label} 有参考组合时才出现参考阅读入口")
            check("本次问卷参考组合" in text, f"{label} 明确标注「本次问卷参考组合」")
            check("类型参考介绍" in text, f"{label} 参考阅读有明确标识")
            check("价值探索者" not in text, f"{label} 未点击前不加载类型文章")
            page.locator("button:has-text('类型介绍（参考资料）')").first.click()
            page.wait_for_timeout(1400)
            check("价值探索者" in page.inner_text("body"), f"{label} 点击后加载类型文章（参考阅读）")
            no_horizontal_overflow(page, f"{label} 参考组合报告")
            shot(page, f"34-result-typed-{label}.png")
            if label == "pc":
                ok = generate_and_export(
                    page,
                    "share-export-INFP-1080x1920.png",
                    "完整参考组合",
                    "typeme-profile-INFP.png",
                )
                check(ok, "完整参考组合导出成功")
                shot(page, "35-share-typed-pc.png")
            check(not console.errors, f"{label} 参考组合无控制台错误", str(console.errors[:3]))
            context.close()

        # ── 6. 边界改答：只影响 SN，其他三维解释逐字不变 ────────────────
        print("\n[6] 边界改答（把 SN 从 +8 改成 +4）")
        context = new_context(browser,viewport=DESKTOP)
        page = context.new_page()
        console = Console(page)
        seed_and_open_report(page, "ref-typed", "边界改答")
        check("INFP" in page.inner_text("body"), "改答前：参考组合 INFP")
        before = {dimension: dimension_text(page, dimension) for dimension in ("EI", "TF", "JP")}
        check(all(value for value in before.values()), "改答前三个维度都有解释文本")
        before_share = page.locator("[data-share-text]").inner_text()
        before_model = read_report_model(page)
        # 通过真实界面改两题（Q4、Q8 是 SN 的正号题，种子把它们设为 5）
        goto(page, "/quiz")
        for question_index in (3, 7):
            jump_to_question(page, question_index)
            check(
                f"第 {question_index + 1} 题" in page.locator("#question-heading").inner_text(),
                f"跳到第 {question_index + 1} 题",
            )
            page.locator("[role='radio']").nth(2).click()
            page.wait_for_timeout(350)
        jump_to_question(page, 31)
        vis(page, "button:has-text('查看报告')").click()
        page.wait_for_timeout(2000)
        check("#/result" in page.url, "改答后回到报告页", page.url)
        after_text = page.inner_text("body")
        check("INFP" not in after_text, "边界改答后参考组合被正确撤销")
        check("还有待观察的部分" in after_text, "改答后变为部分未定报告")
        after = {dimension: dimension_text(page, dimension) for dimension in ("EI", "TF", "JP")}
        for dimension in ("EI", "TF", "JP"):
            check(
                after[dimension] == before[dimension] and after[dimension] != "",
                f"改答后 {dimension} 维度的解释逐字不变",
            )
        after_model = read_report_model(page)
        check(after_model.get("reportId") != before_model.get("reportId"), "改答后 reportId 变化（旧分享失效）")
        after_share = page.locator("[data-share-text]").inner_text()
        check(after_share != before_share, "改答后分享文字随之更新")
        expect_no_type_code(after_share, "改答后复制文字")
        shot(page, "36-result-boundary-after.png")
        check(not console.errors, "边界改答流程无控制台错误", str(console.errors[:3]))
        context.close()

        # ── 7. 全部无法判断：未定报告，没有伪造分数 ─────────────────────
        print("\n[7] 全部无法判断")
        context = new_context(browser,viewport=MOBILE, device_scale_factor=2)
        page = context.new_page()
        console = Console(page)
        seed_and_open_report(page, "unknown", "全部无法判断")
        text = page.inner_text("body")
        check("这次先保留未定" in text, "全部无法判断 → 未定报告标题")
        check("信息不足" in text, "显示信息不足状态")
        check("未计分" in text, "维度条标为未计分（不画 0 分）")
        check("本次得分" not in text, "没有任何「本次得分」伪造分数字样")
        expect_no_type_code(text, "全部无法判断页面")
        model = read_report_model(page)
        check(model.get("suggestedTypeCode") is None, "全部无法判断时模型没有类型")
        check(
            model.get("shareFilename") == "typeme-profile-undetermined.png",
            "全部无法判断时文件名不含类型",
            str(model.get("shareFilename")),
        )
        check(
            all(item.endswith(":insufficient") for item in model.get("dimensionStatuses", [])),
            "四维都是信息不足",
            str(model.get("dimensionStatuses")),
        )
        assert_model_share(page, "全部无法判断", None)
        no_horizontal_overflow(page, "全部无法判断报告")
        shot(page, "37-result-all-unknown-mobile.png")
        check(not console.errors, "全部无法判断无控制台错误", str(console.errors[:3]))
        context.close()

        # ── 8. 部分维度信息不足（SN 3 题有答案 + 5 题无法判断） ─────────
        print("\n[8] 部分维度信息不足")
        context = new_context(browser,viewport=DESKTOP)
        page = context.new_page()
        console = Console(page)
        seed_and_open_report(page, "mixed", "部分信息不足")
        text = page.inner_text("body")
        model = read_report_model(page)
        check(
            any(item.endswith(":insufficient") for item in model.get("dimensionStatuses", [])),
            "存在信息不足的维度",
            str(model.get("dimensionStatuses")),
        )
        check(
            any(item.endswith(":leaning") for item in model.get("dimensionStatuses", [])),
            "其余维度仍然给出有效方向",
            str(model.get("dimensionStatuses")),
        )
        check("可选参考阅读" not in text, "存在信息不足维度时不提供参考组合阅读")
        check("完整类型为空" in flat(text) or "没有形成完整参考类型" in flat(text), "明确说明完整类型为空")
        check("本次得分" in text, "其余维度仍给出有效分数")
        check("未计分" in text, "信息不足的维度标为未计分")
        assert_model_share(page, "部分信息不足", None)
        no_horizontal_overflow(page, "部分信息不足报告")
        shot(page, "38-result-mixed-desktop.png")
        check(not console.errors, "部分信息不足无控制台错误", str(console.errors[:3]))
        context.close()

        # ── 9. 旧版记录提示与关于页 ─────────────────────────────────────
        print("\n[9] 旧版记录提示与关于页")
        context = new_context(browser,viewport=DESKTOP)
        page = context.new_page()
        console = Console(page)
        page.goto(f"{BASE}/#/", wait_until="load")
        page.wait_for_timeout(900)
        page.evaluate(
            """() => {
                localStorage.setItem('typeme.quiz.v2', JSON.stringify({
                    schemaVersion: 2,
                    questionnaire: null,
                    questionnaireSignature: 'x',
                    answers: {},
                    currentQuestionId: 1,
                    startedAt: 1,
                    updatedAt: 1,
                    completedAt: null,
                    reportProfile: null,
                }));
            }"""
        )
        page.reload(wait_until="load")
        page.wait_for_timeout(1400)
        # 坏 v2 记录不应让页面崩溃
        check("开始测试" in page.inner_text("body") or "继续测试" in page.inner_text("body"),
              "坏 v2 记录不影响首页可用")
        page.evaluate("() => localStorage.removeItem('typeme.quiz.v2')")
        goto(page, "/about")
        text = page.inner_text("body")
        check("无法判断" in text, "关于页解释无法判断")
        check("信息不足" in text, "关于页解释信息不足")
        check("题目答案与计分在你的浏览器中处理" in text, "关于页统一隐私表达")
        check("不存储任何数据" not in text, "关于页不写「不存储任何数据」")
        check("保存了什么" in text and "清除本地记录" in text, "关于页保留本地记录说明与清除入口")
        for forbidden in (
            "typeme.quiz.v3",
            "typeme.package.v1",
            "localStorage",
            "内容包",
            "解释政策",
            "内容状态",
            "draft",
            "审校",
            "服务端",
            "内置副本",
            "旧版本（OEJTS 32 题）的方法说明",
        ):
            check(flat(forbidden) not in flat(text), f"关于页不出现维护细节「{forbidden}」")
        no_horizontal_overflow(page, "关于页")
        shot(page, "40-about-desktop.png")
        check(not console.errors, "关于页无控制台错误", str(console.errors[:3]))
        context.close()

        # ── 10. 横屏与极窄 ─────────────────────────────────────────────
        print("\n[10] 横屏与极窄")
        context = new_context(browser,viewport=LANDSCAPE)
        page = context.new_page()
        goto(page, "/quiz")
        check(page.locator("[role='radio']").count() == 5, "横屏答题页选项完整")
        no_horizontal_overflow(page, "横屏答题页")
        shot(page, "41-quiz-landscape.png")
        page.set_viewport_size({"width": 195, "height": 422})
        page.wait_for_timeout(500)
        no_horizontal_overflow(page, "195px 极窄答题页")
        context.close()

        # ── 11. 无答案外发 ─────────────────────────────────────────────
        print("\n[11] 隐私：没有把答案发出去")
        context = new_context(browser,viewport=DESKTOP)
        page = context.new_page()
        network = Network(page)
        seed_and_open_report(page, "ref-typed", "隐私检查")
        vis(page, "button:has-text('生成分享卡片')").click()
        page.wait_for_timeout(1500)
        leaks = network.answer_leaks()
        check(not leaks, "作答与分享期间没有把答案发到任何请求", str(leaks[:3]))
        foreign = network.foreign_hosts()
        check(not foreign, "没有访问任何第三方主机", str(foreign))
        get_only = all(item["method"] in ("GET", "HEAD", "OPTIONS") for item in network.requests)
        check(get_only, "全部请求都是只读 GET", str([item["method"] for item in network.requests][:6]))
        notes.append(
            f"隐私检查：{len(network.requests)} 个请求，全部 GET，无第三方主机，无 answers/responses 载荷"
        )
        context.close()

        browser.close()

    # ── 报告 ───────────────────────────────────────────────────────────
    lines = [
        "# TypeMe 可信度调整 · 浏览器验收记录",
        "",
        f"- 被测地址：{BASE}" + (f"（{BASE_LABEL}）" if BASE_LABEL else ""),
        f"- 内容路径：{'服务端 v2 内容包 API' if api_path == 'api' else '内置副本降级（服务端未提供 v2 内容包）'}",
        "- 浏览器：Playwright + Chromium（headless）",
        "- 视口：390×844、320×568、768×1024、1440×900、844×390 横屏、195×422（模拟 200% 缩放）",
        "",
        "## 断言结果",
        "",
        f"- 通过：{passed[0]} 条；失败：{len(failures)} 条",
        "",
        "## 产物",
        "",
    ]
    for path in sorted(OUT.glob("*.png")):
        lines.append(f"- `{path.name}`（{path.stat().st_size} bytes）")
    lines += ["", "## 备注", ""]
    lines += [f"- {item}" for item in notes] if notes else ["- 无"]
    lines += [
        "",
        "- 本轮验收覆盖开发方案 §10.3 / §10.4 的浏览器条目：全中立无默认类型、全部无法判断、"
        "部分维度不足、边界改答只影响一维、帮助展开不改变答案、混合数字与无法判断的刷新恢复、"
        "三类真实导出图、手机/PC 主流程、无横向溢出、无答案外发。",
        "- **未验证**：iOS Safari / Android Chrome **真机**（本机没有真机与对应内核）；"
        "微信等内置浏览器未测；未做 Lighthouse 分数类评估。",
        "- 截图与导出图只证明工程行为与版式，不构成任何心理测量结论。",
    ]
    if failures:
        lines += ["", "## 失败项", ""]
        lines += [f"- {item}" for item in failures]
    (OUT / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"\n{'=' * 60}")
    print(f"失败 {len(failures)} 项" + ("" if failures else "，全部通过"))
    for item in failures:
        print(f"  - {item}")
    print(f"产物目录：{OUT}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
