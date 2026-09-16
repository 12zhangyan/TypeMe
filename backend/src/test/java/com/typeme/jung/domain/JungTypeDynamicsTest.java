package com.typeme.jung.domain;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.DefaultResourceLoader;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 过程结构的推导必须**逐个类型**钉住，不能只测"不抛异常"。
 *
 * <p>这一层最容易犯的错有两类，而且都不会有任何运行期症状：
 * <ol>
 *   <li>把内倾型的推导写成外倾型那一套 —— 于是所有内倾型的主导与辅助正好互换，
 *       报告会给用户两段完全对不上自己的描述；</li>
 *   <li>把 {@code Si}/{@code Se} 这类方向写反 —— 字母看着都对，含义正好相反。</li>
 * </ol>
 *
 * <p>期望值不来自本实现的另一段代码，而来自**独立的出处**：
 * 《天资差异》第 2、8、9 章对每个类型的描述（书里按主导过程分组，
 * 并明确写出各类的辅助过程与"发展最不充分"的过程）。下表就是那份描述的形式化。
 */
class JungTypeDynamicsTest {

    /**
     * 16 型的过程结构：主导 / 辅助 / 第三位 / 第四位。
     *
     * <p>每一条都能在原书找到对应说法，例如：
     * <ul>
     *   <li>ISTJ：「内倾感觉型，偏好将思考而非情感作为辅助精神活动过程」（第 2 章）；</li>
     *   <li>INFP：「内倾情感型，偏好直觉而不是将感觉作为辅助精神活动过程」（第 2 章）；</li>
     *   <li>ISTP/INTP：同属第 9 章「9.3 内倾思考型」；</li>
     *   <li>ISTP/INTP：「内倾思考型的人发展最不充分的精神活动过程当然是外倾的情感」（第 9 章）
     *       —— 这一句同时印证了"第四位 = 主导**同一类**（判断）里的另一个功能、方向取反"：
     *       {@code Ti} 主导 → {@code Fe} 第四位。</li>
     * </ul>
     */
    private static final String[][] EXPECTED = {
            //  类型     主导    辅助    第三    第四
            { "ISTJ", "Si", "Te", "Fi", "Ne" },
            { "ISFJ", "Si", "Fe", "Ti", "Ne" },
            { "INFJ", "Ni", "Fe", "Ti", "Se" },
            { "INTJ", "Ni", "Te", "Fi", "Se" },
            { "ISTP", "Ti", "Se", "Ni", "Fe" },
            { "ISFP", "Fi", "Se", "Ni", "Te" },
            { "INFP", "Fi", "Ne", "Si", "Te" },
            { "INTP", "Ti", "Ne", "Si", "Fe" },
            { "ESTP", "Se", "Ti", "Fe", "Ni" },
            { "ESFP", "Se", "Fi", "Te", "Ni" },
            { "ENFP", "Ne", "Fi", "Te", "Si" },
            { "ENTP", "Ne", "Ti", "Fe", "Si" },
            { "ESTJ", "Te", "Si", "Ne", "Fi" },
            { "ESFJ", "Fe", "Si", "Ne", "Ti" },
            { "ENFJ", "Fe", "Ni", "Se", "Ti" },
            { "ENTJ", "Te", "Ni", "Se", "Fi" },
    };

    @Test
    @DisplayName("16 型的四个过程逐个与书中描述一致")
    void derivesAllSixteenTypes() {
        for (String[] row : EXPECTED) {
            JungTypeDynamics dynamics = JungTypeDynamics.of(JungTypeCode.parse(row[0]));
            List<String> actual = new ArrayList<>();
            dynamics.processes().forEach(process -> actual.add(process.token()));
            assertThat(actual)
                    .as("%s 的过程结构", row[0])
                    .containsExactly(row[1], row[2], row[3], row[4]);
        }
    }

    @Test
    @DisplayName("内倾者的主导过程朝里、辅助过程朝外（这条写反了整份报告都是反的）")
    void introvertsDominantIsIntroverted() {
        for (String[] row : EXPECTED) {
            JungTypeDynamics dynamics = JungTypeDynamics.of(JungTypeCode.parse(row[0]));
            boolean extraverted = row[0].charAt(0) == 'E';
            assertThat(dynamics.dominant().isIntroverted())
                    .as("%s 的主导过程方向", row[0])
                    .isEqualTo(!extraverted);
            assertThat(dynamics.auxiliary().isIntroverted())
                    .as("%s 的辅助过程方向", row[0])
                    .isEqualTo(extraverted);
            assertThat(dynamics.dominantExtraverted()).isEqualTo(extraverted);
        }
    }

