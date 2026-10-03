package com.typeme.platform.catalog;

import com.typeme.ipip.content.BigFivePackage;
import com.typeme.ipip.content.BigFivePackageLoader;
import com.typeme.jung.content.JungPackage;
import com.typeme.jung.content.JungPackageLoader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 量表目录：把每个模块里加载出来的内容包登记成"用户能选的测评"。
 *
 * <p><b>这是多测评改造的关键一层。</b>改造前的 {@code JungController} 只有
 * {@code /catalog/current} 一个接口，读的是 {@code loader.current()} ——
 * 也就是说"站点上有哪些测评、每个测评是什么"这件事在代码里根本不存在，
 * 全站隐含地假设"只有一套题"。于是：
 * <ul>
 *   <li>首页只能写死一份测评的文案；</li>
 *   <li>新建草稿必然绑定"当前包"，历史草稿一旦遇到发布新版本就变成不可继续；</li>
 *   <li>接入第二种量表必须在每个页面里加分支。</li>
 * </ul>
 * 目录把这三件事变成数据。
 *
 * <p>目录本身**不做校验**：每个模块的加载器已经在校验自己的内容包（结构、指纹、
 * 逐题键值），目录只负责"把已加载的包挂到一项测评下面"。
 */
@Service
public class AssessmentCatalog {

    private static final Logger log = LoggerFactory.getLogger(AssessmentCatalog.class);

    /*
     * 站点对外可见的测评清单与文案。
     *
     * 这份清单是**产品定义**，不随内容版本变化；`defaultPackageId` 才是"当前用哪一版"。
     * 内容还没准备好时不要把它写进来 —— 目录里出现一项"点了会报错"的测评，
     * 比暂时看不到它更糟。
     */
    private static final List<InstrumentDefinition> DEFINITIONS = List.of(
            new InstrumentDefinition(
                    "jung48",
                    InstrumentKind.JUNG,
                    "十六型人格参考测评",
                    "四组偏好，帮你看清自己的常用方式",
                    "了解你在交流、获取信息、做决定和安排事情上的习惯偏好："
                            + "更容易从哪里获得精力、更信哪一类信息、做取舍时先看什么、更习惯哪种推进节奏。",
                    List.of(
                            "你在四个方面更常自然采用的做法，以及每一侧的具体表现",
                            "本次回答里哪些方面比较明显、哪些方面两边差不多",
                            "可以留意的一两个日常场景，用来自己验证这些描述像不像你"),
                    List.of(
                            "它不是官方 MBTI 测验，也不是心理诊断工具",
                            "不能用来判断能力高低、挑选职业，或给人下结论",
                            "结果来自一次作答，会随阶段和情境变化"),
                    // 新建草稿默认绑定的版本。**改这一行是一次发布决定**：
                    // 它决定新用户从哪一版开始答题，不影响已存在的草稿（那些按自己的包加载）。
                    JungPackageLoader.CURRENT_PACKAGE_ID),
            new InstrumentDefinition(
                    "bigfive50",
                    InstrumentKind.BIG_FIVE,
                    "大五人格倾向测评",
                    "从五个方面看你的性格表现，不把你归为一类",
                    "分别描述外向性、宜人性、尽责性、情绪稳定性与开放性五个方面。"
                            + "五个方面各自独立，不拼成类型、不排名次，也不把你放进十六个格子里。",
                    List.of(
                            "五个方面各自的倾向方向，以及每一侧在日常里通常是什么样",
                            "哪些方面比较明显、哪些方面接近中间，因此不必急着给自己贴标签",
                            "每一方面各有一个可以自己观察的场景"),
                    List.of(
                            "它不是诊断工具，不能用来判断心理是否健康或有没有疾病",
                            "没有本地常模，因此不给出百分位、也不与人比较",
                            "IPIP 是公有领域题库，但它不是任何机构的官方大五测评"),
                    BigFivePackageLoader.CURRENT_PACKAGE_ID));

    private final Map<String, InstrumentDefinition> bySlug = new LinkedHashMap<>();
    private final JungPackageLoader jungLoader;
    private final BigFivePackageLoader bigFiveLoader;

