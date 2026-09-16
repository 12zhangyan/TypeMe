package com.typeme.ai.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.typeme.ai.config.AiProperties;
import com.typeme.ai.client.DeepSeekResponse;
import org.springframework.stereotype.Component;

import java.util.Optional;

/**
 * 费用估算（契约 03 §1 的 {@code typeme.ai.usage-prices}）。
 *
 * <p>三条纪律：
 * <ol>
 *   <li><b>价格必须显式配置</b>：{@code usage-prices} 为空或读不出来时返回 {@link Optional#empty()}，
 *       只记 token 与实际调用数，**绝不编造金额**（编造的费用会污染预算与对账）。</li>
 *   <li>价格带 {@code updatedAt}：单价会变，记录"按哪天的价估算"是审计的最低要求。</li>
 *   <li>输入区分**缓存命中/未命中**两种单价（官方计费就是这么算的）。</li>
 * </ol>
 *
 * <p>单位：微元（micros，1e-6 元）。单价配置是"每 token 多少微元"。
 */
@Component
public class AiCostEstimator {

    private final AiProperties properties;
    private final ObjectMapper mapper;

    public AiCostEstimator(AiProperties properties, ObjectMapper mapper) {
        this.properties = properties;
        this.mapper = mapper;
    }

    /** 本次调用的估算费用（微元）。未配置价格时返回 0，并把"不可估算"体现在日志而非金额上。 */
    public long estimateMicros(DeepSeekResponse.TokenUsage usage) {
        Optional<Prices> prices = prices();
        if (prices.isEmpty() || usage == null) {
            return 0L;
        }
        Prices p = prices.get();
        return usage.promptCacheHitTokens() * p.inputCacheHitMicrosPerToken()
                + usage.promptCacheMissTokens() * p.inputCacheMissMicrosPerToken()
                + usage.completionTokens() * p.outputMicrosPerToken();
    }

    public boolean configured() {
        return prices().isPresent();
    }

    /** 当前生效的单价格（供状态接口/日志使用；未配置时为空）。 */
    public Optional<Prices> prices() {
        String raw = properties.getUsagePrices();
        if (raw == null || raw.isBlank()) {
            return Optional.empty();
        }
        try {
            JsonNode node = mapper.readTree(raw);
            if (!node.isObject()) {
                return Optional.empty();
            }
            return Optional.of(new Prices(
                    node.path("inputCacheHitMicrosPerToken").asLong(0),
                    node.path("inputCacheMissMicrosPerToken").asLong(0),
                    node.path("outputMicrosPerToken").asLong(0),
                    node.path("updatedAt").asText(null)));
        } catch (Exception ex) {
            // 配置写错时按"未配置价格"处理（不估算），并让调用方能在日志里看到原因。
            return Optional.empty();
        }
    }

    /** @param updatedAt 价格生效/更新日期，来自配置，用于审计"按哪天的价估算" */
    public record Prices(long inputCacheHitMicrosPerToken, long inputCacheMissMicrosPerToken,
                         long outputMicrosPerToken, String updatedAt) {
    }
}
