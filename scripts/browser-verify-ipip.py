"""TypeMe 验收：站点默认量表换成 **IPIP-50 大五**之后的真实浏览器全流程。

用法（项目根目录）：
    python scripts/browser-verify-ipip.py

前置：
    - 前端 dev server（`npm run dev`，默认 http://127.0.0.1:5173）。
    - 后端可选：起着且已注册 `ipip50-zh1` 时走 API 路径；否则页面用同 ID 内置副本，
      这本身就是一条要验收的降级路径。

环境变量：
    TYPEME_BASE   被测地址（默认 http://127.0.0.1:5173）
    TYPEME_LABEL  写进报告的说明
    TYPEME_OUT    截图与导出图目录（默认 docs/2026-09-15/verification/assessment-ipip50）

产出：
    <TYPEME_OUT>/*.png
    <TYPEME_OUT>/REPORT.md

与 `browser-verify.py`（OEJTS 可选旧版本路径）的分工：
    这个脚本验收**默认入口**：五维、无类型码、单句贴切度作答、五维结果驱动报告，
    以及三类真实导出图（clear / partial / undetermined）。
    任何一条失败都会打印 FAIL 并计入退出码。
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(
    os.environ.get("TYPEME_OUT", ROOT / "docs" / "2026-09-15" / "verification" / "assessment-ipip50")
)
BASE = os.environ.get("TYPEME_BASE", "http://127.0.0.1:5173")
BASE_LABEL = os.environ.get("TYPEME_LABEL", "")

MOBILE = {"width": 390, "height": 844}
NARROW = {"width": 320, "height": 568}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1440, "height": 900}

PACKAGE_ID = "ipip50-zh1"
DIMENSIONS = ["E", "A", "C", "ES", "O"]
DIMENSION_NAMES = ["外向性", "宜人性", "尽责性", "情绪稳定性", "开放性"]

ALL_TYPE_CODES = [
    "INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP",
    "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP",
]
TYPE_NAMES = [
    "价值探索者", "系统规划者", "灵感连接者", "活力参与者", "细节照顾者",
]
ANCHORS = ["非常不贴切", "有些不贴切", "谈不上贴切或不贴切", "有些贴切", "非常贴切"]

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


def flat(text: str) -> str:
    return "".join(text.split())


def has(text: str, needle: str) -> bool:
    """忽略空白的包含判断（页面会在「50 题」这类地方插入不换行空格）。"""
    return flat(needle) in flat(text)


def shot(page: Page, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(OUT / name), full_page=False)
    print(f"  shot {name}")


def vis(page: Page, selector: str):
    return page.locator(selector).locator("visible=true").first


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
            {"method": request.method, "url": request.url, "body": request.post_data or ""}
        )

    def reset(self) -> None:
        self.requests.clear()

    def answer_leaks(self) -> list[str]:
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


_nav_counter = [0]


def goto(page: Page, hash_path: str, wait: int = 900) -> None:
    """导航到某个 hash 路由，**强制一次真正的文档加载**。

    `page.goto` 在只有 hash 变化时是 same-document navigation，不会再触发 `load`，
    于是 App 的 `onMounted` 不会重跑、`?seed=` 不会被应用（验收会静默地在答题页上
    假通过）。这里每次换一个无关的查询参数，保证是新的文档加载。
    """
    _nav_counter[0] += 1
    page.goto(f"{BASE}/?nav={_nav_counter[0]}#{hash_path}", wait_until="load")
    page.wait_for_timeout(wait)


def seed(page: Page, value: str) -> None:
    """用 dev-only 的 `?seed=` 写入一份可复现答卷（见 frontend/src/dev/seed.ts）。

    两步：先在带 `?seed=` 的文档加载里播种（App 挂载后写入真实会话并提交），
    再重新加载一次报告页，走**正常的恢复路径**读取刚写下的会话。
    """
    goto(page, f"/result?seed={value}", wait=1600)
    goto(page, "/result", wait=1500)


def seed_and_open_report(page: Page, value: str, label: str) -> None:
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


def read_report_model(page: Page) -> dict:
    """直接读 Pinia 里的展示模型（页面/图片/复制文字/文件名共用它）。"""
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
                instrumentId: store.activePackage.instrument?.id ?? null,
                hasTypeCode: store.activePackage.instrument?.hasTypeCode ?? null,
                source: store.packageSource,
                total: store.total,
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
                lowTokens: report
                    ? report.dimensionRows.map((row) => row.lowToken)
                    : [],
                highTokens: report
                    ? report.dimensionRows.map((row) => row.highToken)
                    : [],
                dimensionCount: report ? report.dimensionCount : null,
            };
        }"""
    )


