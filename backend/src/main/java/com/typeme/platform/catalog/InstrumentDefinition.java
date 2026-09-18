package com.typeme.platform.catalog;

/**
 * 一份量表的**产品定义**（不是内容、也不是结果）：它是什么、能了解什么、要答多少题、
 * 以及当前默认绑定哪一版内容。
 *
 * <p>分成定义与发布两件事是有意的：
 * <ul>
 *   <li>{@code InstrumentDefinition} 是"这项测评讲什么"，版本变化时它通常不动；</li>
 *   <li>{@code AssessmentRelease} 是"这一版具体长什么样"，每次改题库就多一条。</li>
 * </ul>
 * 首页卡片上的文案、题数、预计时长都来自这里，而不是任何一个页面里的硬编码 ——
 * 否则"大五卡片写着 48 题"这类错误只能靠人肉发现。
 *
 * @param slug            对外稳定标识（出现在 URL 与 API 里，例如 {@code jung48}）
 * @param kind            量表族
 * @param title           对外名称
 * @param tagline         一句话标题（首页卡片）
 * @param summary         能了解什么（首页卡片正文，一段话）
 * @param whatYouLearn    3–5 条"你能了解到什么"（详情页）
 * @param notFor          明确说明这项测评**不适合**用来做什么
 * @param defaultPackageId 新建草稿默认绑定的内容版本；必须是已加载的包
 */
public record InstrumentDefinition(
        String slug,
        InstrumentKind kind,
        String title,
        String tagline,
        String summary,
        java.util.List<String> whatYouLearn,
        java.util.List<String> notFor,
        String defaultPackageId) {

    public InstrumentDefinition {
        whatYouLearn = java.util.List.copyOf(whatYouLearn);
        notFor = java.util.List.copyOf(notFor);
    }
}
