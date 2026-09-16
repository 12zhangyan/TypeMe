package com.typeme.jung.content;

import com.typeme.jung.domain.JungContentStatus;
import com.typeme.jung.domain.JungDimension;
import com.typeme.jung.domain.JungProcess;
import com.typeme.jung.domain.JungPole;

import java.util.Map;

/**
 * 过程层文案内容（由 {@code docs/2026-09-16/implementation/content/process-copy-zh-v1.yml}
 * 经 {@code scripts/convert-jung-content.mjs} 单向生成）。
 *
 * <p>它与内容包、16 型报告**各自独立**：有自己的版本号与指纹。这样"改了几句建议文案"
 * 不会让内容包指纹变化 —— 否则内容指纹会被解读成"题库被改过"，
 * 而真正改题库时反而没人看得出来。
 *
 * <p>内容来源见 YAML 头部注释：按《天资差异》第 2、8、9、10、15–19 章所述方法重写的中文说明，
 * **不是原书摘录**。本版刻意不引入任何人群比例/统计表数据。
 *
 * @param version         过程层内容版本（与文件名、报告里的 methodology 对应）
 * @param status          审校状态，与题目同为 {@code draft_review_pending}
 * @param processes       八个过程，键是过程代号（{@code Si}…{@code Fe}）
 * @param decisionSteps   四步决策法，键是功能族字母（{@code S}/{@code N}/{@code T}/{@code F}）
 * @param decisionIntro   四步决策法的导语
 * @param decisionNote    四步决策法的补充说明
 * @param complementOffers 某一极"能提供给对面那一侧的东西"，键是极点（S/N/T/F）
 * @param communicationRules 沟通规则，键是维度（EI/SN/TF/JP）
 * @param notes           报告里必须与过程层一起出现的三段说明
 */
public record JungProcessCopy(
        String version,
        JungContentStatus status,
        Map<JungProcess, ProcessEntry> processes,
        Map<Character, DecisionStep> decisionSteps,
        String decisionIntro,
        String decisionNote,
        Map<JungPole, String> complementOffers,
        Map<JungDimension, CommunicationRule> communicationRules,
        Notes notes) {

    /**
     * 单个过程的三段说明。
     *
     * @param what            这个过程负责什么
     * @param asDominant      它作为主导过程时的样子
     * @param whenUnpreferred 它属于"尚未偏好的过程"时的样子（不写成缺点）
     */
    public record ProcessEntry(String what, String asDominant, String whenUnpreferred) {
    }

    /**
     * 四步决策法的一步。
     *
     * @param function        功能族字母
     * @param title           步骤标题
     * @param prompt          可以直接照着问自己的一句话
     * @param whenUnpreferred 当这一步不属于你偏好的过程时该怎么做
     */
    public record DecisionStep(char function, String title, String prompt, String whenUnpreferred) {
    }

    /**
     * 一条沟通规则的两侧说法。取哪一侧由用户在该维的字母决定：
     * {@code negative} 对应负极（I/S/T/J），{@code positive} 对应正极（E/N/F/P）。
     */
    public record CommunicationRule(String negative, String positive) {

        public String forPole(JungPole pole) {
            return pole.isPositive() ? positive : negative;
        }
    }

    /**
     * 三段必须同现的说明。缺任何一段，这一层就会从"理解自己的工具"变成"贴标签"。
     *
     * @param frameworkCaveat 说明这是推导而非测量，且框架本身有争议
     * @param developmentNote 说明四个过程没有高下、均衡不等于相等
     * @param greyAreaNote    说明尚未发展的过程在压力下的表现（书中的"灰色区域"）
     */
    public record Notes(String frameworkCaveat, String developmentNote, String greyAreaNote) {
    }

    public ProcessEntry process(JungProcess process) {
        ProcessEntry entry = processes.get(process);
        if (entry == null) {
            throw new JungContentException("过程层内容缺少过程：" + process);
        }
        return entry;
    }

    public DecisionStep decisionStep(char function) {
        DecisionStep step = decisionSteps.get(Character.toUpperCase(function));
        if (step == null) {
            throw new JungContentException("过程层内容缺少决策步：" + function);
        }
        return step;
    }

    public String complementOfferOf(JungPole pole) {
        String offer = complementOffers.get(pole);
        if (offer == null) {
            throw new JungContentException("过程层内容缺少互补说明：" + pole);
        }
        return offer;
    }

    public CommunicationRule communicationRule(JungDimension dimension) {
        CommunicationRule rule = communicationRules.get(dimension);
        if (rule == null) {
            throw new JungContentException("过程层内容缺少沟通规则：" + dimension);
        }
        return rule;
    }
}
