package com.typeme.security;

import com.typeme.account.service.TypemeProperties;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.List;

/**
 * 客户端来源 IP 的解析（契约 §5.4）。
 *
 * <p>规则只有一条但很关键：**默认只信 {@code request.getRemoteAddr()}**。
 * 只有当 {@code typeme.security.trusted-proxies} 显式列出代理地址、且直连对端确实在这个
 * 列表里时，才解析 {@code X-Forwarded-For} 的最左侧地址。
 *
 * <p>反例（也是绝大多数限流被绕过的原因）：无条件信 {@code X-Forwarded-For}。
 * 那样攻击者只要每次请求换一个头值，IP 限流就形同虚设。
 */
@Component
public class ClientIpResolver {

    private static final Logger log = LoggerFactory.getLogger(ClientIpResolver.class);

    /** XFF 里超过这个数量的条目直接判定为伪造：真实链路不会有几十跳。 */
    private static final int MAX_FORWARDED_ENTRIES = 16;

    private final List<String> trustedProxies;

    public ClientIpResolver(TypemeProperties properties) {
        this.trustedProxies = properties.security().trustedProxyList();
    }

    public String resolve(HttpServletRequest request) {
        String remoteAddr = request.getRemoteAddr();
        if (trustedProxies.isEmpty()) {
            return remoteAddr == null ? "unknown" : remoteAddr;
        }
        if (!isTrusted(remoteAddr)) {
            // 直连对端不是已知代理：即使带了 XFF 也一律忽略（否则等于把限流交给客户端）。
            return remoteAddr == null ? "unknown" : remoteAddr;
        }
        String forwardedFor = request.getHeader("X-Forwarded-For");
        if (forwardedFor == null || forwardedFor.isBlank()) {
            return remoteAddr;
        }
        String[] parts = forwardedFor.split(",");
        if (parts.length > MAX_FORWARDED_ENTRIES) {
            log.warn("x-forwarded-for too many entries, using remoteAddr");
            return remoteAddr;
        }
        String client = parts[0].trim();
        return client.isEmpty() ? remoteAddr : client;
    }

    private boolean isTrusted(String remoteAddr) {
        if (remoteAddr == null || remoteAddr.isBlank()) {
            return false;
        }
        for (String trusted : trustedProxies) {
            if (trusted.equals(remoteAddr)) {
                return true;
            }
            if (matchesCidr(remoteAddr, trusted)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 支持 {@code 10.0.0.0/8} 这类 CIDR 写法（容器网络里代理地址常常整段给出）。
     * 不合法或解析失败一律返回 false —— 判定"信任"必须失败关闭。
     */
    private static boolean matchesCidr(String remoteAddr, String trusted) {
        int slash = trusted.indexOf('/');
        if (slash <= 0) {
            return false;
        }
        try {
            int prefix = Integer.parseInt(trusted.substring(slash + 1));
            InetAddress proxy = InetAddress.getByName(trusted.substring(0, slash));
            InetAddress client = InetAddress.getByName(remoteAddr);
            byte[] proxyBytes = proxy.getAddress();
            byte[] clientBytes = client.getAddress();
            if (proxyBytes.length != clientBytes.length || prefix < 0 || prefix > proxyBytes.length * 8) {
                return false;
            }
            for (int bit = 0; bit < prefix; bit++) {
                int mask = 1 << (7 - (bit % 8));
                if ((proxyBytes[bit / 8] & mask) != (clientBytes[bit / 8] & mask)) {
                    return false;
                }
            }
            return true;
        } catch (NumberFormatException | UnknownHostException ex) {
            // UnknownHostException 在本分支只能是 remoteAddr 不是合法 IP 字面量（getRemoteAddr 理论上不会这样）。
            // 判定"信任"必须失败关闭：解析不了就不信任。
            return false;
        }
    }
}
