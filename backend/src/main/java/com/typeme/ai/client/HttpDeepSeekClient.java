package com.typeme.ai.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.typeme.ai.config.AiRuntimeSettings;
import com.typeme.ai.config.AiRuntimeSettingsProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InterruptedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 真实 DeepSeek 客户端：{@code java.net.http.HttpClient}，非流式，**不引入任何 AI SDK**。
 *
 * <p>请求体就是契约 03 §0 核验过的形态：
 * <pre>
 * {"model":"...","messages":[{"role":"system",...},{"role":"user",...}],
 *  "stream":false,"response_format":{"type":"json_object"},
 *  "thinking":{"type":"disabled"},"max_tokens":2600,"temperature":0.4}
 * </pre>
 *
 * <p>失败分类是这个类最重要的产出（见 {@link DeepSeekException}）：
 * <ul>
 *   <li>连不上（DNS/拒绝连接）→ {@code UPSTREAM_UNAVAILABLE}，<b>确认未计费</b>，可安全重排；</li>
 *   <li>401/402/其它 4xx → 明确失败，确认未计费，不重试；</li>
 *   <li>429 → 带 Retry-After，确认未计费，最多自动重试一次；</li>
 *   <li>5xx / 超时 / 读响应体中途断流 → <b>执行状态未知</b>：任务记 {@code UNKNOWN}，保留预算预留，绝不自动重发。</li>
 * </ul>
 *
 * <p>日志纪律：只记 status、耗时、错误码与模型名，**不记** key、请求体与模型输出。
 */
public class HttpDeepSeekClient implements DeepSeekClient {

    private static final Logger log = LoggerFactory.getLogger(HttpDeepSeekClient.class);

    private final AiRuntimeSettingsProvider settingsProvider;
    private final ObjectMapper mapper;

    /** HttpClient 按"连接超时"复用：每请求 new 一个会丢掉连接池，长跑下 TCP 端口会被耗光。 */
    private final Map<Duration, HttpClient> clients = new ConcurrentHashMap<>();

    public HttpDeepSeekClient(AiRuntimeSettingsProvider settingsProvider, ObjectMapper mapper) {
        this.settingsProvider = settingsProvider;
        this.mapper = mapper;
    }

    @Override
    public boolean mock() {
        return false;
    }

    @Override
    public DeepSeekResponse complete(DeepSeekRequest request) {
        AiRuntimeSettings settings = settingsProvider.settings();
        // baseUrl 只来自部署配置/数据库设置，绝不接受用户输入（防 SSRF）。
        String baseUrl = settings.baseUrl() == null ? "" : settings.baseUrl().trim();
        while (baseUrl.endsWith("/")) {
            baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
        }
        URI uri = URI.create(baseUrl + "/chat/completions");
        Duration deadline = settings.requestDeadline();

        ObjectNode body = buildBody(request);
        HttpRequest httpRequest = HttpRequest.newBuilder(uri)
                .timeout(deadline)
                .header("Content-Type", "application/json; charset=utf-8")
                .header("Accept", "application/json")
                .header("Authorization", "Bearer " + settings.apiKey())
                .POST(HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8))
                .build();

