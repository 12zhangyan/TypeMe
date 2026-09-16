# TypeMe 大五（IPIP-50）默认入口验收记录

- 被测地址：`http://127.0.0.1:5173`
- 内容路径：api（api = 走服务端内容包；fallback = 服务端不可用时的同 ID 内置副本）
- 说明：脚本自动生成
- 结果：**1139 条通过，0 条失败**

## 验收项

1. 首页：大五 50 题 / 五维说明 / 无四字母示例卡 / IPIP 公有领域署名 / 版本名干净（手机、PC、平板、320 窄屏）
2. 题目版本偏好：首页切到 OEJTS 旧版本后刷新仍是旧版本，可再切回默认
3. 答题页：单句贴切度五档、帮助展开不产生答案、暂时无法判断不是 3 分、刷新恢复、答题卡 50 题
4. 报告：五维结果驱动（全中立 / 全部无法判断 / 部分不足 / 五维都有方向 / 正负相抵 / 一维待观察）
   每个报告都断言：两端记号是「低/高」、标题写「五个维度上的结果」、页面不出现字面量 undefined
5. 导出：clear / partial / undetermined 三类真实图片，文件名与展示模型一致
6. 关于页：只留用户需要的事实，维护细节（包 ID / 键名 / draft / 服务端 / 内置副本）一律不出现

## 产出图片

- `10-landing-mobile.png`（165 KiB）
- `10-landing-narrow320.png`（36 KiB）
- `10-landing-pc.png`（109 KiB）
- `10-landing-tablet.png`（85 KiB）
- `15-version-preference-oejts.png`（108 KiB）
- `20-quiz-mobile-q1.png`（169 KiB）
- `21-quiz-mobile-help-open.png`（205 KiB）
- `22-quiz-mobile-answered.png`（207 KiB）
- `23-quiz-mobile-unknown.png`（170 KiB）
- `24-quiz-mobile-cards.png`（98 KiB）
- `31-share-preview-clear.png`（169 KiB）
- `31-share-preview-partial.png`（169 KiB）
- `31-share-preview-undetermined.png`（167 KiB）
- `40-report-neutral-mobile.png`（182 KiB）
- `41-report-unknown-mobile.png`（177 KiB）
- `42-report-partial-mobile.png`（177 KiB）
- `43-report-clear-mobile.png`（214 KiB）
- `50-report-clear-pc.png`（88 KiB）
- `51-report-partial-pc.png`（88 KiB）
- `52-report-neutral-pc.png`（91 KiB）
- `60-about-mobile.png`（1063 KiB）
- `60-packaged-landing-8080-pc.png`（248 KiB）
- `export-clear.png`（285 KiB）
- `export-partial.png`（292 KiB）
- `export-undetermined.png`（281 KiB）

## 导出

- clear：导出 export-clear.png（292727 bytes，建议文件名 typeme-profile-clear.png）
- partial：导出 export-partial.png（299379 bytes，建议文件名 typeme-profile-partial.png）
- undetermined：导出 export-undetermined.png（287863 bytes，建议文件名 typeme-profile-undetermined.png）

## 失败项

- 无
