package com.typeme.ai.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.util.ArrayList;
import java.util.List;

/**
 * 确定性 mock 输出生成器。
 *
 * <p>为什么不直接返回一段硬编码 JSON：mock 必须**通过同一套 {@code ReportAnalysisValidator}**
 * 才有意义。硬编码的 evidenceIds 会在证据选择规则变化时静默失效，于是"mock 全绿但真实调用全红"。
 * 这里改成按请求里的 report/evidence 现算，让 mock 与真实路径走同一组约束。
 */
final class MockAnalysisBodies {

    private MockAnalysisBodies() {
    }

    /** 与契约 §5 的长度要求一致：summary 80–160 字，每个 body 200–350 字。 */
    static ObjectNode build(ObjectMapper mapper, String userPrompt) {
        JsonNode input = readTree(mapper, userPrompt);
        String referenceType = input == null ? null : text(input.path("report").path("referenceType"));
        List<String> evidenceIds = evidenceIds(input);
        String topic = input == null ? "overall" : text(input.path("topic"));
        if (input != null && com.typeme.ai.input.ReadableReportInput.SCHEMA_VERSION.equals(
                input.path("outputSchema").path("properties").path("schemaVersion").path("const").asText())) {
            ObjectNode readable = mapper.createObjectNode();
            readable.put("schemaVersion", com.typeme.ai.input.ReadableReportInput.SCHEMA_VERSION);
            if (referenceType == null) readable.putNull("referenceType");
            else readable.put("referenceType", referenceType);
            readable.put("summary", "这是一份演示解释，用来查看页面如何呈现本次结果。请结合固定报告逐个阅读各方面的回答，差距较小或回答不足的地方先保留疑问，不急着给自己下结论。");
            ArrayNode observations = readable.putArray("observations");
            if (!evidenceIds.isEmpty()) {
                ObjectNode observation = observations.addObject();
                observation.put("plainText", "报告中的每个方面分别说明一种回答倾向，不能把其中一项扩展成对整个人的评价。也不需要把所有描述都当成自己在每个场合的固定表现。");
                observation.put("example", "例如，可以选一个自己最想了解的方面，回想最近一次相关情境，看看当时的做法是否与报告一致。");
                observation.putArray("evidenceIds").add(evidenceIds.get(0));
                ObjectNode action = readable.putObject("suggestedAction");
                action.put("what", "选一个想了解的方面，记下一次与之相关的经历。");
                action.put("when", "下一次遇到类似场景时，花一分钟记录。");
                action.put("observe", "看看哪些描述符合自己、哪些不符合；没有帮助的建议不必坚持。");
                action.putArray("evidenceIds").add(evidenceIds.get(0));
            } else readable.putNull("suggestedAction");
            readable.putArray("limitations").add("这是演示内容，没有调用真实模型，也不能证明这份问卷已经完成真人验证。");
            return readable;
        }

        ObjectNode root = mapper.createObjectNode();
        root.put("schemaVersion", "1");
        if (referenceType == null) {
            root.putNull("referenceType");
        } else {
            root.put("referenceType", referenceType);
        }
        root.put("summary", summary(referenceType, topic));

        ArrayNode sections = root.putArray("sections");
        sections.add(section(mapper, "overall", "整体印象", evidenceIds));
        sections.add(section(mapper, sectionKeyFor(topic), "主题展开", evidenceIds));
        sections.add(section(mapper, "boundary", "倾向较轻的地方", evidenceIds));

        ArrayNode boundaryNotes = root.putArray("boundaryNotes");
        boundaryNotes.add("有些维度本次只是略偏一侧，两边都值得一起看，不必急着给自己下结论。");

        ArrayNode actions = root.putArray("actions");
        actions.add(action(mapper, "记录一周里的能量变化", evidenceIds));
        actions.add(action(mapper, "给沟通留一个缓冲动作", evidenceIds));
        actions.add(action(mapper, "把待办按自己的节奏重排一次", evidenceIds));

        ArrayNode questions = root.putArray("reflectionQuestions");
        questions.add("最近哪一次交流让你觉得特别耗神，当时发生了什么？");
        questions.add("如果只调整一个小习惯，你最想先试哪一个？");

        return root;
    }

    private static ObjectNode section(ObjectMapper mapper, String key, String title, List<String> evidenceIds) {
        ObjectNode node = mapper.createObjectNode();
        node.put("key", key);
        node.put("title", title);
        node.put("body", body(key));
        ArrayNode ids = node.putArray("evidenceIds");
        for (String id : evidenceIds) {
            ids.add(id);
        }
        return node;
    }

