package com.typeme.ai.worker;

import com.typeme.ai.config.AiProperties;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 提示词文件与 {@code prompt-version} 的一致性守卫。
 *
 * <p>为什么需要：{@link AnalysisWorker.SystemPrompt#load(String)} 按
 * {@code ai/prompts/<version>.txt} 找文件，缺失时抛异常；文件**第一行**写着版本名，
 * 原注释的用法是"便于人工核对文件与 promptVersion 一致"。也就是说这条约定此前
 * **只靠人眼**：改文件名、改第一行、或把配置里的默认版本写成不存在的版本，
 * 都要等到真正发起 AI 分析（用户在页面上等结果）时才会暴露。
 *
 * <p>这里把三件事变成机械断言：
 * <ol>
 *   <li>每个提示词文件的第一行等于自己的文件名（人眼核对的那件事）；</li>
 *   <li>文件命名符合 {@code typeme-ai-prompt-vN}，避免出现风格外的名字；</li>
 *   <li>{@code AiProperties} 的默认版本**真的能加载**，且加载结果不含那行标记
 *       （第一行是给运维核对的，不该发给模型）。</li>
 * </ol>
 *
 * <p>注意第 3 条走的是产品自己的 {@link AnalysisWorker.SystemPrompt#of(String)}，
 * 不是测试里另写一份读取逻辑 —— 否则就成了"测试自己测自己"。
 */
class PromptFileContractTest {

    /** 测试工作目录是 backend/，prompts 在 src/main/resources 下。 */
    private static final Path PROMPTS = Path.of("src", "main", "resources", "ai", "prompts");

    @Test
    @DisplayName("每个提示词文件的第一行等于自己的文件名（把人工核对变成断言）")
    void firstLineMatchesFileName() throws IOException {
        List<String> names = promptFileNames();
        assertFalse(names.isEmpty(), "一个提示词文件都没找到，路径可能变了：" + PROMPTS.toAbsolutePath());

        List<String> mismatched = new ArrayList<>();
        for (String name : names) {
            String version = name.substring(0, name.length() - ".txt".length());
            String firstLine = Files.readAllLines(PROMPTS.resolve(name), StandardCharsets.UTF_8).get(0).trim();
            if (!version.equals(firstLine)) {
                mismatched.add(name + " 第一行是「" + firstLine + "」");
            }
        }
        assertTrue(mismatched.isEmpty(),
                "提示词文件第一行必须等于文件名（人工核对用的标记），不一致：" + mismatched);
    }

    @Test
    @DisplayName("提示词文件名符合 typeme-ai-prompt-vN 约定")
    void namesFollowConvention() throws IOException {
        List<String> unexpected = promptFileNames().stream()
                .filter(name -> !name.matches("typeme-ai-prompt-v\\d+\\.txt"))
                .toList();
        assertTrue(unexpected.isEmpty(), "非约定命名的提示词文件：" + unexpected);
    }

    @Test
    @DisplayName("配置里的默认提示词版本真的能加载，且发给模型的内容不含版本标记行")
    void defaultPromptVersionLoads() {
        String defaultVersion = new AiProperties().getPromptVersion();
        assertFalse(defaultVersion == null || defaultVersion.isBlank(), "默认版本不能为空");

        // 传 null 走的正是产品内部的兜底分支（与实际配置缺失时的路径一致）。
        String content = AnalysisWorker.SystemPrompt.of(null);
        assertFalse(content.isBlank(), "默认提示词内容不能为空");
        assertFalse(content.startsWith(defaultVersion),
                "第一行的版本标记是给运维核对的，不该原样发给模型：" + content.substring(0, 40));

        // 显式传入配置默认值也必须能加载（这一条才真正覆盖"配置指向的文件存在"）。
        assertEquals(content, AnalysisWorker.SystemPrompt.of(defaultVersion));
    }

    private static List<String> promptFileNames() throws IOException {
        try (Stream<Path> files = Files.list(PROMPTS)) {
            return files.map(path -> path.getFileName().toString())
                    .filter(name -> name.endsWith(".txt"))
                    .sorted()
                    .toList();
        }
    }
}
