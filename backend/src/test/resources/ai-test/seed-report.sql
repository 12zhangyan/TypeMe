-- AI 测试夹具：账号 + 内容包 + attempt + 答案 + 报告。
--
-- 三个用户：
--   u1 = 11111111-...（主测试用户，REFERENCE / ENFP / EI 边界）
--   u2 = 22222222-...（账号隔离用）
--   u3 = 33333333-...（已 DISABLED，用于"账号不可用"分支）
--
-- 时间一律 UTC（与契约 02 一致）；测试时钟固定为 2026-09-16T10:00:00Z。

DELETE FROM ai_analysis_job;
DELETE FROM ai_consent;
DELETE FROM ai_usage_budget;
DELETE FROM report_self_reflection;
DELETE FROM assessment_report;
DELETE FROM assessment_answer;
DELETE FROM assessment_attempt;
DELETE FROM assessment_package;
DELETE FROM app_user;

INSERT INTO app_user (id, username_normalized, username_display, password_hash, nickname, status,
                      created_at, password_changed_at, recovery_code_version)
VALUES ('11111111-1111-1111-1111-111111111111', 'u1', 'u1', 'x', '昵称不该外发',
        'ACTIVE', '2026-09-16 09:00:00.000000', '2026-09-16 09:00:00.000000', 0);
INSERT INTO app_user (id, username_normalized, username_display, password_hash, nickname, status,
                      created_at, password_changed_at, recovery_code_version)
VALUES ('22222222-2222-2222-2222-222222222222', 'u2', 'u2', 'x', NULL,
        'ACTIVE', '2026-09-16 09:00:00.000000', '2026-09-16 09:00:00.000000', 0);
INSERT INTO app_user (id, username_normalized, username_display, password_hash, nickname, status,
                      created_at, password_changed_at, recovery_code_version)
VALUES ('33333333-3333-3333-3333-333333333333', 'u3', 'u3', 'x', NULL,
        'DISABLED', '2026-09-16 09:00:00.000000', '2026-09-16 09:00:00.000000', 0);

INSERT INTO assessment_package (package_id, instrument_id, scoring_version, report_content_version,
                                content_status, content_json, sha256, published_at)
VALUES ('typeme-jung48-zh-v1', 'typeme-jung48', 'typeme-jung48-score-v1', 'typeme-type-report-zh-v1',
        'draft_review_pending',
        '{"schemaVersion":3,"packageId":"typeme-jung48-zh-v1","questions":[
           {"id":"EI-01","stage":"base","dimension":"EI","scenario":"工作节奏","leftPole":"I","rightPole":"E","order":1},
           {"id":"EI-02","stage":"base","dimension":"EI","scenario":"社交后的恢复","leftPole":"E","rightPole":"I","order":5},
           {"id":"EI-03","stage":"base","dimension":"EI","scenario":"会议发言","leftPole":"I","rightPole":"E","order":9},
           {"id":"EI-C1","stage":"clarification","dimension":"EI","scenario":"临时邀约","leftPole":"I","rightPole":"E","order":49},
           {"id":"SN-01","stage":"base","dimension":"SN","scenario":"看说明书","leftPole":"S","rightPole":"N","order":2},
           {"id":"SN-02","stage":"base","dimension":"SN","scenario":"听别人讲计划","leftPole":"N","rightPole":"S","order":6},
           {"id":"TF-01","stage":"base","dimension":"TF","scenario":"同事求助","leftPole":"T","rightPole":"F","order":3},
           {"id":"TF-02","stage":"base","dimension":"TF","scenario":"做取舍","leftPole":"F","rightPole":"T","order":7},
           {"id":"JP-01","stage":"base","dimension":"JP","scenario":"周末安排","leftPole":"J","rightPole":"P","order":4},
           {"id":"JP-02","stage":"base","dimension":"JP","scenario":"临时改计划","leftPole":"P","rightPole":"J","order":8}
         ]}',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '2026-09-16 09:00:00.000000');

INSERT INTO assessment_attempt (id, user_id, package_id, status, revision, current_question_id,
                                clarification_dimensions, clarification_skipped, base_attempt_id,
                                started_at, updated_at, submitted_at)
VALUES ('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
        'typeme-jung48-zh-v1', 'SUBMITTED', 9, NULL, 'EI', 0, NULL,
        '2026-09-16 09:30:00.000000', '2026-09-16 09:50:00.000000', '2026-09-16 09:50:00.000000');