    @Test
    @DisplayName("J/P 决定哪个过程对外使用：J 型对外用判断过程，P 型对外用感知过程")
    void judgingPerceivingDecidesOuterProcess() {
        for (String[] row : EXPECTED) {
            JungTypeDynamics dynamics = JungTypeDynamics.of(JungTypeCode.parse(row[0]));
            char jp = row[0].charAt(3);
            JungProcess outer = dynamics.dominantExtraverted() ? dynamics.dominant() : dynamics.auxiliary();
            assertThat(outer.attitude()).as("%s 对外过程的方向", row[0]).isEqualTo('e');
            assertThat(outer.isJudging())
                    .as("%s 的对外过程是不是判断过程", row[0])
                    .isEqualTo(jp == 'J');
        }
    }

    @Test
    @DisplayName("辅助过程与主导过程必然一判断一感知、一外一内")
    void auxiliaryBalancesDominant() {
        for (String[] row : EXPECTED) {
            JungTypeDynamics dynamics = JungTypeDynamics.of(JungTypeCode.parse(row[0]));
            assertThat(dynamics.auxiliary().isJudging())
                    .as("%s：主导 %s 与辅助 %s 必须分属判断/感知", row[0], dynamics.dominant(), dynamics.auxiliary())
                    .isNotEqualTo(dynamics.dominant().isJudging());
            assertThat(dynamics.auxiliary().attitude())
                    .isNotEqualTo(dynamics.dominant().attitude());
        }
    }

    @Test
    @DisplayName("四个过程恰好各占 S/N/T/F 之一，因此「功能族 → 过程」只有一个答案")
    void eachFunctionAppearsExactlyOnce() {
        for (String[] row : EXPECTED) {
            JungTypeDynamics dynamics = JungTypeDynamics.of(JungTypeCode.parse(row[0]));
            for (char function : new char[] { 'S', 'N', 'T', 'F' }) {
                int slot = dynamics.slotOfFunction(function);
                assertThat(dynamics.processes().get(slot).function())
                        .as("%s 的第 %d 位功能族", row[0], slot + 1)
                        .isEqualTo(function);
            }
        }
    }

    @Test
    @DisplayName("换边后果：EI 换主导与辅助、JP 换每一类所占的位置、SN/TF 换同类两个功能")
    void flipEffects() {
        JungTypeDynamics istj = JungTypeDynamics.of(JungTypeCode.parse("ISTJ"));

        // ISTJ 换 E/I 得到 ESTJ：还是那四个过程，主导与辅助互换。
        JungTypeDynamics.JungDimensionFlip ei = istj.flipEffect(JungDimension.EI);
        assertThat(ei.consequence()).isEqualTo(JungTypeDynamics.FlipConsequence.DOMINANT_AUXILIARY_SWAP);
        assertThat(JungTypeDynamics.of(JungTypeCode.parse("ESTJ")).processes())
                .containsExactly(JungProcess.Te, JungProcess.Si, JungProcess.Ne, JungProcess.Fi);

        // ISTJ 换 J/P 得到 **ISTP**（不是 ESTJ！）：四个过程全换，方向一个没变。
        JungTypeDynamics.JungDimensionFlip jp = istj.flipEffect(JungDimension.JP);
        assertThat(jp.consequence()).isEqualTo(JungTypeDynamics.FlipConsequence.CATEGORIES_SWAP_SLOTS);
        assertThat(JungTypeDynamics.of(JungTypeCode.parse("ISTP")).processes())
                .containsExactly(JungProcess.Ti, JungProcess.Se, JungProcess.Ni, JungProcess.Fe);

        // ISTJ 换 S/N 得到 INTJ：只有两个感知槽位换功能（主导 0 ↔ 第四位 3）。
        JungTypeDynamics.JungDimensionFlip sn = istj.flipEffect(JungDimension.SN);
        assertThat(sn.consequence()).isEqualTo(JungTypeDynamics.FlipConsequence.FUNCTIONS_SWAP);
        assertThat(sn.firstSlot()).isEqualTo(0);
        assertThat(sn.secondSlot()).isEqualTo(3);

        // INFP 的感知过程在辅助(1)与第三位(2)：换成 ISFP = Fi/Se/Ni/Te。
        JungTypeDynamics infp = JungTypeDynamics.of(JungTypeCode.parse("INFP"));
        JungTypeDynamics.JungDimensionFlip infpSn = infp.flipEffect(JungDimension.SN);
        assertThat(infpSn.firstSlot()).isEqualTo(1);
        assertThat(infpSn.secondSlot()).isEqualTo(2);
        assertThat(JungTypeDynamics.of(JungTypeCode.parse("ISFP")).processes())
                .containsExactly(JungProcess.Fi, JungProcess.Se, JungProcess.Ni, JungProcess.Te);
    }

