"""2026-10-14 十轮优化的浏览器抽查。

接口全部由 Playwright 拦截，不连接、不写入数据库。
账号资料是合成值。截图里不包含密码、令牌或恢复码。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OUT = Path(__file__).resolve().parent / "shots"
BASE = "http://127.0.0.1:5173"
WIDTHS = (320, 390, 1440)

PROFILE = {
    "userId": "user-browser",
    "username": "browser_owner",
    "nickname": None,
    "createdAt": "2026-10-14T00:00:00Z",
    "passwordChangedAt": None,
}

JUNG_CARD = {
    "slug": "jung48",
    "kind": "jung",
    "title": "十六型人格参考测评",
    "tagline": "四个维度各自比较",
    "summary": "按日常选择看四个维度的倾向。",
    "whatYouLearn": ["四个维度各自更靠哪一侧"],
    "notFor": ["招聘筛选", "诊断"],
    "format": "bipolar",
    "hasTypeCode": True,
    "supportsClarification": True,
    "dimensions": ["EI", "SN", "TF", "JP"],
    "defaultPackageId": "typeme-jung48-zh-v1",
    "baseItemCount": 48,
    "clarificationItemCount": 16,
    "maxClarificationItems": 16,
    "estimatedMinutes": 15,
    "contentStatus": "draft_review_pending",
}

QUESTIONS = [
    {"id": "q1", "stage": "base", "dimension": "EI", "order": 1},
    {"id": "q2", "stage": "base", "dimension": "EI", "order": 2},
    {"id": "q3", "stage": "base", "dimension": "SN", "order": 3},
    {"id": "q4", "stage": "base", "dimension": "TF", "order": 4},
    {"id": "c1", "stage": "clarification", "dimension": "EI", "order": 101},
]

PACKAGE = {
    "schemaVersion": 1,
    "packageId": "typeme-jung48-zh-v1",
    "instrument": {
        "id": "typeme-jung48",
        "revision": "r1",
        "scoringVersion": "typeme-jung48-score-v1",
        "reportContentVersion": "typeme-type-report-zh-v1",
        "format": "bipolar",
        "hasTypeCode": True,
        "baseItemsPerDimension": 1,
        "clarificationItemsPerDimension": 1,
        "maxClarificationItems": 4,
    },
    "title": "十六型倾向自测",
    "contentStatus": "draft_review_pending",
    "scoringPolicy": {
        "version": "typeme-jung48-score-v1",
        "minBaseRatingsPerDimension": 1,
        "boundaryNumerator": 2,
        "boundaryDenominator": 10,
        "ratingMin": 1,
        "ratingMax": 5,
        "ratingNeutral": 3,
    },
    "dimensions": [
        {
            "dimension": code,
            "name": f"维度 {code}",
            "question": "这一维问什么",
            "negativePole": {"pole": "I", "label": "内倾", "description": "独处恢复精力。", "dailySigns": ["话不多"]},
            "positivePole": {"pole": "E", "label": "外倾", "description": "与人来往恢复精力。", "dailySigns": ["话多"]},
            "balanced": {"summary": "两边接近。", "reading": "两边都可以读。"},
            "tiedNotice": "这一维两边接近。",
        }
        for code in ("EI", "SN", "TF", "JP")
    ],
    "questions": [
        {
            "id": question["id"],
            "stage": question["stage"],
            "dimension": question["dimension"],
            "scenario": f"情境 {question['id']}",
            "textLeft": f"左边 {question['id']}",
            "textRight": f"右边 {question['id']}",
            "leftPole": "I",
            "rightPole": "E",
            "help": "这一题的短释义。",
            "facet": "facet",
            "order": question["order"],
            "reviewStatus": "reviewed",
        }
        for question in QUESTIONS
    ],
    "sha256": "c" * 64,
}


def jung_detail(answers: list[dict] | None = None, dimensions: list[str] | None = None) -> dict:
    return {
        "attemptId": "attempt-browser",
        "packageId": PACKAGE["packageId"],
        "status": "BASE_IN_PROGRESS",
        "revision": 7,
        "currentQuestionId": None,
        "clarificationDimensions": dimensions or [],
        "clarificationSkipped": False,
        "startedAt": "2026-10-14T01:00:00Z",
        "updatedAt": "2026-10-14T02:00:00Z",
        "submittedAt": None,
        "reportId": None,
        "baseAttemptId": None,
        "answers": answers or [],
        "coverage": [],
        "packageContent": PACKAGE,
    }


def bigfive_items() -> list[dict]:
    items = []
    for index in range(1, 51):
        dimension = ["E", "A", "C", "ES", "O"][(index - 1) // 10]
        items.append({
            "id": f"Q{index:02d}",
            "kind": "agreement_statement",
            "stage": "base",
            "dimension": dimension,
            "order": index,
            "scenario": None,
            "left": None,
            "right": None,
            "statement": f"陈述句 {index}",
            "leftPole": None,
            "rightPole": None,
            "direction": 1,
            "help": f"第 {index} 题的短释义。",
        })
    return items


BIGFIVE = {
    "attemptId": "attempt-bigfive",
    "instrumentSlug": "bigfive50",
    "instrumentKind": "big_five",
    "instrumentTitle": "大五人格倾向测评",
    "packageId": "typeme-bigfive50-zh-v1",
    "reportKind": "big_five_profile",
    "status": "DRAFT",
    "revision": 3,
    "currentQuestionId": None,
    "clarificationDimensions": [],
    "clarificationSkipped": False,
    "startedAt": "2026-10-14T01:00:00Z",
    "updatedAt": "2026-10-14T02:00:00Z",
    "submittedAt": None,
    "baseAttemptId": None,
    "reportId": None,
    "answers": [],
    "items": bigfive_items(),
    "answeredCount": 0,
    "requiredCount": 50,
    "answerComplete": False,
}

PLATFORM_DRAFT = {
    "attemptId": "attempt-browser",
    "instrumentSlug": "jung48",
    "instrumentKind": "jung",
    "instrumentTitle": "十六型人格参考测评",
    "packageId": PACKAGE["packageId"],
    "reportContentVersion": None,
    "status": "BASE_IN_PROGRESS",
    "revision": 3,
    "startedAt": "2026-10-14T01:00:00Z",
    "updatedAt": "2026-10-14T02:34:00Z",
    "submittedAt": None,
    "reportId": None,
    "reportStatus": None,
    "computedTypeCode": None,
    "answeredCount": 10,
    "requiredCount": 48,
}


def dimension_copy(code: str) -> dict:
    return {
        "dimension": code,
        "name": f"{code} 维度",
        "question": f"{code} 在比较什么？",
        "lowLabel": f"{code} 的低端",
        "highLabel": f"{code} 的高端",
        "lowDescription": "低端描述",
        "highDescription": "高端描述",
        "lowSigns": ["低端表现"],
        "highSigns": ["高端表现"],
        "balancedSummary": "两边差不多时……",
        "caution": "不要拿它给自己贴标签。",
        "observation": "留意你在不同场合的表现。",
    }


def method_detail() -> dict:
    return {
        "instrument": JUNG_CARD,
        "dimensions": [dimension_copy(code) for code in JUNG_CARD["dimensions"]],
        "versions": [{
            "packageId": "typeme-jung48-zh-v2",
            "revision": "r1",
            "scoringVersion": "jung-score-v2",
            "reportContentVersion": "typeme-type-report-zh-v2",
            "contentStatus": "draft_review_pending",
            "sha256": "b" * 64,
            "isDefault": True,
            "baseItemCount": 48,
            "clarificationItemCount": 16,
        }],
    }


class Api:
    def __init__(self) -> None:
        self.mode = "home"
        self.unknown: list[str] = []
        self.patch_count = 0

    def fulfill(self, route) -> None:
        request = route.request
        url = request.url
        method = request.method.upper()
        path = url.split("?", 1)[0]
        if path.endswith("/auth/csrf"):
            self.json(route, {"token": "csrf", "headerName": "X-XSRF-TOKEN", "parameterName": "_csrf"})
            return
        if path.endswith("/me"):
            self.json(route, PROFILE)
            return
        if path.endswith("/platform/illustrations"):
            self.json(route, {"release": None, "version": "browser-1", "assets": []})
            return
        if path.endswith("/catalog/current"):
            self.json(route, {
                "packageId": PACKAGE["packageId"],
                "title": PACKAGE["title"],
                "questionCount": 4,
                "basePerDimension": 1,
                "dimensions": [
                    {"dimension": code, "name": f"维度 {code}", "negativePole": "I", "positivePole": "E"}
                    for code in ("EI", "SN", "TF", "JP")
                ],
            })
            return
        if path.endswith("/platform/instruments"):
            self.json(route, {"items": [JUNG_CARD]})
            return
        if path.endswith("/platform/instruments/jung48"):
            self.json(route, method_detail())
            return
        if "/platform/attempts" in path and "scope=open" in url:
            self.json(route, {"items": [PLATFORM_DRAFT], "page": 0, "size": 1, "total": 1})
            return
        if path.endswith("/attempts") and "status=draft" in url:
            self.json(route, {"items": [], "page": 0, "size": 20, "total": 0})
            return
        if path.endswith("/platform/attempts/attempt-browser/metadata"):
            self.json(route, {"attemptId": "attempt-browser", "instrumentKind": "jung", "status": "BASE_IN_PROGRESS"})
            return
        if path.endswith("/platform/attempts/attempt-bigfive/metadata"):
            self.json(route, {"attemptId": "attempt-bigfive", "instrumentKind": "big_five", "status": "DRAFT"})
            return
        if path.endswith("/platform/attempts/attempt-bigfive") and method == "GET":
            self.json(route, BIGFIVE)
            return
        if path.endswith("/platform/attempts/attempt-bigfive/answers") and method == "PATCH":
            self.json(route, {
                "code": "CONFLICT_REVISION",
                "message": "另一台设备改过这份草稿。",
                "requestId": "req-bf",
                "details": {"currentRevision": 9},
            }, 409)
            return
        if path.endswith("/attempts/attempt-browser") and method == "GET":
            self.json(route, jung_detail())
            return
        if path.endswith("/attempts/attempt-browser/answers") and method == "PATCH":
            self.patch_count += 1
            if self.mode == "conflict":
                self.json(route, {
                    "code": "CONFLICT_REVISION",
                    "message": "另一台设备已经更新了这份草稿。",
                    "requestId": "req-c",
                    "details": {"currentRevision": 9},
                }, 409)
                return
            self.json(route, {
                "revision": 7 + self.patch_count,
                "status": "CLARIFICATION_IN_PROGRESS" if self.mode == "skip" else "BASE_IN_PROGRESS",
                "clarificationDimensions": ["EI"] if self.mode == "skip" else [],
            })
            return
        if path.endswith("/attempts/attempt-browser/review") and method == "POST":
            self.json(route, {
                "status": "CLARIFICATION_IN_PROGRESS",
                "needsReview": False,
                "clarificationDimensions": ["EI"],
                "coverage": [],
                "insufficientDimensions": [],
            })
            return
        if path.endswith("/admin/ai-settings"):
            self.json(route, {"code": "FORBIDDEN", "message": "没有权限。", "requestId": "req-a", "details": {}}, 403)
            return
        self.unknown.append(f"{method} {url}")
        self.json(route, {"code": "NOT_FOUND", "message": "browser stub", "requestId": None, "details": {}}, 404)

    @staticmethod
    def json(route, body: dict, status: int = 200) -> None:
        route.fulfill(
            status=status,
            content_type="application/json",
            body=json.dumps(body),
        )


def overflow(page: Page) -> int:
    return page.evaluate(
        """() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)"""
    )


def shot(page: Page, name: str, failures: list[str]) -> None:
    for width in WIDTHS:
        page.set_viewport_size({"width": width, "height": 900})
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(150)
        extra = overflow(page)
        if extra > 1:
            failures.append(f"{name}@{width} 横向溢出 {extra}px")
        page.screenshot(path=str(OUT / f"{name}-{width}.png"), full_page=False)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []
    api = Api()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.route("**/api/v3/**", api.fulfill)

        page.goto(f"{BASE}/#/", wait_until="networkidle")
        page.wait_for_selector("[data-resume-entry]", timeout=8000)
        note = page.locator("[data-resume-note]").inner_text()
        if "已答 10/48 题" not in note:
            failures.append(f"首页续答说明不是平台进度：{note}")
        shot(page, "home-resume", failures)

        api.mode = "conflict"
        page.goto(f"{BASE}/#/assess/attempt-browser", wait_until="networkidle")
        page.wait_for_selector("[data-question-card]", timeout=8000)
        page.locator("[data-rating='3']").click()
        page.wait_for_selector("[data-conflict-banner]", timeout=8000)
        banner = page.locator("[data-conflict-banner]").inner_text()
        if "载入最新进度" not in banner:
            failures.append("冲突横幅没有载入最新进度")
        if page.locator("[data-next]").is_enabled():
            failures.append("冲突后下一题仍然可以点")
        after = page.locator("[data-question-card]").inner_text()
        if "情境 q1" not in after or "情境 q2" in after:
            failures.append(f"冲突后翻题了：{after[:80]}")
        shot(page, "jung-conflict", failures)

        api.mode = "skip"
        api.patch_count = 0
        page.goto(f"{BASE}/#/assess/attempt-browser", wait_until="networkidle")
        page.reload(wait_until="networkidle")
        page.wait_for_selector("[data-question-card]", timeout=8000)
        for _ in range(4):
            page.locator("[data-rating='4']").click()
            page.wait_for_timeout(200)
            page.locator("[data-next]").click()
            page.wait_for_timeout(250)
        page.wait_for_selector("[data-start-clarification]", timeout=8000)
        page.locator("[data-start-clarification]").click()
        page.wait_for_selector("text=情境 c1", timeout=8000)
        page.locator("[data-rating='2']").click()
        page.wait_for_timeout(200)
        page.locator("[data-skip-clarification-in-progress]").click()
        page.wait_for_selector("text=跳过已经答过的补充题", timeout=8000)
        shot(page, "skip-confirm", failures)

        page.goto(f"{BASE}/#/instruments/jung48/method", wait_until="networkidle")
        page.wait_for_selector("[data-method-dimensions]", timeout=8000)
        count = page.locator("[data-method-dimensions] [data-dimension]").count()
        if count != 4:
            failures.append(f"方法页维度数是 {count}")
        if "登录状态已改变" in page.inner_text("body"):
            failures.append("方法页停在会话变更失败")
        shot(page, "method", failures)

        page.goto(f"{BASE}/#/assess/attempt-bigfive", wait_until="networkidle")
        page.reload(wait_until="networkidle")
        page.wait_for_selector("text=陈述句 1", timeout=8000)
        page.locator("[role='radio']").nth(2).click()
        page.locator("[data-bigfive-next]").click()
        page.wait_for_selector("[data-bigfive-conflict]", timeout=8000)
        page.wait_for_timeout(200)
        disabled = page.locator("[data-bigfive-next]").is_disabled()
        if not disabled:
            failures.append("大五冲突后下一题仍可点")
        if "陈述句 2" in page.locator("body").inner_text():
            failures.append("大五冲突后已经显示下一题")
        page.locator("[data-bigfive-grid] button").nth(1).click(force=True)
        page.wait_for_timeout(200)
        if "陈述句 2" in page.locator("[data-bigfive-item]").inner_text():
            failures.append("大五冲突后题号把当前题换掉了")
        shot(page, "bigfive-conflict", failures)

        browser.close()

    report = {
        "failures": failures,
        "unknown": api.unknown[:30],
        "shots": sorted(path.name for path in OUT.glob("*.png")),
    }
    (OUT.parent / "browser-result.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