-- 答案：EI 边界（S 很小），SN/TF/JP 方向明确。
INSERT INTO assessment_answer (attempt_id, question_id, kind, rating, updated_at) VALUES
 ('a1111111-1111-1111-1111-111111111111', 'EI-01', 'RATING', 4, '2026-09-16 09:40:00.000000'),
 ('a1111111-1111-1111-1111-111111111111', 'EI-02', 'RATING', 3, '2026-09-16 09:40:00.000000'),
 ('a1111111-1111-1111-1111-111111111111', 'EI-03', 'RATING', 4, '2026-09-16 09:40:00.000000'),
 ('a1111111-1111-1111-1111-111111111111', 'SN-01', 'RATING', 5, '2026-09-16 09:40:00.000000'),
 ('a1111111-1111-1111-1111-111111111111', 'SN-02', 'RATING', 2, '2026-09-16 09:40:00.000000'),
 ('a1111111-1111-1111-1111-111111111111', 'TF-01', 'RATING', 1, '2026-09-16 09:40:00.000000'),
 ('a1111111-1111-1111-1111-111111111111', 'TF-02', 'UNKNOWN', NULL, '2026-09-16 09:40:00.000000'),
 ('a1111111-1111-1111-1111-111111111111', 'JP-01', 'RATING', 5, '2026-09-16 09:40:00.000000'),
 ('a1111111-1111-1111-1111-111111111111', 'JP-02', 'RATING', 5, '2026-09-16 09:40:00.000000');

-- u1 的报告：REFERENCE / ENFP，EI 边界（TENTATIVE 语义在 report_json 里体现，状态字段独立）。
INSERT INTO assessment_report (id, attempt_id, user_id, status, computed_type_code, score_json, report_json,
                               report_hash, created_at)
