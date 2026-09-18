"""临时探针：量顶栏里每个链接的真实命中区（用于修 A54）。

只读页面、不发写请求，不碰数据库。
"""

import json
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:5175"

MEASURE = """
() => {
  const out = [];
  document.querySelectorAll('header a[href], header button').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const style = getComputedStyle(el);
    out.push({
      tag: el.tagName.toLowerCase(),
      text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 26),
      w: Math.round(r.width),
      h: Math.round(r.height),
      minHeight: style.minHeight,
      display: style.display,
      padding: style.padding,
      classes: el.className,
    });
  });
  return out;
}
"""


def measure(page, label):
    entries = page.evaluate(MEASURE)
    header = page.evaluate("() => { const h = document.querySelector('header'); const r = h.getBoundingClientRect(); return { h: Math.round(r.height) }; }")
    print(f"--- {label} --- header={header['h']}px")
    for entry in entries:
        print(json.dumps(entry, ensure_ascii=False))
    # 命中区重叠检查：加高品牌链接后不能去抢导航项的点击
    overlaps = page.evaluate(
        """
        () => {
          const items = [...document.querySelectorAll('header a[href]')].map((el) => ({
            name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20),
            r: el.getBoundingClientRect(),
          }));
          const hits = [];
          for (let i = 0; i < items.length; i += 1) {
            for (let j = i + 1; j < items.length; j += 1) {
              const a = items[i].r, b = items[j].r;
              const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
              if (ox > 0 && oy > 0) hits.push(`${items[i].name} x ${items[j].name} = ${Math.round(ox)}x${Math.round(oy)}`);
            }
          }
          return hits;
        }
        """
    )
    print(f"    overlaps={overlaps if overlaps else 'none'}")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for width, height in ((320, 568), (390, 844), (1440, 900)):
            page = browser.new_page(viewport={"width": width, "height": height})
            page.goto(f"{BASE}/#/", wait_until="networkidle")
            page.wait_for_timeout(400)
            measure(page, f"landing {width}x{height}")
            # A54 的原始记录写的是"翻看历史时顶栏被压缩"的状态。顶栏是 sticky，
            # 代码里没有任何滚动监听，所以这里实测一下**滚动之后**链接尺寸是否变化。
            page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(500)
            measure(page, f"landing {width}x{height} (scrolled)")
            page.close()
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