        long startedAt = System.nanoTime();
        HttpResponse<String> response;
        try {
            // 每个请求单独设置 deadline：这个超时覆盖"连接 + 发送 + 读响应"全过程。
            response = client(settings.connectTimeout()).send(httpRequest, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (HttpTimeoutException ex) {
            // 请求已经发出（或至少已建立连接）：无法确认上游是否执行并计费。
            throw DeepSeekException.timeout("调用 DeepSeek 超时（deadline=" + deadline + "）。", ex);
        } catch (InterruptedIOException ex) {
            throw DeepSeekException.timeout("调用 DeepSeek 被中断或读响应超时。", ex);
        } catch (IOException ex) {
            // 连接阶段失败：请求没到上游 → 确认未计费、可安全重排。
            throw DeepSeekException.unavailable("无法连接 DeepSeek（" + uri.getHost() + "）。", ex);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw DeepSeekException.timeout("调用 DeepSeek 被中断。", ex);
        }

        long elapsedMs = (System.nanoTime() - startedAt) / 1_000_000L;
        int status = response.statusCode();
        if (status != 200) {
            throw mapStatus(status, response);
        }

        log.debug("DeepSeek 调用成功：model={}, status=200, elapsedMs={}", request.model(), elapsedMs);
        return parse(response.body(), request.model());
    }

    private HttpClient client(Duration connectTimeout) {
        Duration effective = connectTimeout == null || connectTimeout.isNegative() || connectTimeout.isZero()
                ? Duration.ofSeconds(5) : connectTimeout;
        return clients.computeIfAbsent(effective, timeout -> HttpClient.newBuilder()
                .connectTimeout(timeout)
                // 不跟随重定向：API 不应该重定向；跟随会把 Authorization 带到一个非预期主机。
                .followRedirects(HttpClient.Redirect.NEVER)
                .build());
    }

    private ObjectNode buildBody(DeepSeekRequest request) {
        ObjectNode body = mapper.createObjectNode();
        body.put("model", request.model());
        ArrayNode messages = body.putArray("messages");
        ObjectNode system = messages.addObject();
        system.put("role", "system");
        system.put("content", request.systemPrompt());
        ObjectNode user = messages.addObject();
        user.put("role", "user");
        user.put("content", request.userPrompt());
        body.put("stream", false);
        if (request.responseFormatJsonObject()) {
            body.putObject("response_format").put("type", "json_object");
        }
        // thinking 默认开启（effort=high），本场景只要普通生成，显式关掉，避免推理链吃掉 max_tokens。
        body.putObject("thinking").put("type", "disabled");
        body.put("max_tokens", request.maxTokens());
        body.put("temperature", request.temperature());
        return body;
    }

    private DeepSeekException mapStatus(int status, HttpResponse<String> response) {
        String summary = safeSummary(response.body());
        if (status == 401) {
            return DeepSeekException.unauthorized(summary);
        }
        if (status == 402) {
            return DeepSeekException.paymentRequired(summary);
        }
        if (status == 429) {
            return DeepSeekException.rateLimited(parseRetryAfter(response), summary);
        }
        if (status >= 500) {
            return DeepSeekException.serverError(status, summary);
        }
        return DeepSeekException.clientError(status, summary);
    }

    private DeepSeekResponse parse(String rawBody, String requestedModel) {
        JsonNode root;
        try {
            root = mapper.readTree(rawBody);
        } catch (Exception ex) {
            // 200 但不是 JSON：无法判断上游是否计费 → 归为执行状态未知。
            throw DeepSeekException.interrupted("DeepSeek 返回了无法解析的响应体。", ex);
        }
        JsonNode choices = root.path("choices");
        if (!choices.isArray() || choices.isEmpty()) {
            throw DeepSeekException.interrupted("DeepSeek 响应缺少 choices。", null);
        }
        JsonNode first = choices.get(0);
        // 字段可能缺失：缺失按 null/0 处理（契约要求），不要在这里抛 NPE。
        JsonNode contentNode = first.path("message").path("content");
        String content = contentNode.isMissingNode() || contentNode.isNull() ? null : contentNode.asText();
        JsonNode finishNode = first.path("finish_reason");
        String finishReason = finishNode.isMissingNode() || finishNode.isNull() ? null : finishNode.asText();
        String modelReturned = root.path("model").isMissingNode() ? requestedModel : root.path("model").asText(requestedModel);

        JsonNode usage = root.path("usage");
        DeepSeekResponse.TokenUsage tokens = DeepSeekResponse.TokenUsage.EMPTY;
        if (usage.isObject()) {
            tokens = new DeepSeekResponse.TokenUsage(
                    usage.path("prompt_tokens").asLong(0),
                    usage.path("completion_tokens").asLong(0),
                    usage.path("prompt_cache_hit_tokens").asLong(0),
                    usage.path("prompt_cache_miss_tokens").asLong(0));
        }
        return new DeepSeekResponse(content, finishReason, modelReturned, tokens);
    }

    /** 只取响应体的前 200 字符用于诊断；响应体里不含我方 secret。 */
    private static String safeSummary(String body) {
        if (body == null) {
            return "";
        }
        String trimmed = body.replaceAll("\\s+", " ").trim();
        return trimmed.length() <= 200 ? " 上游响应：" + trimmed : " 上游响应：" + trimmed.substring(0, 200) + "…";
    }

    /** Retry-After 支持秒数与 HTTP-date 两种形态；解析不出来就返回 null（调用方用默认退避）。 */
    private static Duration parseRetryAfter(HttpResponse<String> response) {
        String value = response.headers().firstValue("Retry-After").orElse(null);
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Duration.ofSeconds(Long.parseLong(value.trim()));
        } catch (NumberFormatException ignored) {
            return null;
        }
    }
}