VALUES ('r1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111',
        '11111111-1111-1111-1111-111111111111', 'TENTATIVE', 'ENFP', '{}',
        '{"schemaVersion":1,"reportId":"r1111111-1111-1111-1111-111111111111",
          "attemptId":"a1111111-1111-1111-1111-111111111111",
          "createdAt":"2026-09-16T09:50:00Z","status":"TENTATIVE","computedTypeCode":"ENFP",
          "typeSource":"computed","summary":"本次更接近 ENFP。","boundaries":[
            {"dimension":"EI","pole":"E","mFinal":0.08,"note":"本次略偏 E（倾向较轻）"}],
          "tiedDimensions":[],
          "dimensions":[
            {"dimension":"EI","negativePole":"I","positivePole":"E","computedPole":"E","tiedSide":"positive",
             "SBase":1,"nBase":12,"mBase":0.04,"SClar":1,"nClar":4,"mClar":0.13,
             "SFinal":2,"nFinal":16,"mFinal":0.08,"position":0.54,"boundary":true,"coverageOk":true,
             "baseRatingCount":12,"baseUnknownCount":0,"baseUnprocessedCount":0,
             "clarificationScheduled":true,"clarificationSkipped":false,"clarificationRatingCount":4},
            {"dimension":"SN","negativePole":"S","positivePole":"N","computedPole":"N","tiedSide":"positive",
             "SBase":14,"nBase":12,"mBase":0.58,"SClar":0,"nClar":0,"mClar":null,
             "SFinal":14,"nFinal":12,"mFinal":0.58,"position":0.79,"boundary":false,"coverageOk":true,
             "baseRatingCount":12,"baseUnknownCount":0,"baseUnprocessedCount":0,
             "clarificationScheduled":false,"clarificationSkipped":false,"clarificationRatingCount":0},
            {"dimension":"TF","negativePole":"T","positivePole":"F","computedPole":"T","tiedSide":"negative",
             "SBase":-10,"nBase":12,"mBase":-0.42,"SClar":0,"nClar":0,"mClar":null,
             "SFinal":-10,"nFinal":12,"mFinal":-0.42,"position":0.29,"boundary":false,"coverageOk":true,
             "baseRatingCount":12,"baseUnknownCount":1,"baseUnprocessedCount":0,
             "clarificationScheduled":false,"clarificationSkipped":false,"clarificationRatingCount":0},
            {"dimension":"JP","negativePole":"J","positivePole":"P","computedPole":"P","tiedSide":"positive",
             "SBase":-8,"nBase":12,"mBase":-0.33,"SClar":0,"nClar":0,"mClar":null,
             "SFinal":-8,"nFinal":12,"mFinal":-0.33,"position":0.33,"boundary":false,"coverageOk":true,
             "baseRatingCount":12,"baseUnknownCount":0,"baseUnprocessedCount":0,
             "clarificationScheduled":false,"clarificationSkipped":false,"clarificationRatingCount":0}],
          "candidates":[
            {"typeCode":"ENFP","cost":0,"differsOn":[],"tied":false},
            {"typeCode":"INFP","cost":2,"differsOn":["EI"],"tied":false}],
          "tieNotice":null,
          "typeSections":[{"key":"dailyLife","title":"日常表现","body":"……"}],
          "nextActions":[{"title":"……","steps":["……"]}],
          "share":{"kind":"TENTATIVE","headline":"本次更接近 ENFP","subtitle":"……","boundaryNote":"本次略偏 E"},
          "methodology":{"scoringVersion":"typeme-jung48-score-v1","packageId":"typeme-jung48-zh-v1",
            "reportContentVersion":"typeme-type-report-zh-v1","submittedAt":"2026-09-16T09:50:00Z",
            "contentStatus":"draft_review_pending"},
          "reportHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        '2026-09-16 09:50:00.000000');

-- u1 的第二份报告：TIED（computedTypeCode 为 NULL），用于"referenceType 必须为 null"的校验。
INSERT INTO assessment_attempt (id, user_id, package_id, status, revision, current_question_id,
                                clarification_dimensions, clarification_skipped, base_attempt_id,
                                started_at, updated_at, submitted_at)
VALUES ('a2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
        'typeme-jung48-zh-v1', 'SUBMITTED', 3, NULL, '', 0, NULL,
        '2026-09-16 09:30:00.000000', '2026-09-16 09:45:00.000000', '2026-09-16 09:45:00.000000');

INSERT INTO assessment_report (id, attempt_id, user_id, status, computed_type_code, score_json, report_json,
                               report_hash, created_at)
VALUES ('r2222222-2222-2222-2222-222222222222', 'a2222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', 'TIED', NULL, '{}',
        '{"schemaVersion":1,"reportId":"r2222222-2222-2222-2222-222222222222",
          "attemptId":"a2222222-2222-2222-2222-222222222222",
          "createdAt":"2026-09-16T09:45:00Z","status":"TIED","computedTypeCode":null,
          "typeSource":"none","summary":"这次没有唯一类型。","boundaries":[],"tiedDimensions":["EI"],
          "dimensions":[
            {"dimension":"EI","negativePole":"I","positivePole":"E","computedPole":null,"tiedSide":"tied",
             "SBase":0,"nBase":12,"mBase":0.0,"SClar":0,"nClar":0,"mClar":null,
             "SFinal":0,"nFinal":12,"mFinal":0.0,"position":0.5,"boundary":false,"coverageOk":true,
             "baseRatingCount":12,"baseUnknownCount":0,"baseUnprocessedCount":0,
             "clarificationScheduled":false,"clarificationSkipped":false,"clarificationRatingCount":0},
            {"dimension":"SN","negativePole":"S","positivePole":"N","computedPole":"N","tiedSide":"positive",
             "SBase":6,"nBase":12,"mBase":0.25,"SClar":0,"nClar":0,"mClar":null,
             "SFinal":6,"nFinal":12,"mFinal":0.25,"position":0.63,"boundary":false,"coverageOk":true,
             "baseRatingCount":12,"baseUnknownCount":0,"baseUnprocessedCount":0,
             "clarificationScheduled":false,"clarificationSkipped":false,"clarificationRatingCount":0},
            {"dimension":"TF","negativePole":"T","positivePole":"F","computedPole":"F","tiedSide":"positive",
             "SBase":4,"nBase":12,"mBase":0.17,"SClar":0,"nClar":0,"mClar":null,
             "SFinal":4,"nFinal":12,"mFinal":0.17,"position":0.58,"boundary":false,"coverageOk":true,
             "baseRatingCount":12,"baseUnknownCount":0,"baseUnprocessedCount":0,
             "clarificationScheduled":false,"clarificationSkipped":false,"clarificationRatingCount":0},
            {"dimension":"JP","negativePole":"J","positivePole":"P","computedPole":"J","tiedSide":"negative",
             "SBase":-4,"nBase":12,"mBase":-0.17,"SClar":0,"nClar":0,"mClar":null,
             "SFinal":-4,"nFinal":12,"mFinal":-0.17,"position":0.42,"boundary":false,"coverageOk":true,
             "baseRatingCount":12,"baseUnknownCount":0,"baseUnprocessedCount":0,
             "clarificationScheduled":false,"clarificationSkipped":false,"clarificationRatingCount":0}],
          "candidates":[{"typeCode":"ENFJ","cost":0,"differsOn":[],"tied":false},
                        {"typeCode":"INFJ","cost":0,"differsOn":["EI"],"tied":true}],
          "tieNotice":"这些候选在本次数据里没有区别。","typeSections":[],
          "nextActions":[],
          "share":{"kind":"TIED","headline":"几个类型都值得一起看","subtitle":"……","boundaryNote":null},
          "methodology":{"scoringVersion":"typeme-jung48-score-v1","packageId":"typeme-jung48-zh-v1",
            "reportContentVersion":"typeme-type-report-zh-v1","submittedAt":"2026-09-16T09:45:00Z",
            "contentStatus":"draft_review_pending"},
          "reportHash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}',
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        '2026-09-16 09:45:00.000000');

-- u2 的报告（账号隔离：u1 不能读/重试 u2 的任务）。
INSERT INTO assessment_attempt (id, user_id, package_id, status, revision, current_question_id,
                                clarification_dimensions, clarification_skipped, base_attempt_id,
                                started_at, updated_at, submitted_at)
VALUES ('a3333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222',
        'typeme-jung48-zh-v1', 'SUBMITTED', 3, NULL, '', 0, NULL,
        '2026-09-16 09:30:00.000000', '2026-09-16 09:45:00.000000', '2026-09-16 09:45:00.000000');

INSERT INTO assessment_report (id, attempt_id, user_id, status, computed_type_code, score_json, report_json,
                               report_hash, created_at)
VALUES ('r3333333-3333-3333-3333-333333333333', 'a3333333-3333-3333-3333-333333333333',
        '22222222-2222-2222-2222-222222222222', 'REFERENCE', 'ISTJ', '{}',
        '{"schemaVersion":1,"reportId":"r3333333-3333-3333-3333-333333333333",
          "attemptId":"a3333333-3333-3333-3333-333333333333",
          "createdAt":"2026-09-16T09:45:00Z","status":"REFERENCE","computedTypeCode":"ISTJ",
          "typeSource":"computed","summary":"本次参考类型是 ISTJ。","boundaries":[],"tiedDimensions":[],
          "dimensions":[
            {"dimension":"EI","negativePole":"I","positivePole":"E","computedPole":"I","tiedSide":"negative",
             "SBase":-14,"nBase":12,"mBase":-0.58,"SClar":0,"nClar":0,"mClar":null,
             "SFinal":-14,"nFinal":12,"mFinal":-0.58,"position":0.21,"boundary":false,"coverageOk":true,
             "baseRatingCount":12,"baseUnknownCount":0,"baseUnprocessedCount":0,
             "clarificationScheduled":false,"clarificationSkipped":false,"clarificationRatingCount":0},
            {"dimension":"SN","negativePole":"S","positivePole":"N","computedPole":"S","tiedSide":"negative",
             "SBase":-14,"nBase":12,"mBase":-0.58,"SClar":0,"nClar":0,"mClar":null,
             "SFinal":-14,"nFinal":12,"mFinal":-0.58,"position":0.21,"boundary":false,"coverageOk":true,
             "baseRatingCount":12,"baseUnknownCount":0,"baseUnprocessedCount":0,
             "clarificationScheduled":false,"clarificationSkipped":false,"clarificationRatingCount":0},
            {"dimension":"TF","negativePole":"T","positivePole":"F","computedPole":"T","tiedSide":"negative",
             "SBase":-14,"nBase":12,"mBase":-0.58,"SClar":0,"nClar":0,"mClar":null,
             "SFinal":-14,"nFinal":12,"mFinal":-0.58,"position":0.21,"boundary":false,"coverageOk":true,
             "baseRatingCount":12,"baseUnknownCount":0,"baseUnprocessedCount":0,
             "clarificationScheduled":false,"clarificationSkipped":false,"clarificationRatingCount":0},
            {"dimension":"JP","negativePole":"J","positivePole":"P","computedPole":"J","tiedSide":"negative",
             "SBase":-14,"nBase":12,"mBase":-0.58,"SClar":0,"nClar":0,"mClar":null,
             "SFinal":-14,"nFinal":12,"mFinal":-0.58,"position":0.21,"boundary":false,"coverageOk":true,
             "baseRatingCount":12,"baseUnknownCount":0,"baseUnprocessedCount":0,
             "clarificationScheduled":false,"clarificationSkipped":false,"clarificationRatingCount":0}],
          "candidates":[{"typeCode":"ISTJ","cost":0,"differsOn":[],"tied":false}],
          "tieNotice":null,"typeSections":[],"nextActions":[],
          "share":{"kind":"REFERENCE","headline":"本次参考类型 ISTJ","subtitle":"……","boundaryNote":null},
          "methodology":{"scoringVersion":"typeme-jung48-score-v1","packageId":"typeme-jung48-zh-v1",
            "reportContentVersion":"typeme-type-report-zh-v1","submittedAt":"2026-09-16T09:45:00Z",
            "contentStatus":"draft_review_pending"},
          "reportHash":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}',
        'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        '2026-09-16 09:45:00.000000');

-- 额度起点：显式写 0，让"预留了几次"可以被精确断言（不依赖 H2 的 upsert 行为）。
INSERT INTO ai_usage_budget (scope_key, budget_date, reserved_calls, actual_calls, actual_tokens,
                             estimated_cost_micros, revision)
VALUES ('user:11111111-1111-1111-1111-111111111111', DATE '2026-09-16', 0, 0, 0, 0, 0);
INSERT INTO ai_usage_budget (scope_key, budget_date, reserved_calls, actual_calls, actual_tokens,
                             estimated_cost_micros, revision)
VALUES ('global', DATE '2026-09-16', 0, 0, 0, 0, 0);