    /**
     * 换边后果必须与"真的把那个字母换掉、重新推导一遍"的结果逐项对上。
     *
     * <p><b>这一条是为了拦住一次真实错误</b>：最早 {@code flipEffect} 把 J/P 写成
     * "主导与辅助互换"、把 E/I 写成"只是方向对调"，两条正好对调；而当时的测试拿
     * {@code ESTJ}（那是 <b>E/I</b> 换边的结果）去"印证 J/P"，于是断言全绿、
     * 错误照旧进了用户能看到的边界说明。抽象地断言"某个布尔为真"永远拦不住这类错 ——
     * 只有拿换完之后的**真实结构**逐槽位比对才行。
     *
     * <p>16 型 × 4 维 = 64 组，每组都按后果种类核对：
     * <ul>
     *   <li>{@code DOMINANT_AUXILIARY_SWAP}：四个过程**同一集合**，且 0↔1、2↔3 互换；</li>
     *   <li>{@code CATEGORIES_SWAP_SLOTS}：每个槽位的**方向不变**，判断/感知**整体互换**
     *       （四个过程全换）；</li>
     *   <li>{@code FUNCTIONS_SWAP}：只有那两个槽位变，且是同类里的另一个功能、方向不变。</li>
     * </ul>
     */
    @Test
    @DisplayName("16 型 × 4 维：换边后果与真实换过字母后的结构逐槽位一致")
    void flipEffectsMatchTheFlippedType() {
        for (String[] row : EXPECTED) {
            JungTypeCode code = JungTypeCode.parse(row[0]);
            JungTypeDynamics before = JungTypeDynamics.of(code);
            for (JungDimension dimension : JungDimension.values()) {
                String label = row[0] + " 换 " + dimension.name();
                JungTypeCode flippedCode = code.withPole(dimension, code.poleOf(dimension).opposite());
                // 换一个字母必然是另一个合法类型码，且换回来等于原样
                assertThat(flippedCode.value()).as("%s 后的类型码", label).isNotEqualTo(code.value());
                assertThat(flippedCode.withPole(dimension, flippedCode.poleOf(dimension).opposite()))
                        .as("%s 换两次必须回到原类型", label).isEqualTo(code);

                JungTypeDynamics after = JungTypeDynamics.of(flippedCode);
                List<JungProcess> b = before.processes();
                List<JungProcess> a = after.processes();
                JungTypeDynamics.FlipConsequence consequence = before.flipEffect(dimension).consequence();

                switch (consequence) {
                    case DOMINANT_AUXILIARY_SWAP -> {
                        assertThat(a).as("%s：四个过程不变（只是换了位置）", label)
                                .containsExactlyInAnyOrderElementsOf(b);
                        assertThat(a.get(0)).as("%s：主导与辅助互换", label).isEqualTo(b.get(1));
                        assertThat(a.get(1)).as("%s：辅助与主导互换", label).isEqualTo(b.get(0));
                        assertThat(a.get(2)).as("%s：第三位与第四位互换", label).isEqualTo(b.get(3));
                        assertThat(a.get(3)).as("%s：第四位与第三位互换", label).isEqualTo(b.get(2));
                    }
                    case CATEGORIES_SWAP_SLOTS -> {
                        for (int slot = 0; slot < 4; slot++) {
                            assertThat(a.get(slot).attitude())
                                    .as("%s：第 %d 位朝里/朝外必须不变", label, slot + 1)
                                    .isEqualTo(b.get(slot).attitude());
                            assertThat(a.get(slot).isJudging())
                                    .as("%s：第 %d 位必须换成另一类", label, slot + 1)
                                    .isNotEqualTo(b.get(slot).isJudging());
                        }
                        // 四个过程全换，一个都不留 —— 这正是"主导与辅助互换"说不通的地方
                        assertThat(a).as("%s：J/P 换边后四个过程全都不同", label).doesNotContainAnyElementsOf(b);
                    }
                    case FUNCTIONS_SWAP -> {
                        int first = before.flipEffect(dimension).firstSlot();
                        int second = before.flipEffect(dimension).secondSlot();
                        for (int slot = 0; slot < 4; slot++) {
                            if (slot == first || slot == second) {
                                continue;
                            }
                            assertThat(a.get(slot)).as("%s：第 %d 位不该变", label, slot + 1).isEqualTo(b.get(slot));
                        }
                        for (int slot : new int[] { first, second }) {
                            assertThat(a.get(slot).attitude())
                                    .as("%s：第 %d 位方向不变", label, slot + 1).isEqualTo(b.get(slot).attitude());
                            assertThat(a.get(slot).isJudging())
                                    .as("%s：第 %d 位换成同类里的另一个功能", label, slot + 1)
                                    .isEqualTo(b.get(slot).isJudging());
                            assertThat(a.get(slot)).as("%s：第 %d 位必须真的变了", label, slot + 1)
                                    .isNotEqualTo(b.get(slot));
                        }
                    }
                }
            }
        }
    }