    private static ObjectNode action(ObjectMapper mapper, String title, List<String> evidenceIds) {
        ObjectNode node = mapper.createObjectNode();
        node.put("title", title);
        ArrayNode steps = node.putArray("steps");
        steps.add("先只做一次，不要求自己坚持一整周。");
        steps.add("做完记一句话：当时感觉更轻松还是更紧绷。");
        ArrayNode ids = node.putArray("evidenceIds");
        for (String id : evidenceIds) {
            ids.add(id);
        }
        return node;
    }

    private static String summary(String referenceType, String topic) {
        String focus = switch (topic == null ? "" : topic) {
            case "communication" -> "在与人相处这件事上，";
            case "studyWork" -> "在学习和工作的节奏上，";
            case "growth" -> "在接下来想尝试的改变上，";
            default -> "在整体上，";
        };
        String tail = referenceType == null
                ? "这次有几个维度两边几乎一样，所以没有唯一的方向，几个候选都值得一起读。"
                : "本次更接近 " + referenceType + "，但偏向较轻的维度只说明这一侧多一些，不代表固定结论。";
        return focus + "这份说明只依据本次回答里方向比较清楚的部分，以及服务端挑选的少量证据片段。"
                + "它讲的是当下这份数据，不是关于你的定论。" + tail;
    }

    private static String body(String key) {
        return repeat(bodySentence(key), 3);
    }

    private static String bodySentence(String key) {
        return switch (key) {
            case "communication" -> "你在沟通里更看重把话说清楚还是先照顾气氛，这会决定你在会议和私下聊天里的不同表现；"
                    + "当对方节奏比你快时，你可能先附和再回头想，当对方节奏比你慢时，你又容易替对方把话说完。"
                    + "这些都不是缺点，只是需要被看见的默认设置，配合证据片段一起看会更具体。";
            case "studyWork" -> "你的学习与工作方式有两个可切换的档位：一种是先把框架搭好再开始动手，另一种是先做起来再逐步修正；"
                    + "在需要长期推进的事情上，前一种更省心，在变化快的任务上，后一种更不容易卡住。"
                    + "本次回答里能看到你更常落在哪一档，也能看到另一档并非做不到。";
            case "growth" -> "成长建议只在你说想试试的时候才成立；比起给自己加要求，更有效的是把动作缩小到一次就能做完的粒度。"
                    + "例如把少刷手机换成睡前把手机放在客厅充电，把多表达换成这周在会上主动说一次自己的判断。"
                    + "小动作的意义在于它能被观察，从而让你知道哪种方式对自己真的更省力。";
            case "boundary" -> "倾向较轻的意思是：本次回答里这一侧确实多一点，但多出来的部分不足以支撑我就是这样的结论；"
                    + "更稳妥的读法是把两侧都当成可用工具，按场景挑一个。"
                    + "如果你在某个具体场景里发现另一侧更顺手，那不是矛盾，而是说明你在这件事上有弹性。";
            default -> "先把这次的数据读成方向与强度两件事：方向告诉你偏向哪一侧，强度告诉你这个偏向有多稳；"
                    + "四个维度里，有的方向清楚，有的只是略偏，略偏的维度不要当作结论使用。"
                    + "下面的说明会把一般性的类型描述和来自本次回答的观察分开，后者会引用具体的证据片段。";
        };
    }

    private static String sectionKeyFor(String topic) {
        return switch (topic == null ? "" : topic) {
            case "communication" -> "communication";
            case "studyWork" -> "studyWork";
            case "growth" -> "growth";
            default -> "overall";
        };
    }

    /** 把一段话重复到足够长（满足 150–350 字），同时避免出现被禁表述。 */
    private static String repeat(String sentence, int times) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < Math.max(1, times); i++) {
            sb.append(sentence);
        }
        return sb.toString();
    }

    private static JsonNode readTree(ObjectMapper mapper, String userPrompt) {
        if (userPrompt == null || userPrompt.isBlank()) {
            return null;
        }
        try {
            return mapper.readTree(userPrompt);
        } catch (Exception ex) {
            return null;
        }
    }

    private static List<String> evidenceIds(JsonNode input) {
        List<String> ids = new ArrayList<>();
        if (input == null) {
            return ids;
        }
        JsonNode evidence = input.path("evidence");
        if (evidence.isArray()) {
            for (JsonNode item : evidence) {
                String id = text(item.path("id"));
                if (id != null) {
                    ids.add(id);
                }
            }
        }
        // 只取前 3 条，避免 mock 输出完全等于输入（保持"模型做过选择"的形状）。
        return new ArrayList<>(ids.subList(0, Math.min(3, ids.size())));
    }

    private static String text(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return null;
        }
        String value = node.asText();
        return value == null || value.isBlank() ? null : value;
    }
}
