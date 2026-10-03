package com.typeme.contract;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 机械守卫：AI 失败时**后端能落库的 errorCode**，前端必须有专门说法。
 *
 * <p>## 为什么需要这条测试
 *
 * <p>这类漂移天生不会被任何单边测试发现：后端新增一个错误码，后端的用例只断言
 * "库里存了这个码"；前端对不认识的码一律走 `default` 分支，也会"成功地"给出一句话。
 * 两边都是绿的，只有用户看到的东西是错的 —— 他会收到一句万能的
 * "这次生成没有成功，可以重试一次"。
 *
 * <p>而"可以重试"对某些码是**有害建议**：`UPSTREAM_401`（密钥失效）和
 * `UPSTREAM_402`（余额不足）重试一万次也不会成功，用户该知道这是服务端配置问题。
 * 这正是本测试要守住的东西。
 *
 * <p>## 为什么用"读源码"而不是共享常量
 *
 * <p>后端是 Java、前端是 TypeScript，没有共享常量的地方。可选方案只有两个：
 * <ol>
 *   <li>在 Java 侧抄一份前端认得的码清单 —— 抄完就没人记得同步，等于把漂移挪了个位置；</li>
 *   <li>直接读前端源码，断言它 <b>case</b> 了每一个码（本测试的做法）。</li>
 * </ol>
 *
 * <p>它依赖 `frontend/src/api/v3Ai.ts` 的路径与 `case 'X':` 的写法。若有人重构前端，
 * 本测试**会因"读不到文件/一个码都没找到"而失败**，而不是静默放行 —— 这是刻意的：
 * 守卫读不懂的时候必须报警，不能当成通过。
 */
class AiErrorCodeContractTest {

    /** 仓库根：surefire 的工作目录是 backend/。 */
    private static final Path REPO_ROOT = Path.of("..").toAbsolutePath().normalize();

    private static final Path FRONTEND_HINT = REPO_ROOT.resolve("frontend/src/api/v3Ai.ts");

    /** 后端会写进 {@code ai_analysis_job.error_code} 的码，来自 DeepSeekException.Codes（契约 02 §5.1）。 */
    private static final List<String> JOB_ERROR_CODES = List.of(
            "UPSTREAM_401",
            "UPSTREAM_402",
            "UPSTREAM_429",
            "UPSTREAM_5XX",
            "UPSTREAM_UNAVAILABLE",
            "UPSTREAM_ERROR",
            "TIMEOUT",
            "EMPTY_CONTENT",
            "INVALID_JSON",
            "TRUNCATED",
            "TYPE_MISMATCH",
            "CONTENT_VIOLATION");

    @Test
    @DisplayName("每个可能落库的 AI 错误码，前端都有专门说法（不许落到万能兜底）")
    void everyJobErrorCodeHasADedicatedFrontendHint() throws IOException {
        Set<String> handled = frontendHandledCodes();

        assertThat(handled)
                .as("没能从前端 %s 解析出任何 case —— 守卫读不懂时必须失败，不能当成通过", FRONTEND_HINT)
                .isNotEmpty();

        Set<String> missing = new LinkedHashSet<>();
        for (String code : JOB_ERROR_CODES) {
            if (!handled.contains(code)) {
                missing.add(code);
            }
        }
        assertThat(missing)
                .as("这些错误码会落到前端的 default 兜底分支，用户只会看到"
                        + "「这次生成没有成功，可以重试一次」。"
                        + "其中 401/402 属于服务端配置问题，重试无效，必须给出不同说法")
                .isEmpty();
    }

    @Test
    @DisplayName("后端 Codes 常量与契约清单一致（新增码时本测试提醒你同步前端）")
    void backendCodesMatchTheList() throws IOException {
        Set<String> declared = backendDeclaredCodes();

        assertThat(declared)
                .as("没能从 DeepSeekException.Codes 解析出常量 —— 守卫失效时必须失败")
                .isNotEmpty();

        // 只比较"任务失败码"这一子集：Codes 里还有 NOT_CONFIGURED / BUDGET_EXCEEDED /
        // RATE_LIMITED，它们走的是创建接口的响应体（AiException），不是任务落库字段。
        Set<String> declaredJobCodes = new LinkedHashSet<>(declared);
        declaredJobCodes.retainAll(JOB_ERROR_CODES);

        assertThat(declaredJobCodes)
                .as("后端声明的任务失败码与本测试的清单不一致：新增码时请把它加进 JOB_ERROR_CODES，"
                        + "并在前端 aiFailureHint 里给出专门说法")
                .containsExactlyInAnyOrderElementsOf(JOB_ERROR_CODES);
    }

    /** 解析 `case 'X':` 形式的前端分支。 */
    private static Set<String> frontendHandledCodes() throws IOException {
        String source = Files.readString(FRONTEND_HINT, StandardCharsets.UTF_8);
        Set<String> codes = new LinkedHashSet<>();
        Matcher matcher = Pattern.compile("case '([A-Z][A-Z0-9_]+)':").matcher(source);
        while (matcher.find()) {
            codes.add(matcher.group(1));
        }
        return codes;
    }

    /** 解析后端 `public static final String X = "Y";` 形式的常量。 */
    private static Set<String> backendDeclaredCodes() throws IOException {
        Path file = REPO_ROOT.resolve("backend/src/main/java/com/typeme/ai/client/DeepSeekException.java");
        String source = Files.readString(file, StandardCharsets.UTF_8);
        Set<String> codes = new LinkedHashSet<>();
        Matcher matcher = Pattern.compile("String [A-Z_0-9]+ = \"([A-Z0-9_]+)\";").matcher(source);
        while (matcher.find()) {
            codes.add(matcher.group(1));
        }
        return codes;
    }

    /** 防呆：确认仓库根找对了（否则上面两个"读不到就为空"的断言会掩盖路径错误）。 */
    @Test
    @DisplayName("仓库根与前端文件路径正确（守卫本身别定位错地方）")
    void fixturePathsExist() {
        assertThat(Files.isRegularFile(FRONTEND_HINT))
                .as("找不到 %s；若前端文件被移动，请同步本测试", FRONTEND_HINT)
                .isTrue();
        try (Stream<Path> ignored = Files.walk(REPO_ROOT, 1)) {
            assertThat(Files.isDirectory(REPO_ROOT.resolve("frontend")))
                    .as("仓库根定位为 %s，但该目录下没有 frontend/", REPO_ROOT)
                    .isTrue();
        } catch (IOException ex) {
            throw new AssertionError("无法遍历 " + REPO_ROOT, ex);
        }
    }
}