def expect_no_type_artifacts(text: str, label: str) -> None:
    for code in ALL_TYPE_CODES:
        check(code not in text, f"{label} 不出现类型码 {code}")
    for name in TYPE_NAMES:
        check(name not in text, f"{label} 不出现类型描述名「{name}」")


def dimension_text(page: Page, dimension: str) -> str:
    node = page.locator(f"[data-dimension-text][data-dimension='{dimension}']")
    return node.first.inner_text() if node.count() else ""


def assert_model(page: Page, label: str, expect_kind: str, expect_filename: str) -> dict:
    """对展示模型做一次统一断言：五维、无类型码、导出渠道一致。"""
    model = read_report_model(page)
    check(model.get("available") is True, f"{label} 报告展示模型可读", str(model)[:120])
    if not model.get("available"):
        return model
    check(model.get("packageId") == PACKAGE_ID, f"{label} 用的是 IPIP-50 内容包")
    check(model.get("instrumentId") == "ipip50", f"{label} 仪器是 ipip50")
    check(model.get("hasTypeCode") is False, f"{label} 该量表不产出类型码")
    check(model.get("total") == 50, f"{label} 题数是 50")
    check(model.get("shareKind") == expect_kind, f"{label} 分享类型是 {expect_kind}", str(model))
    check(
        model.get("shareFilename") == expect_filename,
        f"{label} 文件名是 {expect_filename}",
        str(model.get("shareFilename")),
    )
    check(model.get("suggestedTypeCode") is None, f"{label} 模型没有完整类型")
    check(model.get("shareHeadline") is None, f"{label} 图片没有大字类型码")
    check(model.get("shareTypeLine") is None, f"{label} 图片没有类型信息行")
    for field in ("shareText", "shareAlt", "shareFilename"):
        value = str(model.get(field) or "")
        check(len(value) > 0, f"{label} 模型字段 {field} 非空")
        expect_no_type_artifacts(value, f"{label} 模型 {field}")
    statuses = model.get("dimensionStatuses") or []
    check(
        [item.split(":")[0] for item in statuses] == DIMENSIONS,
        f"{label} 报告按五个维度逐个给结果",
        str(statuses),
    )
    check(
        (model.get("lowTokens") or []) == ["低"] * len(DIMENSIONS),
        f"{label} 低端记号是内容包的「低」",
        str(model.get("lowTokens")),
    )
    check(
        (model.get("highTokens") or []) == ["高"] * len(DIMENSIONS),
        f"{label} 高端记号是内容包的「高」",
        str(model.get("highTokens")),
    )
    return model


def generate_and_export(page: Page, out_name: str, label: str, expected_filename: str) -> bool:
    """点「生成分享卡片」→ 校验预览 → 真实下载到 OUT/<out_name>。"""
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
    expect_no_type_artifacts(alt, f"{label} 图片 alt")
    shot(page, f"31-share-preview-{label}.png")
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


def read_content_source(page: Page, timeout_ms: int = 10000) -> str:
    """等内容包装载完成后读出 `packageSource`（api / fallback）。

    首页文案在内置副本上也能渲染，所以刚加载完就读会拿到 store 的初始值
    `fallback`，把 API 路径误报成降级路径。这里轮询到真的装载完成。
    """
    deadline_ms = timeout_ms
    while deadline_ms > 0:
        source = page.evaluate(
            """() => {
                const app = document.querySelector('#app')?.__vue_app__;
                const pinia = app?.config?.globalProperties?.$pinia;
                const store = pinia?._s?.get ? pinia._s.get('quiz') : null;
                if (!store || !store.activePackage) return null;
                return store.packageSource ?? null;
            }"""
        )
        if source:
            return source
        page.wait_for_timeout(250)
        deadline_ms -= 250
    return "unknown"