    public AssessmentCatalog(JungPackageLoader jungLoader, BigFivePackageLoader bigFiveLoader) {
        this.jungLoader = jungLoader;
        this.bigFiveLoader = bigFiveLoader;
        for (InstrumentDefinition definition : DEFINITIONS) {
            if (bySlug.put(definition.slug(), definition) != null) {
                throw new IllegalStateException("量表 slug 重复：" + definition.slug());
            }
        }
        // 启动期就把"默认版本存在"钉住：否则用户点"开始测评"才会 500。
        for (InstrumentDefinition definition : bySlug.values()) {
            AssessmentRelease release = releaseOf(definition.defaultPackageId());
            if (release == null) {
                throw new IllegalStateException("量表 " + definition.slug()
                        + " 的默认内容版本未加载：" + definition.defaultPackageId());
            }
            log.info("量表目录登记：slug={} 名称={} 默认版本={} 主测题数={} 补充题上限={}",
                    definition.slug(), definition.title(), release.packageId(),
                    release.baseItemCount(), release.maxClarificationItems());
        }
    }

    /** 全部测评定义（顺序即首页展示顺序）。 */
    public List<InstrumentDefinition> definitions() {
        return List.copyOf(bySlug.values());
    }

    public InstrumentDefinition findDefinition(String slug) {
        return slug == null ? null : bySlug.get(slug);
    }

    /**
     * 按 slug 取新建草稿要绑定的发布版本。
     *
     * @throws IllegalArgumentException slug 不存在（上层转成 404）
     */
    public AssessmentRelease defaultRelease(String slug) {
        InstrumentDefinition definition = bySlug.get(slug);
        if (definition == null) {
            throw new IllegalArgumentException("未知量表：" + slug);
        }
        AssessmentRelease release = releaseOf(definition.defaultPackageId());
        if (release == null) {
            // 构造器已经检查过同一个条件；这里再查一次是因为目录是运行期数据，
            // 而"默认包突然不见了"必须给出可定位的错误而不是 NPE。
            throw new IllegalStateException("量表 " + slug + " 的默认内容版本未加载："
                    + definition.defaultPackageId());
        }
        return release;
    }

    /**
     * 按 packageId 取发布版本 —— **任何**需要"这份草稿锁定的题目"的地方都必须走这里，
     * 而不是退回某一项测评的默认版本。
     *
     * @return 找不到时为 {@code null}（上层转成 409 PACKAGE_UNAVAILABLE）
     */
    public AssessmentRelease releaseOf(String packageId) {
        if (packageId == null || packageId.isBlank()) {
            return null;
        }
        JungPackage jung = jungLoader.find(packageId);
        if (jung != null) {
            return AssessmentRelease.ofJung(jung);
        }
        BigFivePackage bigFive = bigFiveLoader.find(packageId);
        if (bigFive != null) {
            return AssessmentRelease.ofBigFive(bigFive);
        }
        return null;
    }

    /** 按"草稿锁定的包"反查它属于哪一项测评（用于历史列表上显示量表名）。 */
    public InstrumentDefinition definitionOfPackage(String packageId) {
        AssessmentRelease release = releaseOf(packageId);
        if (release == null) {
            return null;
        }
        for (InstrumentDefinition definition : bySlug.values()) {
            if (definition.kind() == release.kind()) {
                return definition;
            }
        }
        return null;
    }

    /** 一项测评当前全部可用版本（新的在前），用于"我的测评"里解释历史版本。 */
    public List<AssessmentRelease> releasesOf(String slug) {
        InstrumentDefinition definition = bySlug.get(slug);
        if (definition == null) {
            return List.of();
        }
        List<AssessmentRelease> releases = new ArrayList<>();
        if (definition.kind() == InstrumentKind.JUNG) {
            for (JungPackage pkg : jungLoader.packages()) {
                releases.add(AssessmentRelease.ofJung(pkg));
            }
        } else {
            for (BigFivePackage pkg : bigFiveLoader.packages()) {
                releases.add(AssessmentRelease.ofBigFive(pkg));
            }
        }
        // 版本号大的排前面（v2 在 v1 前），同版本按 packageId 稳定排序。
        releases.sort((left, right) -> right.packageId().compareTo(left.packageId()));
        return List.copyOf(releases);
    }
}
