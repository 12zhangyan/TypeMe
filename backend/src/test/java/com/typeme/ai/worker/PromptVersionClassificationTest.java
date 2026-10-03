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

/** 显式登记提示词版本到输出契约的映射；旧任务继续使用其绑定版本，不按版本大小猜兼容。 */
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
            "typeme-ai-prompt-v3", true,
            "typeme-ai-prompt-v4", true,
            "typeme-ai-prompt-v5", true);

    @Test
    @DisplayName("ai/prompts 下的每个版本都必须在分类表里表态（未登记版本会在这里红）")
    void everyPromptFileIsClassified() throws IOException {
        Set<String> onDisk = promptVersions();
        assertFalse(onDisk.isEmpty(), "一个提示词文件都没找到，路径可能变了：" + PROMPTS.toAbsolutePath());

        List<String> unclassified = onDisk.stream()
                .filter(version -> !CLASSIFICATION.containsKey(version))
                .sorted()
                .toList();
        assertTrue(unclassified.isEmpty(),
                "这些提示词版本没有表态属于「可读版契约」还是旧版：" + unclassified
                        + "。请同步 ReadableReportInput.PROMPT_VERSIONS、v3Ai.ts 与前端的提示文案后再登记。");

        List<String> missingFiles = CLASSIFICATION.keySet().stream()
                .filter(version -> !onDisk.contains(version))
                .sorted()
                .toList();
        assertTrue(missingFiles.isEmpty(),
                "分类表里有版本在 ai/prompts 下找不到对应文件：" + missingFiles
                        + "。删文件时也要删登记，否则表会慢慢变成假信息。");
    }

    @Test
    @DisplayName("可读版本集合与产品判断一致，默认版本属于该集合")
    void readableClassificationMatchesTheCodeConstant() {
        List<String> readable = CLASSIFICATION.entrySet().stream()
                .filter(Map.Entry::getValue)
                .map(Map.Entry::getKey)
                .sorted()
                .toList();
        assertEquals(new TreeSet<>(ReadableReportInput.PROMPT_VERSIONS), new TreeSet<>(readable));
        CLASSIFICATION.forEach((version, expected) -> assertEquals(expected, ReadableReportInput.supports(version)));
        assertTrue(ReadableReportInput.supports(ReadableReportInput.PROMPT_VERSION));
        assertFalse(ReadableReportInput.supports(null));
        assertFalse(ReadableReportInput.supports("typeme-ai-prompt-v999"));
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