    @Test
    @DisplayName("没有类型码就没有过程结构 —— 平分时不硬推一个")
    void refusesToDeriveWithoutTypeCode() {
        assertThatThrownBy(() -> JungTypeDynamics.of(null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("平分");
    }

    @Test
    @DisplayName("构造期不变量：手工拼一个错结构必须当场炸掉")
    void rejectsInconsistentStructure() {
        JungTypeCode istj = JungTypeCode.parse("ISTJ");
        // 主导与辅助同族同向 —— 这是"忘了翻方向"最常见的形态
        assertThatThrownBy(() -> new JungTypeDynamics(
                istj, JungProcess.Si, JungProcess.Se, JungProcess.Te, JungProcess.Ne))
                .isInstanceOf(IllegalStateException.class);
        // 第四位方向没翻
        assertThatThrownBy(() -> new JungTypeDynamics(
                istj, JungProcess.Si, JungProcess.Te, JungProcess.Fi, JungProcess.Si))
                .isInstanceOf(IllegalStateException.class);
        // 第三位只翻了方向、没换成同族的另一个功能（Te -> Ti），
        // 于是四个过程只覆盖 S/T 两族 —— 这正是本实现真实踩过并修掉的那一类错
        assertThatThrownBy(() -> new JungTypeDynamics(
                istj, JungProcess.Si, JungProcess.Te, JungProcess.Ti, JungProcess.Ne))
                .isInstanceOf(IllegalStateException.class);
    }

    /* ── 与共享夹具对齐 ─────────────────────────────────────────────────── */

    /**
     * 夹具里的 {@code typeProcesses} 是**第三份独立实现**（Node 参考实现）的产物，
     * 同时供前端 TypeScript 镜像使用。三者必须给出同一张表。
     *
     * <p>这一条是本节唯一能守住"内倾那一支没写反"的机器证据：
     * 内倾型推导写错时，8 个类型的主导与辅助会整对互换，而报告照样生成、页面照样渲染。
     */
    @Test
    @DisplayName("16 型过程结构必须与本类硬编码表、以及共享夹具三者一致")
    void agreesWithSharedFixture() throws Exception {
        JsonNode fixture;
        try (InputStream in = new DefaultResourceLoader()
                .getResource("classpath:fixtures/score-cases.json").getInputStream()) {
            fixture = new ObjectMapper().readTree(in);
        }
        JsonNode processes = fixture.path("typeProcesses");
        assertThat(processes.isArray()).as("夹具里必须有 typeProcesses").isTrue();
        assertThat(processes).hasSize(16);

        Map<String, String[]> fromFixture = new LinkedHashMap<>();
        for (JsonNode node : processes) {
            fromFixture.put(node.path("typeCode").asText(), new String[] {
                    node.path("dominant").asText(),
                    node.path("auxiliary").asText(),
                    node.path("tertiary").asText(),
                    node.path("inferior").asText() });
        }
        assertThat(fromFixture).hasSize(16);

        for (String[] row : EXPECTED) {
            assertThat(fromFixture.get(row[0]))
                    .as("夹具里 %s 的过程结构", row[0])
                    .containsExactly(row[1], row[2], row[3], row[4]);
        }
        for (String[] row : EXPECTED) {
            JungTypeDynamics dynamics = JungTypeDynamics.of(JungTypeCode.parse(row[0]));
            List<String> actual = new ArrayList<>();
            dynamics.processes().forEach(process -> actual.add(process.token()));
            assertThat(actual).as("%s 的推导结果", row[0]).containsExactly(fromFixture.get(row[0]));
        }
    }
}
