package com.typeme.ai.worker;

import com.typeme.ai.config.AiProperties;
import com.typeme.ai.input.ReadableReportInput;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 提示词版本的**分类守卫**：每个版本要么属于「可读版契约」，要么被明确归为旧版。
 *
 * <p><b>为什么需要。</b>{@code ReportInputBuilder} 判断是否走可读版输入的方式是
 * {@code ReadableReportInput.PROMPT_VERSION.equals(promptVersion)} —— 对任何**未知**版本
 * 都落到旧版分支。这意味着"新增一个提示词文件 v4 并把它配上去"会得到一个**静默降级**：
 * 十六型悄悄回到旧版输入，大五则直接 400 {@code UNSUPPORTED_INSTRUMENT}，
 * 而现有测试全绿（{@link PromptFileContractTest} 只检查命名、首行与默认版本可加载）。
 *
 * <p>所以这里把"哪些版本算可读"变成一张必须**手工维护**的表：{@code ai/prompts/} 下
 * 出现未登记的版本时本类直接红，逼一次明确的表态，而不是让版本升级悄悄改变行为。
 *
 * <p><b>刻意保留"等于"语义</b>：新版本的输出结构是否仍满足可读版契约需要人确认，
 * 不能用"v3 及以上"这种猜测。前端同一份判断在
 * {@code frontend/src/api/v3Ai.ts} 的 {@code READABLE_PROMPT_VERSION}。
 *
 * <p><b>本类通过不等于真实模型输出合格</b>：它只保证"版本→契约"的分类没有漏项。
 */
class PromptVersionClassificationTest {

    /** 测试工作目录是 backend/，prompts 在 src/main/resources 下（与 PromptFileContractTest 一致）。 */
    private static final Path PROMPTS = Path.of("src", "main", "resources", "ai", "prompts");

    /**
     * 已知提示词版本 → 是否属于可读版契约。
     *
     * <p>新增/删除提示词文件时必须同步这张表：漏登记会让本类失败，
     * 这正是它的目的（而不是"忘了就默认新版"）。
     */
    private static final Map<String, Boolean> CLASSIFICATION = Map.of(
            "typeme-ai-prompt-v1", false,
            "typeme-ai-prompt-v2", false,
            "typeme-ai-prompt-v3", true);

    @Test
    @DisplayName("ai/prompts 下的每个版本都必须在分类表里表态（新增 v4 会在这里红）")
    void everyPromptFileIsClassified() throws IOException {
        Set<String> onDisk = promptVersions();
        assertFalse(onDisk.isEmpty(), "一个提示词文件都没找到，路径可能变了：" + PROMPTS.toAbsolutePath());

        List<String> unclassified = onDisk.stream()
                .filter(version -> !CLASSIFICATION.containsKey(version))
                .sorted()
                .toList();
        assertTrue(unclassified.isEmpty(),
                "这些提示词版本没有表态属于「可读版契约」还是旧版：" + unclassified
                        + "。请同步 ReadableReportInput.PROMPT_VERSION、v3Ai.ts 与前端的提示文案后再登记。");

        List<String> missingFiles = CLASSIFICATION.keySet().stream()
                .filter(version -> !onDisk.contains(version))
                .sorted()
                .toList();
        assertTrue(missingFiles.isEmpty(),
                "分类表里有版本在 ai/prompts 下找不到对应文件：" + missingFiles
                        + "。删文件时也要删登记，否则表会慢慢变成假信息。");
    }

    @Test
    @DisplayName("被判为「可读版契约」的版本恰好一个，且就是 ReadableReportInput.PROMPT_VERSION")
    void readableClassificationMatchesTheCodeConstant() {
        List<String> readable = CLASSIFICATION.entrySet().stream()
                .filter(Map.Entry::getValue)
                .map(Map.Entry::getKey)
                .sorted()
                .toList();
        assertEquals(List.of(ReadableReportInput.PROMPT_VERSION), readable,
                "可读版契约只允许有一个版本，且必须与后端常量一致");
    }

    @Test
    @DisplayName("配置默认值必须是一个已分类、且确实能加载的版本")
    void defaultVersionIsClassifiedAndLoadable() {
        String defaultVersion = new AiProperties().getPromptVersion();
        assertTrue(CLASSIFICATION.containsKey(defaultVersion),
                "AiProperties 默认提示词版本 " + defaultVersion + " 没有在分类表里表态");
        assertTrue(CLASSIFICATION.get(defaultVersion),
                "默认版本应是可读版契约那一版，否则新装环境的大五 AI 会直接 400");

        // 用产品自己的读取路径确认文件真的能读出来（不是只看目录清单）。
        assertFalse(AnalysisWorker.SystemPrompt.of(defaultVersion).isBlank());
    }

    @Test
    @DisplayName("每个已登记版本都能被产品自己的加载器读出内容（旧版也要留着，历史任务按自己的版本解析）")
    void everyClassifiedVersionLoads() {
        List<String> broken = new ArrayList<>();
        for (String version : new TreeSet<>(CLASSIFICATION.keySet())) {
            try {
                if (AnalysisWorker.SystemPrompt.of(version).isBlank()) {
                    broken.add(version + "（内容为空）");
                }
            } catch (RuntimeException ex) {
                broken.add(version + "（" + ex.getMessage() + "）");
            }
        }
        assertTrue(broken.isEmpty(),
                "已登记的提示词版本必须都能被 SystemPrompt 加载（旧版本要给历史任务用）：" + broken);
    }

    @Test
    @DisplayName("分类表本身无重复、无空键（Map.of 已保证唯一性，这里守住后续改动的形状）")
    void classificationShapeIsSane() {
        Map<String, Boolean> copy = new LinkedHashMap<>(CLASSIFICATION);
        assertEquals(CLASSIFICATION.size(), copy.size());
        copy.forEach((version, readable) -> {
            assertFalse(version.isBlank());
            assertTrue(version.matches("typeme-ai-prompt-v\\d+"),
                    "版本命名必须符合 typeme-ai-prompt-vN，实际：" + version);
            assertEquals(CLASSIFICATION.get(version), readable);
        });
    }

    private static Set<String> promptVersions() throws IOException {
        try (Stream<Path> files = Files.list(PROMPTS)) {
            Set<String> versions = new TreeSet<>();
            files.map(path -> path.getFileName().toString())
                    .filter(name -> name.endsWith(".txt"))
                    .forEach(name -> versions.add(name.substring(0, name.length() - ".txt".length())));
            return versions;
        }
    }
}
