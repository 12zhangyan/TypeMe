// ⚠️ 本文件由 scripts/gen-fallback-content.mjs 从后端 YAML 自动生成，请勿手改。
//
// 唯一真相在 backend/src/main/resources/ 下：
//   content/questionnaire-quick.yml / content/types.yml / content/method.yml
//   assessment-packages/<packageId>.yml（v2 内容包：题面 + 帮助 + 维度解释 + 报告文案）
// 改内容请改后端 YAML，然后在前端目录执行 `npm run build`（prebuild 会重新生成）。
// 手改这里会在下一次构建时被覆盖，并被 src/content/consistency.spec.ts 判红。

import type { AssessmentPackage } from '@/domain/assessmentPackage'

/**
 * v2 内容包的内置副本（按 packageId 索引）。
 *
 * 使用规则（开发方案 §5.3 / §5.4）：
 *   - 接口超时、报错或结构非法时，**只能**用同一个 packageId 的内置副本；
 *     没有同包时显示不可用，不得悄悄切换到另一版内容；
 *   - 运行时一次只选择一个完整包，题面与帮助必须来自同一个包；
 *   - 内容包是不可变的：任何题面/帮助/报告文案改动都要换新的 packageId，
 *     因此这里的键只会增加，不会原地替换。
 */
export const FALLBACK_ASSESSMENT_PACKAGES: Record<string, AssessmentPackage> = {
  'ipip50-zh1': {
    schemaVersion: 2,
    packageId: 'ipip50-zh1',
    locale: 'zh-CN',
    localeRevision: 'ipip50-zh1-2026-09-15',
    helpRevision: 'help-ipip50-zh1-r1',
    copyRevision: 'report-ipip50-r1',
    contentStatus: 'draft',
    instrument: {
      id: 'ipip50',
      revision: 'goldberg-bfm-50',
      scoringVersion: 'ipip-bfm50-1.0',
      format: 'agreement',
      hasTypeCode: false,
    },
    interpretation: {
      version: 'typeme-conservative-v2',
      minRatingsPerDimension: 10,
      typeMinDistance: 6,
      markedDistance: 11,
    },
    title: 'IPIP 大五 50 题（候选修订稿）',
    estimatedMinutes: 6,
    dimensionOrder: [
      'E',
      'A',
      'C',
      'ES',
      'O',
    ],
    questionnaire: {
      version: 'ipip50',
      title: 'IPIP 大五人格 50 题',
      questionCount: 50,
      estimatedMinutes: 6,
      scoring: {
        midpoint: 30,
        constants: {
          E: 30,
          A: 24,
          C: 24,
          ES: 48,
          O: 18,
        },
      },
      questions: [
        {
          id: 1,
          text: '我是聚会里活跃气氛的那个人。',
          dimension: 'E',
          direction: 1,
        },
        {
          id: 2,
          text: '我很少关心别人的情况。',
          dimension: 'A',
          direction: -1,
        },
        {
          id: 3,
          text: '我通常提前做好准备。',
          dimension: 'C',
          direction: 1,
        },
        {
          id: 4,
          text: '我很容易感到压力大。',
          dimension: 'ES',
          direction: -1,
        },
        {
          id: 5,
          text: '我的词汇量比较丰富。',
          dimension: 'O',
          direction: 1,
        },
        {
          id: 6,
          text: '我平时话不多。',
          dimension: 'E',
          direction: -1,
        },
        {
          id: 7,
          text: '我对别人的事情感兴趣。',
          dimension: 'A',
          direction: 1,
        },
        {
          id: 8,
          text: '我的东西经常随手乱放。',
          dimension: 'C',
          direction: -1,
        },
        {
          id: 9,
          text: '我大多数时候比较放松。',
          dimension: 'ES',
          direction: 1,
        },
        {
          id: 10,
          text: '理解抽象的概念对我来说比较困难。',
          dimension: 'O',
          direction: -1,
        },
        {
          id: 11,
          text: '和别人在一起时我感到自在。',
          dimension: 'E',
          direction: 1,
        },
        {
          id: 12,
          text: '我会说让人难堪的话。',
          dimension: 'A',
          direction: -1,
        },
        {
          id: 13,
          text: '我会留意事情里的细节。',
          dimension: 'C',
          direction: 1,
        },
        {
          id: 14,
          text: '我常为各种事情担心。',
          dimension: 'ES',
          direction: -1,
        },
        {
          id: 15,
          text: '我的想象力比较丰富。',
          dimension: 'O',
          direction: 1,
        },
        {
          id: 16,
          text: '在集体场合我习惯待在不起眼的位置。',
          dimension: 'E',
          direction: -1,
        },
        {
          id: 17,
          text: '我能体谅别人的感受。',
          dimension: 'A',
          direction: 1,
        },
        {
          id: 18,
          text: '我常把事情弄得一团糟。',
          dimension: 'C',
          direction: -1,
        },
        {
          id: 19,
          text: '我很少感到情绪低落。',
          dimension: 'ES',
          direction: 1,
        },
        {
          id: 20,
          text: '我对抽象的想法不太感兴趣。',
          dimension: 'O',
          direction: -1,
        },
        {
          id: 21,
          text: '我常主动和别人搭话。',
          dimension: 'E',
          direction: 1,
        },
        {
          id: 22,
          text: '我对别人的困难不太感兴趣。',
          dimension: 'A',
          direction: -1,
        },
        {
          id: 23,
          text: '家务和杂事我会马上做完。',
          dimension: 'C',
          direction: 1,
        },
        {
          id: 24,
          text: '我很容易被周围的事情扰乱心绪。',
          dimension: 'ES',
          direction: -1,
        },
        {
          id: 25,
          text: '我常有不错的点子。',
          dimension: 'O',
          direction: 1,
        },
        {
          id: 26,
          text: '我没什么话要说。',
          dimension: 'E',
          direction: -1,
        },
        {
          id: 27,
          text: '我的心比较软。',
          dimension: 'A',
          direction: 1,
        },
        {
          id: 28,
          text: '我常忘记把东西放回原处。',
          dimension: 'C',
          direction: -1,
        },
        {
          id: 29,
          text: '我容易感到心里不痛快。',
          dimension: 'ES',
          direction: -1,
        },
        {
          id: 30,
          text: '我的想象力不太好。',
          dimension: 'O',
          direction: -1,
        },
        {
          id: 31,
          text: '在聚会上我会和很多不同的人交谈。',
          dimension: 'E',
          direction: 1,
        },
        {
          id: 32,
          text: '我对别人没什么兴趣。',
          dimension: 'A',
          direction: -1,
        },
        {
          id: 33,
          text: '我喜欢事情有条理。',
          dimension: 'C',
          direction: 1,
        },
        {
          id: 34,
          text: '我的心情变化比较大。',
          dimension: 'ES',
          direction: -1,
        },
        {
          id: 35,
          text: '我理解事情比较快。',
          dimension: 'O',
          direction: 1,
        },
        {
          id: 36,
          text: '我不喜欢让别人注意到我。',
          dimension: 'E',
          direction: -1,
        },
        {
          id: 37,
          text: '我愿意为别人留出时间。',
          dimension: 'A',
          direction: 1,
        },
        {
          id: 38,
          text: '我会回避自己该做的事。',
          dimension: 'C',
          direction: -1,
        },
        {
          id: 39,
          text: '我的情绪起伏比较频繁。',
          dimension: 'ES',
          direction: -1,
        },
        {
          id: 40,
          text: '我说话时会用比较生僻的词。',
          dimension: 'O',
          direction: 1,
        },
        {
          id: 41,
          text: '我不介意成为大家关注的焦点。',
          dimension: 'E',
          direction: 1,
        },
        {
          id: 42,
          text: '我能感受到别人的情绪。',
          dimension: 'A',
          direction: 1,
        },
        {
          id: 43,
          text: '我通常按计划安排事情。',
          dimension: 'C',
          direction: 1,
        },
        {
          id: 44,
          text: '我容易感到烦躁。',
          dimension: 'ES',
          direction: -1,
        },
        {
          id: 45,
          text: '我会花时间反思一些事情。',
          dimension: 'O',
          direction: 1,
        },
        {
          id: 46,
          text: '和不熟的人在一起时我比较安静。',
          dimension: 'E',
          direction: -1,
        },
        {
          id: 47,
          text: '我能让别人感到自在。',
          dimension: 'A',
          direction: 1,
        },
        {
          id: 48,
          text: '我对自己的工作标准要求比较严格。',
          dimension: 'C',
          direction: 1,
        },
        {
          id: 49,
          text: '我常感到情绪低落。',
          dimension: 'ES',
          direction: -1,
        },
        {
          id: 50,
          text: '我常常有很多想法。',
          dimension: 'O',
          direction: 1,
        },
      ],
      format: 'agreement',
      responseAnchors: [
        '非常不贴切',
        '有些不贴切',
        '谈不上贴切或不贴切',
        '有些贴切',
        '非常贴切',
      ],
    },
    itemHelp: {
      '1': {
        explanation: '这题问的是在聚会一类场合里，你是否常主动带动气氛、让场面热起来。例如一群人都在等谁先开口时，你会不会自然地接话。这只是一种常见倾向的描述，不代表能力强弱，也不说明哪种表现更好。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '2': {
        explanation: '这题问的是你平时对别人的处境和近况关注多少。比如同事提到家里遇到麻烦，你会不会想多问一句。关注得多与少都是常见倾向的描述，不代表人品好坏，也不说明有没有同情心。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '3': {
        explanation: '这题问的是做事之前是否习惯先把东西准备好。比如出门前检查证件、开会前把材料理一遍。提前准备和临时应付都是常见做法，不代表哪一边更聪明或更优秀。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '4': {
        explanation: '这题问的是面对要求和时间压力时，你的身体和情绪绷紧得快不快。比如几件事同时要交时，你会不会先感到紧张。这只是压力反应的常见描述，不代表抗压能力高低，也不说明心理健康状况。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '5': {
        explanation: '这题问的是你平时掌握和使用的词语多不多。比如写一段说明或和人聊天时，你能不能比较容易找到合适的词。词汇多少和阅读、受教育经历有关，只是一种常见描述，不代表聪明程度。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '6': {
        explanation: '这题问的是日常交流里你说话的分量多不多。比如几个人一起聊天时，你更常接话还是更多在听。话少是一种常见状态，不代表没有想法，也不说明表达能力。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '7': {
        explanation: '这题问的是你对别人的经历、想法和近况有没有好奇。比如新同事来了，你会不会想了解他之前做什么。对人和对事感兴趣都是常见倾向，不代表哪一种更值得肯定。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '8': {
        explanation: '这题问的是你的东西平时放在哪里。比如钥匙、衣服、文件是不是常常随手一放，过后再找。物品摆放习惯是很常见的差异，不代表懒散，也不说明做事能力。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '9': {
        explanation: '这题问的是你平时的底色是松弛还是紧绷。比如没有特别事情发生时，你多数时候是不是比较平静。放松是一种常见状态，不代表对事情不上心，也不说明有没有压力。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '10': {
        explanation: '这题问的是理解抽象内容时的顺手程度。比如听一场只讲概念和推演的讲座，你会不会觉得跟不上。偏好具体内容是很常见的，不代表理解力差，也不说明聪明程度。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '11': {
        explanation: '这题问的是和一群众人待在一起时你自不自在。比如聚餐、团建这类场合，你会不会觉得放松。自在与否是常见的感受差异，不代表社交能力强弱，也不说明是否合群。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '12': {
        explanation: '这题问的是你说话时会不会让对方难堪。比如着急或不同意时，你会不会用带刺的话回应。直接和委婉都是常见风格，不代表人品好坏，也不说明有没有教养。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '13': {
        explanation: '这题问的是你做事时会不会留意小处。比如核对数字、检查错别字这类需要细看的地方。留意细节是一种常见习惯，不代表能力高低，也不说明做事快慢。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '14': {
        explanation: '这题问的是你多久会为还没发生的事操心。比如第二天有一场重要的沟通，你前一晚会反复想各种可能。担心是常见的情绪反应，不代表胆小，也不说明处理事情的能力。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '15': {
        explanation: '这题问的是你脑子里画面和联想丰不丰富。比如读一段文字或听别人描述时，你会不会自动浮现出场景。想象力的多少是常见差异，不代表才华高低，也不说明是否务实。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '16': {
        explanation: '这题问的是在集体场合你更愿意站在什么位置。比如开会或活动时，你习惯靠前还是靠后、多说话还是少说话。选择低调是常见倾向，不代表没有主见，也不说明贡献多少。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '17': {
        explanation: '这题问的是别人说出自己的处境时，你能不能体会到他的感受。比如朋友说最近很累，你会不会先理解他的难处。体谅是常见的相处方式，不代表没有原则，也不说明会不会被人喜欢。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '18': {
        explanation: '这题问的是你做事时出岔子的频率。比如照着说明装东西，是不是常漏掉步骤或弄错顺序。做事情出点差错很常见，不代表能力差，也不说明态度问题。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '19': {
        explanation: '这题问的是你多久会出现情绪低落的时段。比如一段时间里事情都还顺利时，你多数时候心情如何。情绪低落的多少是常见差异，不代表坚强或脆弱，也不说明生活状态好坏。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '20': {
        explanation: '这题问的是你对纯想法、纯概念一类话题的兴趣。比如有人聊假设、定义、理论推演时，你会不会觉得没意思。偏好实际内容是很常见的，不代表思维水平，也不说明有没有深度。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '21': {
        explanation: '这题问的是你会不会主动开口搭话。比如在电梯里、排队时或新场合，你通常等别人先说还是自己先开口。主动开口是常见习惯，不代表健谈，也不说明是否受欢迎。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '22': {
        explanation: '这题问的是别人跟你讲自己的麻烦时，你有多大兴趣听下去。比如同事抱怨工作上的难处，你会不会想了解细节。兴趣多少是常见差异，不代表冷漠，也不说明愿不愿意帮忙。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '23': {
        explanation: '这题问的是日常杂事你会不会尽快处理。比如该洗的碗、该回的消息，你通常先做还是先放着。先做后做是常见习惯差异，不代表勤快与否，也不说明时间管理能力。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '24': {
        explanation: '这题问的是外界的小变化会不会搅动你的心绪。比如计划被临时改动，你会不会半天静不下来。容易被影响是常见的反应方式，不代表脆弱，也不说明心理承受力。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '25': {
        explanation: '这题问的是你想出点子的频率。比如讨论一个活动怎么办时，你会不会常提出新的做法。点子多少是常见差异，不代表创意能力，也不说明想法是否可行。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '26': {
        explanation: '这题问的是在需要发言的场合你通常有多少话想说。比如被问到一个话题时，你会不会觉得没什么可补充的。说得少是常见状态，不代表没有观点，也不说明参与度。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '27': {
        explanation: '这题问的是看到别人难受或遇到不幸时你的心软程度。比如听到陌生人的遭遇，你会不会心里不好受。心软是常见的感受方式，不代表没有原则，也不说明判断力。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '28': {
        explanation: '这题问的是用完的东西你会不会放回原处。比如剪刀、充电线、餐具用完后放在哪里。忘记归位很常见，不代表懒散，也不说明整理能力。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '29': {
        explanation: '这题问的是遇到不顺时你多快会心里不痛快。比如安排被临时改掉或被否定一句，你会不会一下就闷住。情绪来得快是常见反应，不代表玻璃心，也不说明成熟程度。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '30': {
        explanation: '这题问的是你需要构想或编例子时顺不顺手。比如要设计一个方案、想一个例子，你会不会觉得想不出来。想象力多少是常见差异，不代表能力高低，也不说明是否聪明。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '31': {
        explanation: '这题问的是在聚会里你会和多少人交谈。比如一个晚上下来，你是围着几个人聊还是不断换人搭话。和多少人说话是常见差别，不代表社交水平，也不说明是否受欢迎。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '32': {
        explanation: '这题问的是你对身边人的整体兴趣。比如别人分享日常生活时，你会不会觉得和自己关系不大。兴趣高低是常见差异，不代表冷漠，也不说明会不会帮助别人。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '33': {
        explanation: '这题问的是你对整齐和条理的偏好。比如桌面、文件和日程，你是不是希望它们各归各位。喜欢秩序是常见偏好，不代表死板，也不说明做事能力。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '34': {
        explanation: '这题问的是你的心情一天里会不会明显起落。比如上午还挺好，下午因为一件小事就沉下来。心情变化幅度是常见差异，不代表情绪管理差，也不说明心理状况。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '35': {
        explanation: '这题问的是接触新说法、新内容时你上手快不快。比如看一份以前没接触过的说明，你能不能很快抓住要点。理解快慢受经验和内容影响，不代表聪明程度，也不说明学习能力。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '36': {
        explanation: '这题问的是你愿不愿意被大家注意到。比如被点名表扬或在会上发言，你会不会希望换个方式。不想被关注是常见倾向，不代表自卑，也不说明能力。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '37': {
        explanation: '这题问的是你愿不愿意为别人挪出自己的时间。比如朋友临时找你帮忙，你会不会调整原定安排。愿意花时间是常见做法，不代表没有边界，也不说明会不会被人喜欢。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '38': {
        explanation: '这题问的是面对该自己承担的事情你会不会绕开。比如分工里属于自己的那部分，你会不会想推给别人或往后拖。回避任务是常见现象，不代表人品差，也不说明工作能力。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '39': {
        explanation: '这题问的是你的情绪起伏有多频繁。比如一周里心情在好和差之间来回切换的次数。起伏频繁是常见差异，不代表情绪管理能力差，也不说明心理是否健康。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '40': {
        explanation: '这题问的是你说话和写东西时的用词习惯。比如表达一个意思时，你会不会选不太常见的词。用词偏书面或偏口语都是常见风格，不代表学识高低，也不说明表达能力。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '41': {
        explanation: '这题问的是被众人注视时你的感受。比如上台介绍自己或当众讲话，你会不会觉得可以接受。介意与否是常见差异，不代表自信程度，也不说明实力。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '42': {
        explanation: '这题问的是你能不能觉察到别人情绪的变化。比如对方嘴上说没事，你会不会感到他其实不太舒服。感受得敏锐是常见差异，不代表判断一定准确，也不说明懂事与否。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '43': {
        explanation: '这题问的是你做事有没有固定的时间安排。比如一周的任务，你会不会按事先排好的顺序推进。按计划做事是常见习惯，不代表灵活度低，也不说明效率高低。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '44': {
        explanation: '这题问的是日常小事会不会让你烦躁。比如被打断、排队、反复解释时，你会不会很快失去耐心。容易烦躁是常见反应，不代表脾气坏，也不说明修养。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '45': {
        explanation: '这题问的是你会不会留出时间想事情。比如一天结束后，你会不会回想自己做过的事和当时的想法。花时间思考是常见习惯，不代表想得多，也不说明有没有深度。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '46': {
        explanation: '这题问的是面对不熟的人时你的状态。比如第一次见面的场合，你通常是话多还是安静。安静是常见状态，不代表冷淡，也不说明社交能力。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '47': {
        explanation: '这题问的是别人和你相处时会不会放松。比如初次见面，你会不会主动找话、照顾对方的节奏。让别人自在是常见做法，不代表讨好，也不说明受欢迎程度。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '48': {
        explanation: '这题问的是你对自己做事标准的要求。比如交出去的东西，你会不会反复检查到满意为止。标准高低是常见差异，不代表完美主义，也不说明能力。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '49': {
        explanation: '这题问的是你出现低落心情的频率。比如一段时间里，你是不是常常提不起劲。低落频繁是常见差异，不代表抑郁，也不说明生活好坏。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
      '50': {
        explanation: '这题问的是你脑子里想法多不多。比如聊天或做事时，你会不会同时冒出好几个方向。想法多是常见差异，不代表都会实现，也不说明创意能力。如果这句描述对你来说两边都不适用、或你缺少相关经历，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [],
      },
    },
    dimensionCopy: {
      E: {
        name: '外向性',
        lowPole: '低',
        highPole: '高',
        negative: {
          label: '内敛',
          description: '这一侧描述更偏好安静、独处或小范围互动的状态。它不等于不善交际，也不说明表达能力。',
          observation: '回想最近一次聚会或讨论，你在什么时刻觉得最省力。',
          action: '下次需要表达前，先留出几分钟独自整理要说的话。',
        },
        positive: {
          label: '外露',
          description: '这一侧描述更容易从与人互动、热闹场合中获得投入感。它不等于话多，也不等于擅长组织或带领别人。',
          observation: '回想一次与人交谈之后，你的精神是更足还是更累。',
          action: '需要理清想法时，先找一个人聊几分钟，再自己整理。',
        },
        balanced: {
          summary: '本次这一维的回答合计接近两侧均衡，先保留未定。可以回看具体题目，再观察不同情境下的表现。',
          observation: '分别回想一次独自待着的场合和一次与人相处的场合，比较哪种安排更让你恢复精神。',
        },
        insufficient: {
          summary: '这一维有题目尚未形成可计分的选择，因此暂不计算分数或判定方向。你可以回看帮助，也可以保留当前报告。',
          nextStep: '回看这一维尚未作答或标记为无法判断的题目，按平常与人相处的状态重新选一次；仍然说不清时可以保留未定。',
        },
      },
      A: {
        name: '宜人性',
        lowPole: '低',
        highPole: '高',
        negative: {
          label: '直接',
          description: '这一侧描述与人相处时更直接，较少把别人的感受放在前面。它不等于自私，也不说明人品好坏。',
          observation: '回想一次意见不合的谈话，你当时先想到的是事情本身还是对方的感受。',
          action: '表达不同意见前，先补一句你理解对方哪一点。',
        },
        positive: {
          label: '体谅',
          description: '这一侧描述与人相处时更常顾及别人的感受和需要。它不等于没有主见，也不等于一定会被人喜欢。',
          observation: '回想一次你迁就别人的场合，看看当时的取舍是什么。',
          action: '在顾及别人之外，也把自己的需要说出来一次。',
        },
        balanced: {
          summary: '本次这一维的回答合计接近两侧均衡，先保留未定。可以回看具体题目，再观察不同情境下的表现。',
          observation: '挑一件与人相关的小事，分别按直接说明和先照顾对方感受各想一遍，比较哪种更常被你采用。',
        },
        insufficient: {
          summary: '这一维有题目尚未形成可计分的选择，因此暂不计算分数或判定方向。你可以回看帮助，也可以保留当前报告。',
          nextStep: '回看这一维尚未作答或标记为无法判断的题目，按平常与人相处的方式重新选一次；仍然说不清时可以保留未定。',
        },
      },
      C: {
        name: '尽责性',
        lowPole: '低',
        highPole: '高',
        negative: {
          label: '随性',
          description: '这一侧描述做事更随性，对秩序和提前安排的要求相对低。它不等于懒惰，也不说明工作能力。',
          observation: '回想一件拖到最后才做的事，看看是什么让你延后开始。',
          action: '给一件小事先定一个开始时间，完成后只做记录，不作评价。',
        },
        positive: {
          label: '有序',
          description: '这一侧描述做事比较有条理，看重按计划和标准完成。它不等于死板，也不等于不会变通。',
          observation: '回想一次按计划推进的经历，看看哪一步安排真正帮到了你。',
          action: '安排里留出一小段可以调整的时间，遇到变化时先用它。',
        },
        balanced: {
          summary: '本次这一维的回答合计接近两侧均衡，先保留未定。可以回看具体题目，再观察不同情境下的表现。',
          observation: '回想一件已完成的事，看看事先安排和临时调整分别在哪个环节起了作用。',
        },
        insufficient: {
          summary: '这一维有题目尚未形成可计分的选择，因此暂不计算分数或判定方向。你可以回看帮助，也可以保留当前报告。',
          nextStep: '回看这一维尚未作答或标记为无法判断的题目，按平常做事的习惯重新选一次；仍然说不清时可以保留未定。',
        },
      },
      ES: {
        name: '情绪稳定性',
        lowPole: '低',
        highPole: '高',
        negative: {
          label: '易起伏',
          description: '这一侧描述情绪反应容易被牵动，遇到压力时起伏更明显。它不等于抗压能力差，也不说明心理是否健康。',
          observation: '回想最近一次情绪被牵动的时刻，当时具体发生了什么。',
          action: '情绪上来时，先做几次缓慢呼吸，再决定要不要马上回应。',
        },
        positive: {
          label: '平稳',
          description: '这一侧描述情绪在多数时候比较平稳，遇到压力后恢复得相对快。它不等于没有情绪，也不等于对事情不敏感。',
          observation: '回想一次遇到麻烦时的反应，你的情绪多久回到平常状态。',
          action: '把自己恢复状态的常用做法记下来，需要时主动用一次。',
        },
        balanced: {
          summary: '本次这一维的回答合计接近两侧均衡，先保留未定。可以回看具体题目，再观察不同情境下的表现。',
          observation: '分别回想一件顺利的事和一件不顺的事，比较你在两种情况下心情的变化幅度。',
        },
        insufficient: {
          summary: '这一维有题目尚未形成可计分的选择，因此暂不计算分数或判定方向。你可以回看帮助，也可以保留当前报告。',
          nextStep: '回看这一维尚未作答或标记为无法判断的题目，按平常的情绪状态重新选一次；仍然说不清时可以保留未定。',
        },
      },
      O: {
        name: '开放性',
        lowPole: '低',
        highPole: '高',
        negative: {
          label: '务实',
          description: '这一侧描述更关注具体、实际的信息，对抽象话题的兴趣相对少。它不等于缺乏想象力，也不说明聪明程度。',
          observation: '回想一次别人聊抽象话题的场合，你当时在关注什么。',
          action: '遇到抽象说法时，先找一个具体例子把它落到实处。',
        },
        positive: {
          label: '想象',
          description: '这一侧描述对想法、想象和抽象话题更容易产生兴趣。它不等于不切实际，也不说明知识水平。',
          observation: '记下一个你最近产生的联想或设想，看看它从哪来的。',
          action: '为这个设想补一条可以落地的具体做法，再决定要不要继续。',
        },
        balanced: {
          summary: '本次这一维的回答合计接近两侧均衡，先保留未定。可以回看具体题目，再观察不同情境下的表现。',
          observation: '同一件事分别用具体例子和抽象说法各讲一遍，比较哪一种更接近你的习惯。',
        },
        insufficient: {
          summary: '这一维有题目尚未形成可计分的选择，因此暂不计算分数或判定方向。你可以回看帮助，也可以保留当前报告。',
          nextStep: '回看这一维尚未作答或标记为无法判断的题目，按平常接触新想法时的习惯重新选一次；仍然说不清时可以保留未定。',
        },
      },
    },
    reportCopy: {
      typedTitle: '五个维度本次都有较明确的方向',
      typedSubtitle: '五个维度都达到本产品的展示条件。它描述的只是本次回答下的倾向，不代表稳定不变的个人特质。',
      partialTitle: '我的倾向，还有待观察的部分',
      partialSubtitle: '部分维度可以给出方向，其余维度本次还不足以给出方向，因此完整画像暂缺。',
      undeterminedTitle: '本次回答没有显示明确方向',
      undeterminedSubtitle: '五个维度都落在接近中点的范围，本次不给出任何方向判定。',
      insufficientTitle: '这次先保留未定',
      insufficientSubtitle: '有维度缺少足够的有效作答，本次不计算这些维度的分数。',
      typeReadingLead: '本量表不做归类命名：五个维度各自独立解释，不合并成一个单一的标签。',
      scoreMethodNote: '得分 = 该维度向上的题与向下的题分别求和后抵消（每题 1–5）。该维度 10 题都有数字答案时才会计算。',
      dimensionReviewLead: '下面是这一维相关的题目与你的选择。它只帮助回顾，不构成因果或诊断证据。',
      selfReflectionLead: '这段记录只用于你自己的观察，不计入量表分数，也不会改变上面的结果。',
    },
    nextSteps: [
      '挑几件日常小事，记下你当时怎么与人互动、怎么安排、情绪如何变化，只作记录，不下结论。',
      '在工作、学习和家庭等不同情境分别留意自己的表现，比较哪些比较稳定、哪些随情境变化。',
      '隔两三周再回看这次回答，比较各维度的方向是否一致；有变化是常见现象，可以继续观察。',
      '把这次结果当作描述当前倾向的一份记录，不用它来解释能力高低或给未来下判断。',
    ],
    attribution: {
      source: "International Personality Item Pool (IPIP) — Goldberg's Big-Five Factor Markers",
      author: 'Lewis R. Goldberg / IPIP',
      url: 'https://ipip.ori.org/newBigFive5broadKey.htm',
      license: 'Public Domain',
      licenseUrl: 'https://ipip.ori.org/newPermission.htm',
    },
  },

  'oejts32-zh1-report2': {
    schemaVersion: 2,
    packageId: 'oejts32-zh1-report2',
    locale: 'zh-CN',
    localeRevision: 'zh1-2026-09-01',
    helpRevision: 'help-zh1-r1',
    copyRevision: 'report2-r1',
    contentStatus: 'draft',
    instrument: {
      id: 'oejts32',
      revision: '1.2',
      scoringVersion: 'oejts-1.2',
      format: 'bipolar',
      hasTypeCode: true,
    },
    interpretation: {
      version: 'typeme-conservative-v2',
      minRatingsPerDimension: 8,
      typeMinDistance: 5,
      markedDistance: 9,
    },
    title: '快速版（现行题面）',
    estimatedMinutes: 5,
    dimensionOrder: [
      'EI',
      'SN',
      'TF',
      'JP',
    ],
    questionnaire: {
      version: 'quick',
      title: '快速版',
      questionCount: 32,
      estimatedMinutes: 5,
      scoring: {
        midpoint: 24,
        constants: {
          EI: 30,
          SN: 12,
          TF: 30,
          JP: 18,
        },
      },
      questions: [
        {
          id: 1,
          textLeft: '喜欢列清单',
          textRight: '凭记忆',
          dimension: 'JP',
          direction: 1,
        },
        {
          id: 2,
          textLeft: '习惯先怀疑',
          textRight: '愿意先相信',
          dimension: 'TF',
          direction: -1,
        },
        {
          id: 3,
          textLeft: '独处久了会无聊',
          textRight: '需要独处的时间',
          dimension: 'EI',
          direction: -1,
        },
        {
          id: 4,
          textLeft: '接受事物的现状',
          textRight: '不满足于事物的现状',
          dimension: 'SN',
          direction: 1,
        },
        {
          id: 5,
          textLeft: '房间保持整洁',
          textRight: '东西随手放',
          dimension: 'JP',
          direction: 1,
        },
        {
          id: 6,
          textLeft: '认为“像机器人”是贬义',
          textRight: '希望自己有一颗像机器一样精确的头脑',
          dimension: 'TF',
          direction: 1,
        },
        {
          id: 7,
          textLeft: '精力充沛',
          textRight: '平和沉静',
          dimension: 'EI',
          direction: -1,
        },
        {
          id: 8,
          textLeft: '更愿意做选择题',
          textRight: '更愿意做论述题',
          dimension: 'SN',
          direction: 1,
        },
        {
          id: 9,
          textLeft: '随性，有点乱',
          textRight: '有条理，按规矩放',
          dimension: 'JP',
          direction: -1,
        },
        {
          id: 10,
          textLeft: '容易被话伤到',
          textRight: '不太往心里去',
          dimension: 'TF',
          direction: 1,
        },
        {
          id: 11,
          textLeft: '在群体中状态最好',
          textRight: '独处时状态最好',
          dimension: 'EI',
          direction: -1,
        },
        {
          id: 12,
          textLeft: '关注当下',
          textRight: '关注未来',
          dimension: 'SN',
          direction: 1,
        },
        {
          id: 13,
          textLeft: '很早就做好计划',
          textRight: '事到临头才计划',
          dimension: 'JP',
          direction: 1,
        },
        {
          id: 14,
          textLeft: '希望被人敬重',
          textRight: '希望被人喜爱',
          dimension: 'TF',
          direction: -1,
        },
        {
          id: 15,
          textLeft: '社交聚会让我疲惫',
          textRight: '社交聚会让我兴奋',
          dimension: 'EI',
          direction: 1,
        },
        {
          id: 16,
          textLeft: '融入大家',
          textRight: '显得与众不同',
          dimension: 'SN',
          direction: 1,
        },
        {
          id: 17,
          textLeft: '保留各种可能',
          textRight: '确定下来',
          dimension: 'JP',
          direction: -1,
        },
        {
          id: 18,
          textLeft: '希望擅长修理东西',
          textRight: '希望擅长帮人解决问题',
          dimension: 'TF',
          direction: -1,
        },
        {
          id: 19,
          textLeft: '说得更多',
          textRight: '听得更多',
          dimension: 'EI',
          direction: -1,
        },
        {
          id: 20,
          textLeft: '讲一件事时，会说发生了什么',
          textRight: '讲一件事时，会说它意味着什么',
          dimension: 'SN',
          direction: 1,
        },
        {
          id: 21,
          textLeft: '立刻把事情做完',
          textRight: '习惯拖到最后',
          dimension: 'JP',
          direction: 1,
        },
        {
          id: 22,
          textLeft: '听从内心',
          textRight: '听从理智',
          dimension: 'TF',
          direction: 1,
        },
        {
          id: 23,
          textLeft: '待在家里',
          textRight: '出门去玩',
          dimension: 'EI',
          direction: 1,
        },
        {
          id: 24,
          textLeft: '想要看到整体',
          textRight: '想要看到细节',
          dimension: 'SN',
          direction: -1,
        },
        {
          id: 25,
          textLeft: '临场发挥',
          textRight: '事先准备',
          dimension: 'JP',
          direction: -1,
        },
        {
          id: 26,
          textLeft: '道德判断基于公正',
          textRight: '道德判断基于同情心',
          dimension: 'TF',
          direction: -1,
        },
        {
          id: 27,
          textLeft: '很难大声喊出来',
          textRight: '隔着老远喊人很自然',
          dimension: 'EI',
          direction: 1,
        },
        {
          id: 28,
          textLeft: '重理论',
          textRight: '重实证',
          dimension: 'SN',
          direction: -1,
        },
        {
          id: 29,
          textLeft: '工作起来很拼',
          textRight: '玩起来很拼',
          dimension: 'JP',
          direction: 1,
        },
        {
          id: 30,
          textLeft: '面对情绪不太自在',
          textRight: '很看重情绪',
          dimension: 'TF',
          direction: -1,
        },
        {
          id: 31,
          textLeft: '喜欢在人前表现',
          textRight: '尽量避免当众讲话',
          dimension: 'EI',
          direction: -1,
        },
        {
          id: 32,
          textLeft: '喜欢弄清“谁、什么、什么时候”',
          textRight: '喜欢弄清“为什么”',
          dimension: 'SN',
          direction: 1,
        },
      ],
    },
    itemHelp: {
      '1': {
        explanation: '比较你通常用什么方式记住要做的事，一侧是列成清单，另一侧是凭记忆。两种方式都可能用到，按更接近平常做法的程度选择，不是评价哪种方式更好。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'B',
        ],
      },
      '2': {
        explanation: '比较一般情况下先保留疑问还是先愿意相信的倾向。这不是要求你忽略证据去相信可疑信息，也不是评价诚实程度。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
          'C',
        ],
      },
      '3': {
        explanation: '比较你对独处的通常感受，一侧是独处久了容易觉得无聊，另一侧是需要安排出独处的时间。这两种感受可能同时存在，按更接近平常状态的程度选择。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'B',
        ],
      },
      '4': {
        explanation: '比较对事情现有样子的感受，一侧是较容易接受目前的状况，另一侧是常觉得目前的样子还不够。这不是问你的努力程度，也不是问你对某一件重大社会议题的态度。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
          'C',
        ],
      },
      '5': {
        explanation: '回想你通常怎么处理自己房间里的物品，一侧倾向保持整洁，另一侧倾向随手放在方便的位置。不要只按一次大扫除后的样子回答。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'C',
        ],
      },
      '6': {
        explanation: '左侧问你是否把“像机器人”看作负面评价，右侧问你是否希望自己的思考像机器一样精确。这里用的是比喻，两侧说的是不完全相同的一面，按更接近自己看法的程度选择。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
          'B',
        ],
      },
      '7': {
        explanation: '左侧描述精力活跃、劲头足，右侧描述平和沉静的状态。两种状态可能同时符合，不要只凭今天是否疲劳判断，也不涉及健康评价。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'B',
          'C',
        ],
      },
      '8': {
        explanation: '选择题给出选项供你挑选，论述题需要自己组织较完整的文字。比较你更愿意回答哪一种，不是问哪一种能拿高分。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'C',
        ],
      },
      '9': {
        explanation: '比较你安排事情和放置物品时呈现的样子，一侧偏向随性、零散，另一侧偏向有条理、按一定规矩放置。这不是评价勤劳、能力或是否守规矩。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
          'C',
        ],
      },
      '10': {
        explanation: '比较面对别人说的话时通常的感受程度，一侧是容易受到影响，另一侧是不太往心里去。这不代表敏感就是弱点，也不要求你对伤害性的话无动于衷。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'C',
        ],
      },
      '11': {
        explanation: '比较你在群体里做事和独自做事时的状态，一侧是在群体中更好，另一侧是独处时更好。这不是问你是否喜欢身边的人，也不是问你有没有能力与人合作。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
        ],
      },
      '12': {
        explanation: '“当下”指眼前正在发生的事，“未来”指尚未发生的情况。比较你的注意力通常更偏向哪一边，不是问你会不会做计划。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'B',
        ],
      },
      '13': {
        explanation: '比较你开始规划的时间早晚，一侧是提前很久就做好计划，另一侧是接近事情发生时才安排。这不是判断你会不会守约。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'C',
        ],
      },
      '14': {
        explanation: '“敬重”侧重认可与尊重，“喜爱”侧重亲近与好感。两者都希望得到是很常见的，按两侧更符合自己的程度选择。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'B',
        ],
      },
      '15': {
        explanation: '回顾你通常参加聚会后的感受，一侧是感到精力被消耗，另一侧是觉得更有精神。不要只用一次特别愉快或特别累的聚会代表全部，疲惫与兴奋也可能同时出现。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'B',
          'C',
        ],
      },
      '16': {
        explanation: '比较你通常更容易融入身边的人，还是更显得与别人不同。这不是判断哪一边更有个性或更优秀，也不是要求刻意迎合别人。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'C',
        ],
      },
      '17': {
        explanation: '比较做选择时继续留着几个可用方案，还是选定一个并确定下来的倾向。这里不特指恋爱关系或重大人生承诺。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
        ],
      },
      '18': {
        explanation: '比较你希望自己擅长的事情，一侧是处理物品方面的问题，另一侧是帮助别人处理他们遇到的问题。不是问你现在会不会修理，也不把其中一侧说成更有爱心。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'B',
          'C',
        ],
      },
      '19': {
        explanation: '比较你和别人交流时说话与倾听的相对比例。这不是判断哪一边更有价值，可以按常见场合的通常情况回答。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'C',
        ],
      },
      '20': {
        explanation: '一侧是讲述事情发生的经过，另一侧是讲述这件事说明了什么。比较你讲述时的侧重，不是问哪一种说法更真实。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
          'B',
        ],
      },
      '21': {
        explanation: '比较有事情要做时你通常多快开始并完成，一侧是尽快做完，另一侧是习惯往后拖。临时被其他事情挡住不等于拖延，也不因此评价你是否负责。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'C',
        ],
      },
      '22': {
        explanation: '左侧侧重自己的感受，右侧侧重理性的分析。两者都可能参与你的决定，不是“感性的人不理智”或“理性的人没有感受”。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
          'C',
        ],
      },
      '23': {
        explanation: '比较你通常更愿意待在家里还是出门活动。出门不一定等于社交，待在家里也可以与人互动；受出行条件限制时按平常意愿选择。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'C',
        ],
      },
      '24': {
        explanation: '“整体”指事情的大体结构与全貌，“细节”指具体组成和小处。比较你更想了解哪一边，两边都想知道是常见的。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
          'B',
        ],
      },
      '25': {
        explanation: '“临场发挥”是在情况出现后调整做法，“事先准备”是在之前做好安排。比较你更常采用哪一种，不是问你能不能在危险场合随意行动。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'C',
        ],
      },
      '26': {
        explanation: '一侧强调对不同人适用的公正原则，一侧强调对具体处境和感受的同情。两者可能兼顾，不存在更高尚的标准答案。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
          'B',
        ],
      },
      '27': {
        explanation: '比较大声喊话这件事对你是否自然，一侧是觉得很难，另一侧是对远处的人喊话很自然。这不是评价胆量，也不是评价说话方式。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'C',
        ],
      },
      '28': {
        explanation: '“理论”侧重用概念和原理说明事情，“实证”侧重从观察或实践中得到的事实和证据。两者都有价值，不是空想与科学的对比。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
        ],
      },
      '29': {
        explanation: '比较工作投入与玩乐投入这两种描述对你的符合程度。你可以两边都投入，也可以都不投入，不是要求你把其中一边放在第一位。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'B',
          'C',
        ],
      },
      '30': {
        explanation: '一侧描述面对情绪时的自在程度，另一侧描述重视情绪的程度。两者不是严格相反，也可能同时符合。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
          'B',
        ],
      },
      '31': {
        explanation: '一侧关于在别人面前展示或表演，另一侧关于在众人面前讲话。这两类场景不完全相同，若你的感受明显不一样，不必强行用一个分值概括。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
          'C',
        ],
      },
      '32': {
        explanation: '一侧关心涉及谁、发生了什么、什么时候发生，另一侧关心事情为什么发生。两边都想了解是可能的，不代表哪一边更深入或更聪明。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
          'B',
        ],
      },
    },
    dimensionCopy: {
      JP: {
        name: '安排方式',
        lowPole: 'J',
        highPole: 'P',
        negative: {
          label: '判断',
          description: '这一侧描述更偏好确定的安排与结构。它不等于勤奋，也不说明一定更可靠。',
          observation: '观察计划在什么情境下帮到了你。',
          action: '尝试为一个安排保留一个可以调整的小窗口。',
        },
        positive: {
          label: '知觉',
          description: '这一侧描述更偏好保留灵活性和继续调整。它不等于拖延，也不等于不负责任。',
          observation: '观察灵活性在什么情境下帮到了你。',
          action: '为一件重要事项设一个最晚检查节点。',
        },
        balanced: {
          summary: '本次这一维的回答合计接近两侧均衡，先保留未定。可以回看具体题目，再观察不同情境下的偏好。',
          observation: '回想一件已完成的事，看看事先安排和临场调整分别在哪个环节起了作用。',
        },
        insufficient: {
          summary: '这一维有题目尚未形成可计分的选择，因此暂不计算分数或判定方向。你可以回看帮助，也可以保留当前报告。',
          nextStep: '回看这一维尚未作答或标记为暂时无法判断的题目，就平常安排事情的习惯重新选一次；仍然说不清时可以保留未定。',
        },
      },
      TF: {
        name: '决策依据',
        lowPole: 'F',
        highPole: 'T',
        negative: {
          label: '情感',
          description: '这一侧描述更重视价值取向以及选择对人的影响。它不等于不理性，也不说明道德水平高低。',
          observation: '做一个选择时，写下自己最在意的价值。',
          action: '在价值之外，再补充实际成本与约束。',
        },
        positive: {
          label: '思考',
          description: '这一侧描述更重视逻辑一致、原则和分析依据。它不等于没有感受，也不说明道德水平高低。',
          observation: '做一个选择时，先列出判断依据。',
          action: '再主动了解相关人的感受，以及这个选择对他们的影响。',
        },
        balanced: {
          summary: '本次这一维的回答合计接近两侧均衡，先保留未定。可以回看具体题目，再观察不同情境下的偏好。',
          observation: '挑一个还没决定的小选择，分别按在意的价值和列出的依据各想一遍，比较哪一边更常被自己采用。',
        },
        insufficient: {
          summary: '这一维有题目尚未形成可计分的选择，因此暂不计算分数或判定方向。你可以回看帮助，也可以保留当前报告。',
          nextStep: '回看这一维尚未作答或标记为暂时无法判断的题目，就平常做选择时的依据重新选一次；仍然说不清时可以保留未定。',
        },
      },
      EI: {
        name: '精力方向',
        lowPole: 'I',
        highPole: 'E',
        negative: {
          label: '内向',
          description: '这一侧描述更偏好留出独处或内部整理的空间。它不等于害怕社交，也不说明表达能力。',
          observation: '回想一次交流前后，哪些安排让你更容易整理想法。',
          action: '下次重要讨论前，先给自己几分钟准备要点。',
        },
        positive: {
          label: '外向',
          description: '这一侧描述更偏好从外部互动和活动中获得投入感。它不等于总想说话，也不等于擅长领导。',
          observation: '回想一次互动是否帮助你理清了思路。',
          action: '需要想法时，可以先与人短时间交流，再独立整理。',
        },
        balanced: {
          summary: '本次这一维的回答合计接近两侧均衡，先保留未定。可以回看具体题目，再观察不同情境下的偏好。',
          observation: '分别回想一次需要独处的场合和一次与人一起的场合，比较哪种安排让你更容易恢复精力。',
        },
        insufficient: {
          summary: '这一维有题目尚未形成可计分的选择，因此暂不计算分数或判定方向。你可以回看帮助，也可以保留当前报告。',
          nextStep: '回看这一维尚未作答或标记为暂时无法判断的题目，按平常的精力状态重新选一次；仍然说不清时可以保留未定。',
        },
      },
      SN: {
        name: '信息关注方式',
        lowPole: 'S',
        highPole: 'N',
        negative: {
          label: '实感',
          description: '这一侧描述更关注具体事实、经验和可观察的信息。它不等于缺少想象力，也不说明聪明程度。',
          observation: '接触新任务时，观察自己是否先去找例子和事实。',
          action: '把已知信息先列清楚，再考虑还有哪些可能。',
        },
        positive: {
          label: '直觉',
          description: '这一侧描述更关注联系、模式和可能性。它不等于更聪明，也不等于不重视事实。',
          observation: '记录自己形成的一个推测。',
          action: '为这个推测再找一条可以支持或修正它的实际信息。',
        },
        balanced: {
          summary: '本次这一维的回答合计接近两侧均衡，先保留未定。可以回看具体题目，再观察不同情境下的偏好。',
          observation: '同一类事情分别试一次“先看例子和事实”和一次“先形成推测”，比较哪一种更顺手。',
        },
        insufficient: {
          summary: '这一维有题目尚未形成可计分的选择，因此暂不计算分数或判定方向。你可以回看帮助，也可以保留当前报告。',
          nextStep: '回看这一维尚未作答或标记为暂时无法判断的题目，就平常接触新信息时的习惯重新选一次；仍然说不清时可以保留未定。',
        },
      },
    },
    reportCopy: {
      typedTitle: '本次问卷参考组合',
      typedSubtitle: '四个维度都达到本产品的展示条件。它仍是本次回答下的参考组合，不代表稳定不变的类型。',
      partialTitle: '我的偏好，还有待观察的部分',
      partialSubtitle: '部分维度可以给出方向，其余维度本次不足以判型，因此完整类型为空。',
      undeterminedTitle: '本次回答没有显示明确方向',
      undeterminedSubtitle: '四个维度都落在接近中点的范围，本次不生成完整类型。',
      insufficientTitle: '这次先保留未定',
      insufficientSubtitle: '有维度缺少足够的有效作答，本次不计算这些维度的分数。',
      typeReadingLead: '类型参考介绍：按本版题目组合起来的通用阅读材料，不是逐项测得的个人能力。',
      scoreMethodNote: '得分 = 该维度常量 + Σ(方向符号 × 你的选择)。该维度 8 题都有数字答案时才会计算。',
      dimensionReviewLead: '下面是这一维相关的题目与你的选择。它只帮助回顾，不构成因果或诊断证据。',
      selfReflectionLead: '这段记录只用于你自己的观察，不计入量表分数，也不会改变上面的结果。',
    },
    nextSteps: [
      '挑一件日常小事，记下你当时关注的信息、用到的判断依据和安排方式，只作记录，不下结论。',
      '在工作、学习和与家人朋友相处等不同情境里分别留意自己的选择，比较哪些表现稳定、哪些随情境变化。',
      '隔两三周再回看这次回答，比较各维度的方向是否一致；有变化是常见现象，可以继续观察。',
    ],
    attribution: {
      source: 'Open Extended Jungian Type Scales (OEJTS) 1.2',
      author: 'Eric Jorgenson',
      url: 'https://openpsychometrics.org/tests/OEJTS/',
      license: 'CC BY-NC-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    },
  },

  'oejts32-zh2-preview-r1': {
    schemaVersion: 2,
    packageId: 'oejts32-zh2-preview-r1',
    locale: 'zh-CN',
    localeRevision: 'zh2-preview-r1-2026-09-15',
    helpRevision: 'help-zh2-r1',
    copyRevision: 'report2-r1',
    contentStatus: 'draft',
    instrument: {
      id: 'oejts32',
      revision: '1.2',
      scoringVersion: 'oejts-1.2',
      format: 'bipolar',
      hasTypeCode: true,
    },
    interpretation: {
      version: 'typeme-conservative-v2',
      minRatingsPerDimension: 8,
      typeMinDistance: 5,
      markedDistance: 9,
    },
    title: '快速版（审校候选题面·本地试用）',
    estimatedMinutes: 5,
    dimensionOrder: [
      'EI',
      'SN',
      'TF',
      'JP',
    ],
    questionnaire: {
      version: 'quick',
      title: '快速版（审校候选）',
      questionCount: 32,
      estimatedMinutes: 5,
      scoring: {
        midpoint: 24,
        constants: {
          EI: 30,
          SN: 12,
          TF: 30,
          JP: 18,
        },
      },
      questions: [
        {
          id: 1,
          textLeft: '倾向把要做的事列成清单',
          textRight: '倾向靠记忆记住要做的事',
          dimension: 'JP',
          direction: 1,
        },
        {
          id: 2,
          textLeft: '通常先持怀疑态度',
          textRight: '通常愿意先相信',
          dimension: 'TF',
          direction: -1,
        },
        {
          id: 3,
          textLeft: '独处时容易感到无聊',
          textRight: '觉得自己需要独处时间',
          dimension: 'EI',
          direction: -1,
        },
        {
          id: 4,
          textLeft: '较容易接受事情目前的样子',
          textRight: '常觉得事情目前的样子还不能让我满意',
          dimension: 'SN',
          direction: 1,
        },
        {
          id: 5,
          textLeft: '通常把自己的房间保持整洁',
          textRight: '通常把东西随手放在方便的位置',
          dimension: 'JP',
          direction: 1,
        },
        {
          id: 6,
          textLeft: '觉得被说“像机器人”是一种负面评价',
          textRight: '希望自己的头脑能像机器那样运作',
          dimension: 'TF',
          direction: 1,
        },
        {
          id: 7,
          textLeft: '通常精力充沛',
          textRight: '通常平和沉静',
          dimension: 'EI',
          direction: -1,
        },
        {
          id: 8,
          textLeft: '更愿意回答选择题',
          textRight: '更愿意回答需要展开说明的论述题',
          dimension: 'SN',
          direction: 1,
        },
        {
          id: 9,
          textLeft: '做事或安排比较随性、零散',
          textRight: '做事或安排比较有条理',
          dimension: 'JP',
          direction: -1,
        },
        {
          id: 10,
          textLeft: '容易因别人的话受到伤害',
          textRight: '不容易因别人的话受到伤害',
          dimension: 'TF',
          direction: 1,
        },
        {
          id: 11,
          textLeft: '与别人一起做事时，通常发挥更好',
          textRight: '自己独立做事时，通常发挥更好',
          dimension: 'EI',
          direction: -1,
        },
        {
          id: 12,
          textLeft: '注意力更常放在当下',
          textRight: '注意力更常放在未来',
          dimension: 'SN',
          direction: 1,
        },
        {
          id: 13,
          textLeft: '提前较长时间做计划',
          textRight: '接近事情发生时再做计划',
          dimension: 'JP',
          direction: 1,
        },
        {
          id: 14,
          textLeft: '更希望别人尊重我',
          textRight: '更希望别人喜欢我',
          dimension: 'TF',
          direction: -1,
        },
        {
          id: 15,
          textLeft: '参加聚会后，通常感到精力被消耗',
          textRight: '参加聚会后，通常感觉更有精神',
          dimension: 'EI',
          direction: 1,
        },
        {
          id: 16,
          textLeft: '通常容易融入周围的人',
          textRight: '通常显得与周围的人不同',
          dimension: 'SN',
          direction: 1,
        },
        {
          id: 17,
          textLeft: '倾向继续保留可选的方案',
          textRight: '倾向选定方案并确定下来',
          dimension: 'JP',
          direction: -1,
        },
        {
          id: 18,
          textLeft: '更希望擅长修理物品',
          textRight: '更希望擅长帮助别人处理他们遇到的问题',
          dimension: 'TF',
          direction: -1,
        },
        {
          id: 19,
          textLeft: '与别人交流时，我通常说得更多',
          textRight: '与别人交流时，我通常听得更多',
          dimension: 'EI',
          direction: -1,
        },
        {
          id: 20,
          textLeft: '讲述一件事时，更侧重发生的经过',
          textRight: '讲述一件事时，更侧重这件事的含义',
          dimension: 'SN',
          direction: 1,
        },
        {
          id: 21,
          textLeft: '有事情要做时，通常尽快完成',
          textRight: '有事情要做时，通常会往后拖',
          dimension: 'JP',
          direction: 1,
        },
        {
          id: 22,
          textLeft: '做决定时，更跟随内心感受',
          textRight: '做决定时，更跟随理性分析',
          dimension: 'TF',
          direction: 1,
        },
        {
          id: 23,
          textLeft: '通常更愿意待在家里',
          textRight: '通常更愿意出门活动',
          dimension: 'EI',
          direction: 1,
        },
        {
          id: 24,
          textLeft: '更想先了解整体情况',
          textRight: '更想先了解具体细节',
          dimension: 'SN',
          direction: -1,
        },
        {
          id: 25,
          textLeft: '通常倾向到现场再作应对',
          textRight: '通常倾向事先做好准备',
          dimension: 'JP',
          direction: -1,
        },
        {
          id: 26,
          textLeft: '判断一件事是否合宜时，更重视公平原则',
          textRight: '判断一件事是否合宜时，更重视对人的体谅',
          dimension: 'TF',
          direction: -1,
        },
        {
          id: 27,
          textLeft: '我觉得很难大声喊话',
          textRight: '对远处的人大声喊话，我觉得很自然',
          dimension: 'EI',
          direction: 1,
        },
        {
          id: 28,
          textLeft: '更偏重理论解释',
          textRight: '更偏重观察到的事实和实际证据',
          dimension: 'SN',
          direction: -1,
        },
        {
          id: 29,
          textLeft: '工作时通常很投入',
          textRight: '玩乐时通常很投入',
          dimension: 'JP',
          direction: 1,
        },
        {
          id: 30,
          textLeft: '面对情绪表达时，常感到不太自在',
          textRight: '觉得情绪感受很重要',
          dimension: 'TF',
          direction: -1,
        },
        {
          id: 31,
          textLeft: '喜欢在别人面前展示或表演',
          textRight: '倾向避免在众人面前讲话',
          dimension: 'EI',
          direction: -1,
        },
        {
          id: 32,
          textLeft: '更想弄清涉及谁、发生什么、何时发生',
          textRight: '更想弄清事情为什么发生',
          dimension: 'SN',
          direction: 1,
        },
      ],
    },
    itemHelp: {
      '1': {
        explanation: '比较你通常用什么方式记住要做的事。两种方式都会用时，按你觉得更接近自己的程度选择，不是评哪种方式更好。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'B',
        ],
      },
      '2': {
        explanation: '比较一般情况下先保留疑问还是先愿意相信的倾向。不是要求你忽略证据、相信可疑信息，也不是评价诚实程度。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
          'C',
        ],
      },
      '3': {
        explanation: '比较你对独处的通常感受。这里不要求你永远喜欢独处或永远不喜欢独处；若两侧差不多符合，可选中间。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'B',
        ],
      },
      '4': {
        explanation: '比较对事情现有样子的感受。不是问是否努力、能否改变现状，也不是问你对某一件重大问题的态度。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
          'C',
        ],
      },
      '5': {
        explanation: '回想通常对自己房间内物品的处理方式。不要只按一次大扫除后的样子回答；如果没有自己的空间，也可以暂时无法判断。',
        reviewStatus: 'draft',
        riskCodes: [
          'C',
        ],
      },
      '6': {
        explanation: '左侧问你是否把“像机器人”看作负面评价；右侧问你是否希望有机械式运作的思考方式。这是比喻，若觉得两侧不能表达你的看法，可以无法判断。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
          'B',
        ],
      },
      '7': {
        explanation: '左侧描述精力活跃，右侧描述平和温和的状态。两种描述可能同时符合；不要仅凭今天疲劳与否判断，也不涉及健康评价。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'B',
          'C',
        ],
      },
      '8': {
        explanation: '选择题提供选项；论述题需要自己组织较完整的文字。比较愿意回答哪种，不是问哪种能拿高分；没有相关经历可暂不判断。',
        reviewStatus: 'draft',
        riskCodes: [
          'C',
        ],
      },
      '9': {
        explanation: '比较安排事情时呈现出的随性零散或条理感。不是评价勤劳、能力或是否守规矩。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
          'C',
        ],
      },
      '10': {
        explanation: '比较面对别人言语时通常的感受程度。不代表敏感就是弱点，也不要求你对伤害性的言语无动于衷。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'C',
        ],
      },
      '11': {
        explanation: '比较共同做事与独立做事时的发挥感受。不是问是否喜欢同事，也不是问你有没有能力与别人合作。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
        ],
      },
      '12': {
        explanation: '“当下”指眼前正在发生的事；“未来”指尚未发生的情况。比较注意力通常更偏向哪里，不是问会不会做计划。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'B',
        ],
      },
      '13': {
        explanation: '比较开始规划的时间早晚。不是判断你会不会守约；不同事情差别很大、没有通常偏向时，可以暂不判断。',
        reviewStatus: 'draft',
        riskCodes: [
          'C',
        ],
      },
      '14': {
        explanation: '“尊重”侧重敬重和认可；“喜欢”侧重亲近和好感。两者都想要很常见，按两侧符合程度选择。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'B',
        ],
      },
      '15': {
        explanation: '回顾你通常参加聚会后的感受。不要只用一次特别愉快或特别累的聚会代表全部；疲惫与兴奋也可能同时出现。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'B',
          'C',
        ],
      },
      '16': {
        explanation: '比较自己通常更容易融入周围，还是更显得不同。不是判断哪一边更有个性或更优秀，也不是要求刻意迎合别人。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'C',
        ],
      },
      '17': {
        explanation: '比较作选择时继续留着几个方案，还是选定并确定一个方案的倾向。这里不特指恋爱关系或重大人生承诺。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
        ],
      },
      '18': {
        explanation: '比较你希望擅长的事情：处理物品的问题，或帮助别人处理他们的问题。不是问现在会不会修理，也不把其中一边说成更有爱心。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'B',
          'C',
        ],
      },
      '19': {
        explanation: '比较交流中通常说与听的相对比例。不是判断谁更有价值，也不要求按一次会议或特定岗位职责回答。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'C',
        ],
      },
      '20': {
        explanation: '“经过”是发生了哪些事；“含义”是你认为这件事说明了什么。比较讲述时的侧重，不是在问哪个更真实。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
          'B',
        ],
      },
      '21': {
        explanation: '比较拿到任务后通常多快开始并完成。不要把临时被其他事情阻挡直接当作拖延，也不因此评价你是否负责。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'C',
        ],
      },
      '22': {
        explanation: '左侧侧重自己的感受，右侧侧重理性分析。两者都可能参与决定；不是“感性的人不理智”或“理性的人没有感受”。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
          'C',
        ],
      },
      '23': {
        explanation: '比较通常更愿意待在家还是出门活动。出门不一定是社交，在家也可以与人互动；受出行条件限制时可以暂不判断。',
        reviewStatus: 'draft',
        riskCodes: [
          'C',
        ],
      },
      '24': {
        explanation: '“整体”指事情的大体结构和全貌；“细节”指具体组成和小处。比较你更想先了解哪一边，这不是在比哪一种能力更强。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
          'B',
        ],
      },
      '25': {
        explanation: '“现场应对”是在情况出现后调整做法；“事先准备”是在之前做好安排。不是问能否在危险事件中随意行动。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'C',
        ],
      },
      '26': {
        explanation: '一侧强调对不同人适用的公平原则，一侧强调对具体处境和感受的体谅。两者可能兼顾，不存在更高尚的标准答案。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
          'B',
        ],
      },
      '27': {
        explanation: '比较大声喊话这件事对你是否自然。嗓音条件或场合限制使你难以回答时，可以无法判断；不是评价胆量。',
        reviewStatus: 'draft',
        riskCodes: [
          'C',
        ],
      },
      '28': {
        explanation: '“理论解释”是用概念、原理说明事情；“事实和证据”是观察或实践中获得的信息。两者都有价值，不是空想与科学的对比。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
        ],
      },
      '29': {
        explanation: '比较工作投入与玩乐投入两种描述对你的符合程度。你可以两边都投入或都不投入；不是要求你必须把工作或娱乐放第一位。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'B',
          'C',
        ],
      },
      '30': {
        explanation: '一侧描述面对情绪的自在程度，另一侧描述重视情绪的程度。两者不是严格相反；若无法用这对描述定位，选择无法判断。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
          'B',
        ],
      },
      '31': {
        explanation: '一侧关于在人前展示/表演，另一侧关于当众讲话。若自己对这两种场景感受明显不同，不必强行用一个分值概括。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
          'C',
        ],
      },
      '32': {
        explanation: '一侧关心人物、事件、时间等信息，另一侧关心原因。两边都想了解是可能的，不代表哪个人更深入或更聪明。如果仍不能判断，或两边都不适用，可以选择“暂时无法判断”。',
        reviewStatus: 'draft',
        riskCodes: [
          'L',
          'B',
        ],
      },
    },
    dimensionCopy: {
      JP: {
        name: '安排方式',
        lowPole: 'J',
        highPole: 'P',
        negative: {
          label: '判断',
          description: '这一侧描述更偏好确定的安排与结构。它不等于勤奋，也不说明一定更可靠。',
          observation: '观察计划在什么情境下帮到了你。',
          action: '尝试为一个安排保留一个可以调整的小窗口。',
        },
        positive: {
          label: '知觉',
          description: '这一侧描述更偏好保留灵活性和继续调整。它不等于拖延，也不等于不负责任。',
          observation: '观察灵活性在什么情境下帮到了你。',
          action: '为一件重要事项设一个最晚检查节点。',
        },
        balanced: {
          summary: '本次这一维的回答合计接近两侧均衡，先保留未定。可以回看具体题目，再观察不同情境下的偏好。',
          observation: '回想一件已完成的事，看看事先安排和临场调整分别在哪个环节起了作用。',
        },
        insufficient: {
          summary: '这一维有题目尚未形成可计分的选择，因此暂不计算分数或判定方向。你可以回看帮助，也可以保留当前报告。',
          nextStep: '回看这一维尚未作答或标记为暂时无法判断的题目，就平常安排事情的习惯重新选一次；仍然说不清时可以保留未定。',
        },
      },
      TF: {
        name: '决策依据',
        lowPole: 'F',
        highPole: 'T',
        negative: {
          label: '情感',
          description: '这一侧描述更重视价值取向以及选择对人的影响。它不等于不理性，也不说明道德水平高低。',
          observation: '做一个选择时，写下自己最在意的价值。',
          action: '在价值之外，再补充实际成本与约束。',
        },
        positive: {
          label: '思考',
          description: '这一侧描述更重视逻辑一致、原则和分析依据。它不等于没有感受，也不说明道德水平高低。',
          observation: '做一个选择时，先列出判断依据。',
          action: '再主动了解相关人的感受，以及这个选择对他们的影响。',
        },
        balanced: {
          summary: '本次这一维的回答合计接近两侧均衡，先保留未定。可以回看具体题目，再观察不同情境下的偏好。',
          observation: '挑一个还没决定的小选择，分别按在意的价值和列出的依据各想一遍，比较哪一边更常被自己采用。',
        },
        insufficient: {
          summary: '这一维有题目尚未形成可计分的选择，因此暂不计算分数或判定方向。你可以回看帮助，也可以保留当前报告。',
          nextStep: '回看这一维尚未作答或标记为暂时无法判断的题目，就平常做选择时的依据重新选一次；仍然说不清时可以保留未定。',
        },
      },
      EI: {
        name: '精力方向',
        lowPole: 'I',
        highPole: 'E',
        negative: {
          label: '内向',
          description: '这一侧描述更偏好留出独处或内部整理的空间。它不等于害怕社交，也不说明表达能力。',
          observation: '回想一次交流前后，哪些安排让你更容易整理想法。',
          action: '下次重要讨论前，先给自己几分钟准备要点。',
        },
        positive: {
          label: '外向',
          description: '这一侧描述更偏好从外部互动和活动中获得投入感。它不等于总想说话，也不等于擅长领导。',
          observation: '回想一次互动是否帮助你理清了思路。',
          action: '需要想法时，可以先与人短时间交流，再独立整理。',
        },
        balanced: {
          summary: '本次这一维的回答合计接近两侧均衡，先保留未定。可以回看具体题目，再观察不同情境下的偏好。',
          observation: '分别回想一次需要独处的场合和一次与人一起的场合，比较哪种安排让你更容易恢复精力。',
        },
        insufficient: {
          summary: '这一维有题目尚未形成可计分的选择，因此暂不计算分数或判定方向。你可以回看帮助，也可以保留当前报告。',
          nextStep: '回看这一维尚未作答或标记为暂时无法判断的题目，按平常的精力状态重新选一次；仍然说不清时可以保留未定。',
        },
      },
      SN: {
        name: '信息关注方式',
        lowPole: 'S',
        highPole: 'N',
        negative: {
          label: '实感',
          description: '这一侧描述更关注具体事实、经验和可观察的信息。它不等于缺少想象力，也不说明聪明程度。',
          observation: '接触新任务时，观察自己是否先去找例子和事实。',
          action: '把已知信息先列清楚，再考虑还有哪些可能。',
        },
        positive: {
          label: '直觉',
          description: '这一侧描述更关注联系、模式和可能性。它不等于更聪明，也不等于不重视事实。',
          observation: '记录自己形成的一个推测。',
          action: '为这个推测再找一条可以支持或修正它的实际信息。',
        },
        balanced: {
          summary: '本次这一维的回答合计接近两侧均衡，先保留未定。可以回看具体题目，再观察不同情境下的偏好。',
          observation: '同一类事情分别试一次“先看例子和事实”和一次“先形成推测”，比较哪一种更顺手。',
        },
        insufficient: {
          summary: '这一维有题目尚未形成可计分的选择，因此暂不计算分数或判定方向。你可以回看帮助，也可以保留当前报告。',
          nextStep: '回看这一维尚未作答或标记为暂时无法判断的题目，就平常接触新信息时的习惯重新选一次；仍然说不清时可以保留未定。',
        },
      },
    },
    reportCopy: {
      typedTitle: '本次问卷参考组合',
      typedSubtitle: '四个维度都达到本产品的展示条件。它仍是本次回答下的参考组合，不代表稳定不变的类型。',
      partialTitle: '我的偏好，还有待观察的部分',
      partialSubtitle: '部分维度可以给出方向，其余维度本次不足以判型，因此完整类型为空。',
      undeterminedTitle: '本次回答没有显示明确方向',
      undeterminedSubtitle: '四个维度都落在接近中点的范围，本次不生成完整类型。',
      insufficientTitle: '这次先保留未定',
      insufficientSubtitle: '有维度缺少足够的有效作答，本次不计算这些维度的分数。',
      typeReadingLead: '类型参考介绍：按本版题目组合起来的通用阅读材料，不是逐项测得的个人能力。',
      scoreMethodNote: '得分 = 该维度常量 + Σ(方向符号 × 你的选择)。该维度 8 题都有数字答案时才会计算。',
      dimensionReviewLead: '下面是这一维相关的题目与你的选择。它只帮助回顾，不构成因果或诊断证据。',
      selfReflectionLead: '这段记录只用于你自己的观察，不计入量表分数，也不会改变上面的结果。',
    },
    nextSteps: [
      '挑一件日常小事，记下你当时关注的信息、用到的判断依据和安排方式，只作记录，不下结论。',
      '在工作、学习和与家人朋友相处等不同情境里分别留意自己的选择，比较哪些表现稳定、哪些随情境变化。',
      '隔两三周再回看这次回答，比较各维度的方向是否一致；有变化是常见现象，可以继续观察。',
    ],
    attribution: {
      source: 'Open Extended Jungian Type Scales (OEJTS) 1.2',
      author: 'Eric Jorgenson',
      url: 'https://openpsychometrics.org/tests/OEJTS/',
      license: 'CC BY-NC-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    },
  },
}

/** 所有内置包 ID（顺序即注册表顺序）。 */
export const ASSESSMENT_PACKAGE_IDS = [
  'ipip50-zh1',
  'oejts32-zh1-report2',
  'oejts32-zh2-preview-r1',
] as const

/** 默认内容包：现行中文题面 + 新报告政策。 */
export const DEFAULT_PACKAGE_ID = 'ipip50-zh1'