def warmup(browser) -> None:  # noqa: ANN001
    context = browser.new_context(viewport=DESKTOP)
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

        # ── 1. 首页：默认就是大五，五维说明，没有四字母示例 ─────────────
        print("\n[1] 首页（手机 / PC / 平板 / 窄屏）")
        for label, viewport in (
            ("mobile", MOBILE),
            ("pc", DESKTOP),
            ("tablet", TABLET),
            ("narrow320", NARROW),
        ):
            context = browser.new_context(
                viewport=viewport, device_scale_factor=2 if viewport == MOBILE else 1
            )
            page = context.new_page()
            console = Console(page)
            page.goto(f"{BASE}/#/", wait_until="load")
            page.wait_for_timeout(1400)
            text = page.inner_text("body")
            flat_text = flat(text)
            check("了解你的偏好" in text and "保留还不确定的部分" in text, f"{label} 首页主文案")
            check(flat("大五人格倾向自测 · 50 题") in flat_text, f"{label} 首页标出大五 50 题")
            check(flat("50 组日常描述") in flat_text, f"{label} 首页测试前说明是 50 题")
            check("暂时无法判断" in text, f"{label} 首页提到无法判断")
            check("会测到的五个维度" in text, f"{label} 首页写明五个维度")
            for dimension, name in zip(DIMENSIONS, DIMENSION_NAMES):
                check(
                    page.locator(f"[data-dimension-list] [data-dimension='{dimension}']").count() == 1,
                    f"{label} 首页维度行 {dimension}（{name}）",
                )
                check(name in text, f"{label} 首页维度名 {name}")
            check("IPIP" in text and "公有领域" in text, f"{label} 首页署名是 IPIP 公有领域")
            check("非官方测评" in text, f"{label} 首页写明非官方测评")
            check(
                flat_text.count(flat("基于 OEJTS 1.2，非官方 MBTI 测验")) == 0,
                f"{label} 默认量表不写「基于 OEJTS」",
            )
            check(
                page.locator("[data-result-example]").count() == 0,
                f"{label} 首页没有四字母结果示例卡",
            )
            check("INFP" not in text, f"{label} 首页不出现 INFP")
            check("题目版本" in text, f"{label} 首页有题目版本选择")
            check("大五人格 50 题" in text, f"{label} 默认版用干净版本名")
            check("快速版 32 题" in text, f"{label} 可选旧版本用干净版本名")
            # 部署版：维护向元信息不进界面
            for forbidden in (
                PACKAGE_ID,
                "oejts32-zh1-report2",
                "oejts32-zh2-preview-r1",
                "draft",
                "审校",
                "内容状态",
                "修订",
                "专业认证版",
            ):
                check(
                    not has(text, forbidden),
                    f"{label} 首页不出现维护向字样「{forbidden}」",
                )
            check("开始测试" in text, f"{label} 首页主按钮")
            check("你会得到什么" in text, f"{label} 首页价值三项")
            check(has(text, "五个维度各自的结果，而不是一个标签"), f"{label} 价值三项按五维讲")
            check(not has(text, "四个维度的结果"), f"{label} 首页不留四维拼类型的说法")
            check(
                has(text, "每题是一句自我描述：1 表示非常不贴切，5 表示非常贴切。"),
                f"{label} 教学例子按单句贴切度讲",
            )
            check(not has(text, "两边都读完"), f"{label} 教学例子不留 OEJTS 的双极说法")
            check("常见问题" in text, f"{label} 首页 FAQ")
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
                # 内容路径要问 store（`packageSource`），不要去猜页面文案：
                # 首页并不展示这一行，靠文案判断会把 API 路径误报成 fallback。
                api_path = read_content_source(page)
            context.close()

        # ── 2. 首页切到 OEJTS 旧版本：刷新后不能悄悄换题 ────────────────
        print("\n[2] 题目版本偏好（刷新恢复）")
        context = browser.new_context(viewport=DESKTOP)
        page = context.new_page()
        page.goto(f"{BASE}/#/", wait_until="load")
        page.wait_for_timeout(1200)
        page.evaluate("() => localStorage.clear()")
        page.reload(wait_until="load")
        page.wait_for_timeout(1200)
        check(has(page.inner_text("body"), "50 题"), "清空本地记录后回到默认大五 50 题")
        page.locator("input[value='oejts32-zh1-report2']").first.check()
        page.wait_for_timeout(1200)
        check(has(page.inner_text("body"), "32 题"), "首页切到 OEJTS 后题数变成 32")
        page.reload(wait_until="load")
        page.wait_for_timeout(1400)
        after_reload = page.inner_text("body")
        check(
            has(after_reload, "32 题"),
            "刷新后仍然是用户选的那一版（没有悄悄换回默认）",
            flat(after_reload)[:80],
        )
        check("会测到的四个维度" in after_reload, "刷新后仍显示四维说明")
        shot(page, "15-version-preference-oejts.png")
        # 回到默认大五，后面的验收都走默认入口
        page.locator("input[value='ipip50-zh1']").first.check()
        page.wait_for_timeout(1200)
        page.reload(wait_until="load")
        page.wait_for_timeout(1400)
        check(has(page.inner_text("body"), "50 题"), "再切回默认大五（偏好双向可改）")
        context.close()

        # ── 3. 答题页：单句贴切度、帮助、计数、刷新恢复（手机） ──────────
        print("\n[3] 答题页（手机 390×844，真实作答）")
        context = browser.new_context(viewport=MOBILE, device_scale_factor=2)
        page = context.new_page()
        console = Console(page)
        network = Network(page)
        page.goto(f"{BASE}/#/", wait_until="load")
        page.wait_for_timeout(900)
        page.evaluate("() => localStorage.clear()")
        page.reload(wait_until="load")
        page.wait_for_timeout(1200)
        goto(page, "/quiz")
        network.reset()

        check(page.locator("[role='radio']").count() == 5, "答题页有 5 个等权选项")
        quiz_text = page.inner_text("body")
        check("这句描述对你有多贴切？" in quiz_text, "答题页用 IPIP 的单句贴切度提示")
        for forbidden in ("draft", "审校", "内容包", "服务端", "内置副本", "typeme.quiz.v3"):
            check(not has(quiz_text, forbidden), f"答题页不出现维护细节「{forbidden}」")
        check("哪一侧更接近平常的你？" not in quiz_text, "答题页不再出现 OEJTS 的双极提示")
        check("左边这一侧" not in quiz_text and "右边这一侧" not in quiz_text, "不再有左右两侧陈述")
        for anchor in ANCHORS:
            check(anchor in quiz_text, f"选项文案含「{anchor}」")
        check(PACKAGE_ID in flat(quiz_text) or "大五" in quiz_text, "答题页标出当前量表")
        shot(page, "20-quiz-mobile-q1.png")

        vis(page, "button:has-text('这题是什么意思？')").click()
        page.wait_for_timeout(400)
        check("如果仍不能判断" in page.inner_text("body") or "暂时无法判断" in page.inner_text("body"),
              "帮助文字在题卡内展开")
        check("先选择一个位置" in page.inner_text("body") or "先选择" in page.inner_text("body"),
              "展开帮助不产生答案")
        check(session_responses(page) == {}, "展开帮助后会话里没有任何回答")
        shot(page, "21-quiz-mobile-help-open.png")

        page.locator("[role='radio']").nth(3).click()
        page.wait_for_timeout(500)
        first = session_responses(page)
        check(len(first) == 1, "选一个分值后会话里有 1 条回答")
        check("已处理1/50" in flat(page.inner_text("body")), "进度显示 已处理 1/50")
        shot(page, "22-quiz-mobile-answered.png")

        # 刷新恢复：答案与题号都要回来
        page.reload(wait_until="load")
        page.wait_for_timeout(1500)
        restored = session_responses(page)
        check(restored == first, "刷新后答案原样恢复", f"{restored} != {first}")
        check(
            page.locator("[role='radio'][aria-checked='true']").count() == 1,
            "刷新后选中态也恢复",
        )
        check(not console.errors, "答题页无控制台错误", str(console.errors[:3]))

        # 「暂时无法判断」不是 3 分
        page.locator("button:has-text('暂时无法判断')").first.click()
        page.wait_for_timeout(500)
        marked = session_responses(page)
        check(
            marked.get("1", {}).get("kind") == "unknown",
            "「暂时无法判断」单独存成 unknown（不是 3 分）",
            str(marked.get("1")),
        )
        check("已处理1/50" in flat(page.inner_text("body")), "标记后仍是 1/50（不重复计数）")
        shot(page, "23-quiz-mobile-unknown.png")

        # 答题卡题数
        vis(page, "button:has-text('答题卡')").click()
        page.wait_for_timeout(500)
        dialog = page.locator("[role='dialog'][aria-label='答题卡']")
        check(dialog.locator(".qnum").count() == 50, "答题卡有 50 个题号")
        shot(page, "24-quiz-mobile-cards.png")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

        # 隐私：答题过程中没有把答案发出去
        leaks = network.answer_leaks()
        check(not leaks, "作答期间没有把答案发出去", str(leaks[:3]))
        foreign = network.foreign_hosts()
        check(not foreign, "作答期间没有第三方域名请求", str(foreign))
        context.close()

        # ── 4. 报告：五维结果驱动（手机 + PC） ──────────────────────────
        print("\n[4] 报告：五维结果驱动")
        context = browser.new_context(viewport=MOBILE, device_scale_factor=2)
        page = context.new_page()
        console = Console(page)
        page.goto(f"{BASE}/#/", wait_until="load")
        page.wait_for_timeout(900)
        page.evaluate("() => localStorage.clear()")
        page.reload(wait_until="load")
        page.wait_for_timeout(1000)

        # 4.1 全中立：五个维度都是「本次两侧相近」
        seed_and_open_report(page, "3", "全中立")
        neutral = assert_model(page, "全中立", "undetermined", "typeme-profile-undetermined.png")
        check(
            all(item.endswith(":balanced") for item in neutral.get("dimensionStatuses", [])),
            "全中立时五个维度都是两侧相近",
            str(neutral.get("dimensionStatuses")),
        )
        neutral_text = page.inner_text("body")
        check("五个维度" in neutral_text or "五维" in neutral_text, "报告按五维描述")
        check(
            "五个维度上的结果" in neutral_text,
            "报告标题按当前包的维度数写「五个维度上的结果」",
        )
        check("四个维度" not in neutral_text, "报告里不残留「四个维度」")
        # 导出图与页面共用同一个模型：两端记号是大五的「低/高」，
        # 曾经这里查 OEJTS 专用常量，页面留白、导出图直接画出 "undefined"
        check("undefined" not in neutral_text, "报告页面不出现字面量 undefined")
        for dimension in DIMENSIONS:
            check(
                dimension_text(page, dimension) != "",
                f"报告给出 {dimension} 维度的结论行",
            )
            check(
                "相近" in dimension_text(page, dimension),
                f"{dimension} 维度如实写「两侧相近」",
                dimension_text(page, dimension)[:40],
            )
            row_text = dimension_text(page, dimension)
            check("低" in row_text and "高" in row_text, f"{dimension} 维度两端记号是低/高", row_text[:60])
        expect_no_type_artifacts(neutral_text, "全中立报告")
        check(
            page.locator("[data-type-reference]").count() == 0,
            "全中立报告不展开任何类型文章",
        )
        shot(page, "40-report-neutral-mobile.png")

        # 4.2 全部无法判断：信息不足，不给任何分数
        seed_and_open_report(page, "unknown", "全部无法判断")
        unknown = assert_model(page, "全部无法判断", "undetermined", "typeme-profile-undetermined.png")
        check(
            all(item.endswith(":insufficient") for item in unknown.get("dimensionStatuses", [])),
            "全部无法判断时五个维度都信息不足",
            str(unknown.get("dimensionStatuses")),
        )
        unknown_text = page.inner_text("body")
        check("信息不足" in unknown_text, "全部无法判断时页面写明信息不足")
        expect_no_type_artifacts(unknown_text, "全部无法判断报告")
        shot(page, "41-report-unknown-mobile.png")

        # 4.3 部分维度不足：其余维度照常给方向
        seed_and_open_report(page, "mixed", "部分维度信息不足")
        mixed = assert_model(page, "部分维度信息不足", "partial", "typeme-profile-partial.png")
        statuses = dict(item.split(":") for item in mixed.get("dimensionStatuses", []))
        check(statuses.get("ES") == "insufficient", "mixed 下 ES 维度信息不足", str(statuses))
        check(
            sum(1 for value in statuses.values() if value in ("leaning", "tentative")) >= 3,
            "其余维度仍然给出方向（不因一维不足全部作废）",
            str(statuses),
        )
        shot(page, "42-report-partial-mobile.png")

        # 4.4 五维都有方向：clear（没有类型码，但有明确方向）
        seed_and_open_report(page, "ref-typed", "五维都有方向")
        clear = assert_model(page, "五维都有方向", "clear", "typeme-profile-clear.png")
        check(
            all(item.endswith(":leaning") for item in clear.get("dimensionStatuses", [])),
            "ref-typed 下五个维度都达到展示条件",
            str(clear.get("dimensionStatuses")),
        )
        clear_text = page.inner_text("body")
        check("五个维度" in clear_text or "本次" in clear_text, "clear 报告的总结语按五维给")
        check(
            "本次偏好概览（每个维度都有方向）" in clear_text,
            "clear 抬头的说法与「每个维度都有方向」一致",
        )
        check(
            "本次偏好概览（没有明确方向）" not in clear_text,
            "clear 抬头不许写成「没有明确方向」",
        )
        check("undefined" not in clear_text, "clear 报告页面不出现字面量 undefined")
        check("五个维度上的结果" in clear_text, "clear 报告标题写「五个维度上的结果」")
        # `<details>` 折叠内容不进 innerText，先展开「怎么看这份报告」的第一条再读
        page.locator("#method summary").first.click()
        page.wait_for_timeout(300)
        method_text = page.locator("#method").inner_text()
        check("完整结论就为空" in method_text, "大五报告说「完整结论」而不是「完整类型」")
        check("四个维度" not in method_text, "方法说明里不写死四维")
        check("undefined" not in method_text, "方法说明里不出现字面量 undefined")
        # 部署版：报告页也不出现维护细节
        for forbidden in (
            PACKAGE_ID,
            "解释政策",
            "内容状态",
            "审校",
            "服务端",
            "内置副本",
            "typeme.quiz.v3",
        ):
            check(not has(clear_text, forbidden), f"报告页面不出现维护细节「{forbidden}」")
            check(not has(method_text, forbidden), f"报告说明里不出现维护细节「{forbidden}」")
        check("这不是 MBTI 官方测评" not in clear_text, "大五报告不挂 MBTI 免责声明")
        expect_no_type_artifacts(clear_text, "clear 报告")
        check(
            page.locator("[data-type-reference]").count() == 0,
            "大五报告不提供任何四字母类型文章",
        )
        shot(page, "43-report-clear-mobile.png")

        # 4.5 每维前半/后半反向：总量回中点 → 又是两侧相近
        seed_and_open_report(page, "opposing", "正负相抵")
        opposing = assert_model(page, "正负相抵", "undetermined", "typeme-profile-undetermined.png")
        check(
            all(item.endswith(":balanced") for item in opposing.get("dimensionStatuses", [])),
            "正负相抵时五个维度都回到两侧相近",
            str(opposing.get("dimensionStatuses")),
        )

        # 4.6 一维达到展示条件、一维刚刚进入待观察（ref-partial）
        seed_and_open_report(page, "ref-partial", "一维待观察")
        partial = assert_model(page, "一维待观察", "partial", "typeme-profile-partial.png")
        partial_statuses = dict(item.split(":") for item in partial.get("dimensionStatuses", []))
        check(partial_statuses.get("A") == "tentative", "ref-partial 下 A 维度只是待观察", str(partial_statuses))
        check(
            sum(1 for value in partial_statuses.values() if value == "leaning") == 4,
            "其余四维仍然达到展示条件",
            str(partial_statuses),
        )

        # 4.7 未处理完不许停在结果页
        goto(page, "/result")
        page.evaluate("() => localStorage.clear()")
        goto(page, "/result")
        check("#/quiz" in page.url or "#/result" in page.url, "清空后访问 /result 有明确去处", page.url)

        check(not console.errors, "报告流程无控制台错误", str(console.errors[:3]))
        context.close()

        # ── 5. PC 报告 + 三类真实导出图 ────────────────────────────────
        print("\n[5] PC 报告与三类导出图")
        context = browser.new_context(viewport=DESKTOP)
        page = context.new_page()
        console = Console(page)
        page.goto(f"{BASE}/#/", wait_until="load")
        page.wait_for_timeout(900)
        page.evaluate("() => localStorage.clear()")
        page.reload(wait_until="load")
        page.wait_for_timeout(1000)

        seed_and_open_report(page, "ref-typed", "PC 五维都有方向")
        assert_model(page, "PC 五维都有方向", "clear", "typeme-profile-clear.png")
        no_horizontal_overflow(page, "PC 报告页")
        shot(page, "50-report-clear-pc.png")
        generate_and_export(page, "export-clear.png", "clear", "typeme-profile-clear.png")

        seed_and_open_report(page, "mixed", "PC 部分维度信息不足")
        assert_model(page, "PC 部分维度信息不足", "partial", "typeme-profile-partial.png")
        shot(page, "51-report-partial-pc.png")
        generate_and_export(page, "export-partial.png", "partial", "typeme-profile-partial.png")

        seed_and_open_report(page, "3", "PC 全中立")
        assert_model(page, "PC 全中立", "undetermined", "typeme-profile-undetermined.png")
        shot(page, "52-report-neutral-pc.png")
        generate_and_export(
            page, "export-undetermined.png", "undetermined", "typeme-profile-undetermined.png"
        )

        check(not console.errors, "PC 报告与导出无控制台错误", str(console.errors[:3]))
        context.close()

        # ── 6. 关于页：只留用户需要的事实（部署版） ────────────────────
        print("\n[6] 关于页（默认大五）")
        context = browser.new_context(viewport=MOBILE, device_scale_factor=2)
        page = context.new_page()
        page.goto(f"{BASE}/#/about", wait_until="load")
        page.wait_for_timeout(1400)
        about = page.inner_text("body")
        about_flat = flat(about)
        check("5 个维度" in about or "五个维度" in about, "关于页写明五个维度")
        check("没有类型码" in about, "关于页写明大五没有类型码")
        check("IPIP" in about and "公有领域" in about, "关于页写明 IPIP 公有领域")
        check("不是心理诊断" in about_flat or "不做诊断" in about, "关于页保留免责说明")
        check("保存了什么" in about, "关于页说明本地保存了什么")
        check("清除本地记录" in about, "关于页保留清除入口")
        # 维护细节一律不进访客页面（部署版要求）
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
            "packageId",
        ):
            check(not has(about, forbidden), f"关于页不出现维护细节「{forbidden}」")
        # 内容路径仍然要从 store 读，写进验收记录（不再依赖页面文案）
        actual_source = read_content_source(page)
        check(actual_source in ("api", "fallback"), "内容装载路径可读", actual_source)
        no_horizontal_overflow(page, "关于页")
        page.screenshot(path=str(OUT / "60-about-mobile.png"), full_page=True)
        print("  shot 60-about-mobile.png（整页）")
        context.close()

        browser.close()

    lines = [
        "# TypeMe 大五（IPIP-50）默认入口验收记录",
        "",
        f"- 被测地址：`{BASE}`",
        f"- 内容路径：{api_path}（api = 走服务端内容包；fallback = 服务端不可用时的同 ID 内置副本）",
        f"- 说明：{BASE_LABEL or '脚本自动生成'}",
        f"- 结果：**{passed[0]} 条通过，{len(failures)} 条失败**",
        "",
        "## 验收项",
        "",
        "1. 首页：大五 50 题 / 五维说明 / 无四字母示例卡 / IPIP 公有领域署名 / 版本名干净（手机、PC、平板、320 窄屏）",
        "2. 题目版本偏好：首页切到 OEJTS 旧版本后刷新仍是旧版本，可再切回默认",
        "3. 答题页：单句贴切度五档、帮助展开不产生答案、暂时无法判断不是 3 分、刷新恢复、答题卡 50 题",
        "4. 报告：五维结果驱动（全中立 / 全部无法判断 / 部分不足 / 五维都有方向 / 正负相抵 / 一维待观察）",
        "   每个报告都断言：两端记号是「低/高」、标题写「五个维度上的结果」、页面不出现字面量 undefined",
        "5. 导出：clear / partial / undetermined 三类真实图片，文件名与展示模型一致",
        "6. 关于页：只留用户需要的事实，维护细节（包 ID / 键名 / draft / 服务端 / 内置副本）一律不出现",
        "",
        "## 产出图片",
        "",
    ]
    for item in sorted(OUT.glob("*.png")):
        lines.append(f"- `{item.name}`（{item.stat().st_size // 1024} KiB）")
    if notes:
        lines += ["", "## 导出", ""] + [f"- {item}" for item in notes]
    lines += ["", "## 失败项", ""]
    lines += [f"- {item}" for item in failures] if failures else ["- 无"]
    (OUT / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"\n通过 {passed[0]} 条，失败 {len(failures)} 条")
    for item in failures:
        print(f"  FAIL {item}")
    print(f"报告：{OUT / 'REPORT.md'}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
