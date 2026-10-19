"""第 96 轮：第 46–95 轮页面改动的 320 / 390 / 1440 浏览器复核。

接口全部由 Playwright 拦截，不连接后端、不读不写数据库；
账号资料与报告都是合成值，截图里不含密码、令牌、恢复码或个人答卷。

运行前先构建前端并静态托管 `frontend/dist`（见同目录 REPORT.md）。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import Browser, Page, sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OUT = Path(__file__).resolve().parent / "shots"
BASE = "http://127.0.0.1:5191"
WIDTHS = ((320, 720), (390, 844), (1440, 900))

PROFILE = {
    "userId": "user-browser",
    "username": "browser_owner",
    "nickname": None,
    "createdAt": "2026-10-14T00:00:00Z",
    "passwordChangedAt": None,
}

CATALOG = {
    "packageId": "typeme-jung48-zh-v1",
    "instrumentId": "typeme-jung48",
    "scoringVersion": "typeme-jung48-score-v1",
    "reportContentVersion": "typeme-type-report-zh-v1",
    "contentStatus": "draft_review_pending",
    "title": "十六型人格参考测评",
    "questionCount": 64,
    "basePerDimension": 12,
    "clarificationPerDimension": 4,
    "maxClarificationItems": 16,
    "sha256": "a" * 64,
    "dimensions": [
        {"dimension": code, "name": name, "question": "这一维问什么",
         "negativePole": "I", "negativeLabel": "左", "positivePole": "E", "positiveLabel": "右"}
        for code, name in (("EI", "精力方向"), ("SN", "信息取向"), ("TF", "决策依据"), ("JP", "生活节奏"))
    ],
}

JUNG_CARD = {
    "slug": "jung48", "kind": "jung", "title": "十六型人格参考测评",
    "tagline": "四个维度各自比较", "summary": "按日常选择看四个维度的倾向。",
    "whatYouLearn": ["四个维度各自更靠哪一侧"], "notFor": ["招聘筛选", "诊断"],
    "format": "bipolar", "hasTypeCode": True, "supportsClarification": True,
    "dimensions": ["EI", "SN", "TF", "JP"], "defaultPackageId": "typeme-jung48-zh-v1",
    "baseItemCount": 48, "clarificationItemCount": 16, "maxClarificationItems": 16,
    "estimatedMinutes": 15, "contentStatus": "draft_review_pending",
}

BIGFIVE_CARD = {
    "slug": "bigfive50", "kind": "big_five", "title": "大五人格倾向测评",
    "tagline": "五个方面分别说明", "summary": "按符合程度评价 50 句自我描述。",
    "whatYouLearn": ["五个方面各自的倾向"], "notFor": ["诊断", "给人贴标签"],
    "format": "agreement", "hasTypeCode": False, "supportsClarification": False,
    "dimensions": ["E", "A", "C", "ES", "O"], "defaultPackageId": "typeme-bigfive50-zh-v1",
    "baseItemCount": 50, "clarificationItemCount": 0, "maxClarificationItems": 0,
    "estimatedMinutes": 12, "contentStatus": "reviewed",
}

QUESTIONS = [{"id": f"q{i}", "stage": "base", "dimension": ("EI", "SN", "TF", "JP")[(i - 1) % 4],
              "order": i} for i in range(1, 5)]
QUESTIONS.append({"id": "c1", "stage": "clarification", "dimension": "EI", "order": 101})

PACKAGE = {
    "schemaVersion": 1,
    "packageId": "typeme-jung48-zh-v1",
    "instrument": {
        "id": "typeme-jung48", "revision": "r1",
        "scoringVersion": "typeme-jung48-score-v1",
        "reportContentVersion": "typeme-type-report-zh-v1",
        "format": "bipolar", "hasTypeCode": True,
        "baseItemsPerDimension": 1, "clarificationItemsPerDimension": 1,
        "maxClarificationItems": 4,
    },
    "title": "十六型人格参考测评",
    "contentStatus": "draft_review_pending",
    "scoringPolicy": {
        "version": "typeme-jung48-score-v1", "minBaseRatingsPerDimension": 1,
        "boundaryNumerator": 2, "boundaryDenominator": 5,
        "ratingMin": 1, "ratingMax": 5, "ratingNeutral": 3,
    },
    "dimensions": [
        {
            "dimension": code, "name": f"维度 {code}", "question": "这一维问什么",
            "negativePole": {"pole": "I", "label": "内倾", "description": "独处恢复精力。", "dailySigns": ["话不多"]},
            "positivePole": {"pole": "E", "label": "外倾", "description": "与人来往恢复精力。", "dailySigns": ["话多"]},
            "balanced": {"summary": "两边接近。", "reading": "两边都可以读。"},
            "tiedNotice": "这一维两边接近。",
        }
        for code in ("EI", "SN", "TF", "JP")
    ],
    "questions": [
        {
            "id": question["id"], "stage": question["stage"], "dimension": question["dimension"],
            "scenario": f"情境 {question['id']}", "textLeft": f"左边 {question['id']}",
            "textRight": f"右边 {question['id']}", "leftPole": "I", "rightPole": "E",
            "help": "这一题的短释义。", "facet": "facet", "order": question["order"],
            "reviewStatus": "reviewed",
        }
        for question in QUESTIONS
    ],
    "sha256": "c" * 64,
}

JUNG_DETAIL = {
    "attemptId": "attempt-jung", "packageId": PACKAGE["packageId"],
    "status": "BASE_IN_PROGRESS", "revision": 7, "currentQuestionId": None,
    "clarificationDimensions": [], "clarificationSkipped": False,
    "startedAt": "2026-10-14T01:00:00Z", "updatedAt": "2026-10-14T02:00:00Z",
    "submittedAt": None, "reportId": None, "baseAttemptId": None,
    "answers": [], "coverage": [], "packageContent": PACKAGE,
}


def bigfive_items() -> list[dict]:
    return [{
        "id": f"Q{index:02d}", "kind": "agreement_statement", "stage": "base",
        "dimension": ["E", "A", "C", "ES", "O"][(index - 1) // 10], "order": index,
        "scenario": None, "left": None, "right": None,
        "statement": f"陈述句 {index}", "leftPole": None, "rightPole": None,
        "direction": 1, "help": f"第 {index} 题的短释义。",
    } for index in range(1, 51)]


BIGFIVE_DETAIL = {
    "attemptId": "attempt-bigfive", "instrumentSlug": "bigfive50",
    "instrumentKind": "big_five", "instrumentTitle": "大五人格倾向测评",
    "packageId": "typeme-bigfive50-zh-v1", "reportKind": "big_five_profile",
    "status": "DRAFT", "revision": 3, "currentQuestionId": None,
    "clarificationDimensions": [], "clarificationSkipped": False,
    "startedAt": "2026-10-14T01:00:00Z", "updatedAt": "2026-10-14T02:00:00Z",
    "submittedAt": None, "baseAttemptId": None, "reportId": None,
    "answers": [], "items": bigfive_items(), "answeredCount": 0,
    "requiredCount": 50, "answerComplete": False,
}

JUNG_DRAFT = {
    "attemptId": "attempt-jung", "instrumentSlug": "jung48", "instrumentKind": "jung",
    "instrumentTitle": "十六型人格参考测评", "packageId": PACKAGE["packageId"],
    "reportContentVersion": None, "status": "BASE_IN_PROGRESS", "revision": 3,
    "startedAt": "2026-10-14T01:00:00Z", "updatedAt": "2026-10-14T02:34:00Z",
    "submittedAt": None, "reportId": None, "reportStatus": None,
    "computedTypeCode": None, "answeredCount": 10, "requiredCount": 48,
}

BIGFIVE_DRAFT = {
    "attemptId": "attempt-bigfive", "instrumentSlug": "bigfive50",
    "instrumentKind": "big_five", "instrumentTitle": "大五人格倾向测评",
    "packageId": "typeme-bigfive50-zh-v1", "reportContentVersion": None,
    "status": "DRAFT", "revision": 3, "startedAt": "2026-10-13T01:00:00Z",
    "updatedAt": "2026-10-13T04:34:00Z", "submittedAt": None, "reportId": None,
    "reportStatus": None, "computedTypeCode": None,
    "answeredCount": 9, "requiredCount": 50,
}

JUNG_CLARIFICATION_DRAFT = {
    **JUNG_DRAFT, "status": "CLARIFICATION_IN_PROGRESS",
    "answeredCount": 48, "requiredCount": 48, "revision": 9,
}

JUNG_REPORTS = [
    {"reportId": "report-jung-1", "attemptId": "attempt-1", "instrumentSlug": "jung48",
     "instrumentKind": "jung", "instrumentTitle": "十六型人格参考测评",
     "reportKind": "jung_reference", "packageId": PACKAGE["packageId"],
     "status": "TIED", "computedTypeCode": None,
     "summaryLine": "四个维度里有两个方向接近。", "createdAt": "2026-10-12T03:00:00Z"},
    {"reportId": "report-jung-2", "attemptId": "attempt-2", "instrumentSlug": "jung48",
     "instrumentKind": "jung", "instrumentTitle": "十六型人格参考测评",
     "reportKind": "jung_reference", "packageId": PACKAGE["packageId"],
     "status": "REFERENCE", "computedTypeCode": "INFP",
     "summaryLine": "四个维度都给出了方向。", "createdAt": "2026-10-10T03:00:00Z"},
]

BIGFIVE_REPORT = {
    "reportId": "report-bigfive-1", "attemptId": "attempt-bf", "instrumentSlug": "bigfive50",
    "instrumentKind": "big_five", "instrumentTitle": "大五人格倾向测评",
    "reportKind": "big_five_profile", "packageId": "typeme-bigfive50-zh-v1",
    "status": "PROFILE", "computedTypeCode": None,
    "summaryLine": "五个方面各自给出了说明。", "createdAt": "2026-10-11T03:00:00Z",
}

COMPARE_RESULT = {
    "reports": [JUNG_REPORTS[0] | {"scoringVersion": "typeme-jung48-score-v1"},
                JUNG_REPORTS[1] | {"scoringVersion": "typeme-jung48-score-v1"}],
    "differences": [
        {"dimension": "EI", "fromPole": None, "toPole": None, "fromMFinal": None,
         "toMFinal": None, "changed": False},
        {"dimension": "SN", "fromPole": "S", "toPole": "N", "fromMFinal": 2,
         "toMFinal": -2, "changed": True},
    ],
    "samePackage": True,
    "notes": ["同一内容包版本才计算变化。"],
}

LEGACY_REPORTS = [
    {"reportId": "report-jung-1", "attemptId": "attempt-1", "createdAt": "2026-10-12T03:00:00Z",
     "status": "TIED", "computedTypeCode": None, "selfSelectedTypeCode": None,
     "summaryLine": "四个维度里有两个方向接近。", "packageId": PACKAGE["packageId"],
     "scoringVersion": "typeme-jung48-score-v1"},
    {"reportId": "report-jung-2", "attemptId": "attempt-2", "createdAt": "2026-10-10T03:00:00Z",
     "status": "REFERENCE", "computedTypeCode": "INFP", "selfSelectedTypeCode": None,
     "summaryLine": "四个维度都给出了方向。", "packageId": PACKAGE["packageId"],
     "scoringVersion": "typeme-jung48-score-v1"},
]


class Api:
    """一个很小的状态机：同一套接口，按页面需要切换草稿列表。"""

    def __init__(self) -> None:
        self.drafts: list[dict] = [JUNG_DRAFT]
        self.unknown: list[str] = []

    def fulfill(self, route) -> None:
        request = route.request
        path = urlparse(request.url).path
        method = request.method.upper()
        if path.endswith("/auth/csrf"):
            return self.json(route, {"token": "csrf", "headerName": "X-XSRF-TOKEN", "parameterName": "_csrf"})
        if path.endswith("/me"):
            return self.json(route, PROFILE)
        if path.endswith("/catalog/current"):
            return self.json(route, CATALOG)
        if path.endswith("/platform/illustrations"):
            return self.json(route, {"release": None, "version": "browser-1", "assets": []})
        if path.endswith("/admin/ai-settings"):
            # 公共壳上的管理员探针：非管理员拿到 403 是正常路径，要显式应答，
            # 否则会以 404 落进控制台，把"页面有没有异常"这条断言污染掉。
            return self.json(route, {"code": "FORBIDDEN", "message": "没有权限。",
                                     "requestId": "req-admin", "details": {}}, 403)
        if path.endswith("/platform/instruments"):
            return self.json(route, {"items": [JUNG_CARD, BIGFIVE_CARD]})
        if path.endswith("/platform/instruments/jung48"):
            return self.json(route, {
                "instrument": JUNG_CARD,
                "dimensions": [{
                    "dimension": code, "name": f"维度 {code}", "question": "这一维问什么",
                    "lowLabel": "左端", "lowDescription": "左端描述", "lowSigns": ["左端表现"],
                    "highLabel": "右端", "highDescription": "右端描述", "highSigns": ["右端表现"],
                    "balancedSummary": "两边接近时。", "caution": "不要拿它贴标签。",
                    "observation": "留意不同场合。",
                } for code in ("EI", "SN", "TF", "JP")],
                "versions": [],
            })
        if path.endswith("/platform/instruments/bigfive50"):
            return self.json(route, {
                "instrument": BIGFIVE_CARD,
                "dimensions": [{
                    "dimension": code, "name": f"方面 {code}", "question": "这一方面问什么",
                    "lowLabel": "低端", "lowDescription": "低端描述", "lowSigns": ["低端表现"],
                    "highLabel": "高端", "highDescription": "高端描述", "highSigns": ["高端表现"],
                    "balancedSummary": "中间附近。", "caution": "不要拿它贴标签。",
                    "observation": "留意不同场合。",
                } for code in ("E", "A", "C", "ES", "O")],
                "versions": [],
            })
        if "/platform/attempts" in path and "scope=open" in request.url:
            return self.json(route, {"items": self.drafts, "page": 0, "size": 50, "total": len(self.drafts)})
        if path.endswith("/attempts") and "status=draft" in request.url:
            return self.json(route, {"items": [], "page": 0, "size": 20, "total": 0})
        if path.endswith("/platform/attempts/attempt-jung/metadata"):
            return self.json(route, {"attemptId": "attempt-jung", "instrumentKind": "jung", "status": "BASE_IN_PROGRESS"})
        if path.endswith("/platform/attempts/attempt-bigfive/metadata"):
            return self.json(route, {"attemptId": "attempt-bigfive", "instrumentKind": "big_five", "status": "DRAFT"})
        if path.endswith("/platform/attempts/attempt-bigfive") and method == "GET":
            return self.json(route, BIGFIVE_DETAIL)
        if path.endswith("/attempts/attempt-jung") and method == "GET":
            return self.json(route, JUNG_DETAIL)
        if path.endswith("/platform/reports"):
            kind = "big_five" if "kind=big_five" in request.url else None
            items = [BIGFIVE_REPORT] if kind == "big_five" else JUNG_REPORTS + [BIGFIVE_REPORT] if kind is None else JUNG_REPORTS
            return self.json(route, {"items": items, "page": 0, "size": 50, "total": len(items)})
        if path.endswith("/reports/compare"):
            return self.json(route, COMPARE_RESULT)
        if path.endswith("/reports") and method == "GET":
            return self.json(route, {"items": LEGACY_REPORTS, "page": 0, "size": 50, "total": 2})
        self.unknown.append(f"{method} {request.url}")
        return self.json(route, {"code": "NOT_FOUND", "message": "browser stub", "requestId": None, "details": {}}, 404)

    @staticmethod
    def json(route, body: dict, status: int = 200) -> None:
        route.fulfill(status=status, content_type="application/json", body=json.dumps(body, ensure_ascii=False))


def overflow(page: Page) -> int:
    return page.evaluate(
        "() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)"
    )


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []
    checks: list[dict] = []
    api = Api()

    def check(ok: bool, label: str, detail: str = "") -> None:
        checks.append({"label": label, "passed": bool(ok)})
        if not ok:
            failures.append(f"{label}{('：' + detail) if detail else ''}")

    console_noise: list[str] = []

    def open_page(browser: Browser, width: int, height: int, route_path: str) -> tuple[Page, list[str]]:
        context = browser.new_context(viewport={"width": width, "height": height})
        context.route("**/api/v3/**", api.fulfill)
        page = context.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        # 控制台里的 "Failed to load resource" 是**接口状态**（这里刻意让管理员探针拿 403），
        # 不是页面脚本抛出的异常；单独收集，不混进"未捕获异常"。
        page.on(
            "console",
            lambda message: console_noise.append(message.text)
            if message.type == "error" and "Failed to load resource" in message.text
            else errors.append(message.text) if message.type == "error" else None,
        )
        page.goto(f"{BASE}/#{route_path}", wait_until="networkidle")
        return page, errors

    def shoot(page: Page, name: str, width: int) -> None:
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(120)
        page.screenshot(path=str(OUT / f"{name}-{width}.png"), full_page=False)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)

        for width, height in WIDTHS:
            # ── 1. 首页：十六型草稿 ────────────────────────────────────────
            api.drafts = [JUNG_DRAFT]
            page, errors = open_page(browser, width, height, "/")
            page.wait_for_selector("[data-resume-entry]", timeout=8000)
            note = page.locator("[data-resume-note]").inner_text()
            check("已答 10/48 题" in note, f"{width}/首页续答：说明里是十六型主测进度", note)
            check("上次答到" in note, f"{width}/首页续答：说明里有上次作答时间", note)
            hero = page.locator("[data-hero]").inner_text()
            check("十六型人格参考测评" in hero, f"{width}/首页首屏：量表名是十六型", hero[:120])
            check("主测 48 题" in hero, f"{width}/首页首屏：题数是主测 48", hero[:120])
            check("暂时无法判断" in hero, f"{width}/首页首屏：十六型保留「暂时无法判断」口径", hero[:200])
            check(page.locator("[data-dimension-list] [data-dimension]").count() == 4,
                  f"{width}/首页：四个维度")
            check(page.locator("[data-result-example]").count() == 1, f"{width}/首页：十六型结果示例仍在")
            check(overflow(page) <= 1, f"{width}/首页（十六型）无横向溢出")
            check(len(errors) == 0, f"{width}/首页（十六型）无未捕获异常", "; ".join(errors[:2]))
            shoot(page, "home-jung", width)
            page.context.close()

            # ── 2. 首页：大五草稿 ──────────────────────────────────────────
            api.drafts = [BIGFIVE_DRAFT]
            page, errors = open_page(browser, width, height, "/")
            page.wait_for_selector("[data-resume-entry]", timeout=8000)
            note = page.locator("[data-resume-note]").inner_text()
            check("已答 9/50 题" in note, f"{width}/首页大五续答：按大五题数写进度", note)
            check("主测" not in note, f"{width}/首页大五续答：不把大五进度写成主测", note)
            body = page.locator("body").inner_text()
            check("接着答：大五人格倾向测评" in body, f"{width}/首页大五续答：折叠标题按大五写")
            check("五个方面分别说明" in body, f"{width}/首页大五续答：维度口径是五个方面")
            # 来源说明在默认收起的 <details> 里（不是在首屏上一直摊开），先展开再读。
            page.locator("[data-instrument-attribution]").evaluate("el => el.closest('details').open = true")
            attribution = page.locator("[data-instrument-attribution]").inner_text()
            check("IPIP-50" in attribution, f"{width}/首页大五续答：来源说明是 IPIP-50", attribution[:160])
            for banned in ("主测 48 题", "四个维度分别成结论"):
                check(banned not in body, f"{width}/首页大五续答：不出现十六型口径「{banned}」")
            # 图鉴里本来就有 INFP 插画（明确标注"不是测评结果"），不能拿它当十六型口径的证据；
            # 要钉的是"报告预览/结果示例这两块十六型专属内容没有出现"。
            check(page.locator("[data-result-example]").count() == 0,
                  f"{width}/首页大五续答：不展示十六型结果示例")
            check(page.locator("[data-report-preview]").count() == 0,
                  f"{width}/首页大五续答：不展示十六型报告预览")
            check(page.locator("[data-dimension-list] > div").count() == 5,
                  f"{width}/首页大五续答：五个方面")
            check(overflow(page) <= 1, f"{width}/首页（大五）无横向溢出")
            check(len(errors) == 0, f"{width}/首页（大五）无未捕获异常", "; ".join(errors[:2]))
            shoot(page, "home-bigfive", width)
            page.context.close()

            # ── 3. 开始测评页：两份未完成草稿 + 两个量表 ────────────────────
            api.drafts = [JUNG_CLARIFICATION_DRAFT, BIGFIVE_DRAFT]
            page, errors = open_page(browser, width, height, "/assess")
            page.wait_for_selector("[data-assess-drafts]", timeout=8000)
            page.wait_for_selector("[data-instrument='jung48']", timeout=8000)
            drafts_text = page.locator("[data-assess-drafts]").inner_text()
            check("补充答题中" in drafts_text, f"{width}/开始页：补充题进度按状态说明", drafts_text[:200])
            check("主测 48 / 48" in drafts_text, f"{width}/开始页：补充题草稿写「主测 48 / 48」", drafts_text[:200])
            check("48 / 48 题" not in drafts_text, f"{width}/开始页：不把补充题草稿写成整份答完", drafts_text[:200])
            check("BASE_IN_PROGRESS" not in drafts_text and "CLARIFICATION_IN_PROGRESS" not in drafts_text,
                  f"{width}/开始页：不显示内部状态码", drafts_text[:200])
            check(page.locator("[data-start='jung48']").is_enabled(), f"{width}/开始页：十六型可以开始")
            check(page.locator("[data-start='bigfive50']").is_enabled(), f"{width}/开始页：大五可以开始")
            check(overflow(page) <= 1, f"{width}/开始页无横向溢出")
            check(len(errors) == 0, f"{width}/开始页无未捕获异常", "; ".join(errors[:2]))
            shoot(page, "assess-chooser", width)
            page.context.close()

            # ── 4. 我的报告：两份十六型 + 一份大五 ─────────────────────────
            page, errors = open_page(browser, width, height, "/reports")
            page.wait_for_selector("[data-report-rows]", timeout=8000)
            rows = page.locator("[data-report-row]")
            check(rows.count() == 3, f"{width}/报告列表：三行都在")
            list_text = page.locator("[data-report-rows]").inner_text()
            check("几个方向并列" in list_text, f"{width}/报告列表：并列结果按报告页说法", list_text[:200])
            check("并列四个维度" not in list_text, f"{width}/报告列表：不写「并列四个维度」")
            check("五个维度" in list_text, f"{width}/报告列表：大五行写五个维度", list_text[:300])
            links = page.locator("[data-report-row='report-bigfive-1'] [data-report-open]").get_attribute("href")
            check(links is not None and "/reports/big-five/" in links,
                  f"{width}/报告列表：大五行跳到报告页", str(links))
            check(overflow(page) <= 1, f"{width}/报告列表无横向溢出")
            check(len(errors) == 0, f"{width}/报告列表无未捕获异常", "; ".join(errors[:2]))
            shoot(page, "reports-list", width)
            page.context.close()

            # ── 5. 比较页：两边都没有方向的维度 ────────────────────────────
            page, errors = open_page(browser, width, height, "/reports/compare")
            page.wait_for_selector("[data-compare-pickers]", timeout=8000)
            page.locator("[data-compare-select-a]").select_option("report-jung-1")
            page.locator("[data-compare-select-b]").select_option("report-jung-2")
            page.locator("[data-compare-run]").click()
            page.wait_for_selector("[data-compare-result]", timeout=8000)
            result = page.locator("[data-compare-result]").inner_text()
            check("都没有给出方向" in result, f"{width}/比较页：没有方向时不写成「方向一致」", result[:300])
            check("方向一致" not in result, f"{width}/比较页：没有方向时不标记方向一致")
            check(overflow(page) <= 1, f"{width}/比较页无横向溢出")
            check(len(errors) == 0, f"{width}/比较页无未捕获异常", "; ".join(errors[:2]))
            shoot(page, "compare", width)
            page.context.close()

            # ── 6. 十六型答题页：五档与「说不好」是两个状态 ─────────────────
            page, errors = open_page(browser, width, height, "/assess/attempt-jung")
            page.wait_for_selector("[data-question-card]", timeout=8000)
            check(page.locator("[data-rating]").count() == 5, f"{width}/十六型答题：五档都在")
            check(page.locator("[data-unknown]").count() == 1, f"{width}/十六型答题：「说不好」是独立按钮")
            labels = [page.locator("[data-rating]").nth(index).get_attribute("aria-label") for index in range(5)]
            check(all(label and "当前已选" not in label for label in labels),
                  f"{width}/十六型答题：未作答时没有伪选中的档位", str(labels))
            check("两边差不多" in (labels[2] or ""), f"{width}/十六型答题：中间档是「两边差不多」", str(labels[2]))
            check("说不好" in page.locator("[data-question-card]").inner_text(),
                  f"{width}/十六型答题：「说不好」有自己的说法")
            check(overflow(page) <= 1, f"{width}/十六型答题页无横向溢出")
            check(len(errors) == 0, f"{width}/十六型答题页无未捕获异常", "; ".join(errors[:2]))
            shoot(page, "assess-jung", width)
            page.context.close()

            # ── 7. 大五答题页：题干与档位文案是同一套 ──────────────────────
            page, errors = open_page(browser, width, height, "/assess/attempt-bigfive")
            page.wait_for_selector("[data-bigfive-item]", timeout=8000)
            item = page.locator("[data-bigfive-item]").inner_text()
            check("从「非常不符合」到「非常符合」" in item, f"{width}/大五答题：题干用符合程度", item[:300])
            check("贴切" not in item, f"{width}/大五答题：不再用「贴切」问法", item[:300])
            check("说不好" in item and "说不上符合或不符合" in item,
                  f"{width}/大五答题：「说不好」与中间档分开说明", item[:400])
            check(page.locator("[data-bigfive-unknown]").count() == 1, f"{width}/大五答题：「说不好」独立")
            check(overflow(page) <= 1, f"{width}/大五答题页无横向溢出")
            check(len(errors) == 0, f"{width}/大五答题页无未捕获异常", "; ".join(errors[:2]))
            shoot(page, "assess-bigfive", width)
            page.context.close()

        browser.close()

    report = {
        "base": BASE,
        "widths": [width for width, _ in WIDTHS],
        "checks": len(checks),
        "passed": sum(1 for item in checks if item["passed"]),
        "failures": failures,
        "unknown_api": api.unknown[:20],
        "shots": sorted(path.name for path in OUT.glob("*.png")),
    }
    (OUT.parent / "browser-result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
