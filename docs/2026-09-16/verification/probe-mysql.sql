-- ============================================================
-- TypeMe migrations: behavior/constraint probes on real MySQL 8.4
-- ASCII-only on purpose (Windows PowerShell 5.1 mangles UTF-8 w/o BOM).
-- Only runs against typeme_dev (project-owned database).
-- Each statement is executed separately by run-probes.ps1.
-- ============================================================

-- ---------- prep: one legal app_user ----------
INSERT INTO app_user (id, username_normalized, username_display, password_hash, status, role,
                      created_at, password_changed_at, recovery_code_version)
VALUES ('11111111-1111-1111-1111-111111111111', 'alice', 'Alice', '{pbkdf2}$fake', 'ACTIVE', 'USER',
        NOW(6), NOW(6), 1);

-- [P1] duplicate username_normalized (same case)
INSERT INTO app_user (id, username_normalized, username_display, password_hash, status,
                      created_at, password_changed_at, recovery_code_version)
VALUES ('11111111-1111-1111-1111-111111111112', 'alice', 'Alice2', 'x', 'ACTIVE', NOW(6), NOW(6), 1);

-- [P2] username differing only by case (probe utf8mb4_0900_ai_ci case-insensitivity)
INSERT INTO app_user (id, username_normalized, username_display, password_hash, status,
                      created_at, password_changed_at, recovery_code_version)
VALUES ('11111111-1111-1111-1111-111111111113', 'ALICE', 'Alice3', 'x', 'ACTIVE', NOW(6), NOW(6), 1);

-- [P3] username with one trailing space (probe NO PAD collation)
INSERT INTO app_user (id, username_normalized, username_display, password_hash, status,
                      created_at, password_changed_at, recovery_code_version)
VALUES ('11111111-1111-1111-1111-111111111114', 'alice ', 'Alice4', 'x', 'ACTIVE', NOW(6), NOW(6), 1);

-- [P4] illegal role
INSERT INTO app_user (id, username_normalized, username_display, password_hash, status, role,
                      created_at, password_changed_at, recovery_code_version)
VALUES ('11111111-1111-1111-1111-111111111115', 'bob', 'Bob', 'x', 'ACTIVE', 'SUPERUSER', NOW(6), NOW(6), 1);

-- [P5] lowercase legal role (probe whether ai_ci widens the CHECK whitelist)
INSERT INTO app_user (id, username_normalized, username_display, password_hash, status, role,
                      created_at, password_changed_at, recovery_code_version)
VALUES ('11111111-1111-1111-1111-111111111116', 'carol', 'Carol', 'x', 'ACTIVE', 'user', NOW(6), NOW(6), 1);

-- [P6] CHECK enforced on the UPDATE path too?
UPDATE app_user SET role = 'HACKER' WHERE id = '11111111-1111-1111-1111-111111111111';

-- [P7] does omitting role pick up DEFAULT 'USER'?
INSERT INTO app_user (id, username_normalized, username_display, password_hash, status,
                      created_at, password_changed_at, recovery_code_version)
VALUES ('11111111-1111-1111-1111-111111111117', 'dave', 'Dave', 'x', 'ACTIVE', NOW(6), NOW(6), 1);
SELECT username_normalized, role FROM app_user WHERE username_normalized = 'dave';

-- ---------- prep: one package + 8 attempts (one per report probe) ----------
INSERT INTO assessment_package (package_id, instrument_id, scoring_version, report_content_version,
                                content_status, content_json, sha256, published_at)
VALUES ('pkg-1', 'inst-1', 'sc-1', 'rc-1', 'PUBLISHED', '{}', REPEAT('a', 64), NOW(6));

INSERT INTO assessment_attempt (id, user_id, package_id, status, revision, current_question_id,
                                clarification_dimensions, clarification_skipped, base_attempt_id,
                                started_at, updated_at, submitted_at)
VALUES
 ('22222222-2222-2222-2222-222222222221', '11111111-1111-1111-1111-111111111111', 'pkg-1', 'SUBMITTED', 1, NULL, '[]', 0, NULL, NOW(6), NOW(6), NULL),
 ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'pkg-1', 'SUBMITTED', 1, NULL, '[]', 0, NULL, NOW(6), NOW(6), NULL),
 ('22222222-2222-2222-2222-222222222223', '11111111-1111-1111-1111-111111111111', 'pkg-1', 'SUBMITTED', 1, NULL, '[]', 0, NULL, NOW(6), NOW(6), NULL),
 ('22222222-2222-2222-2222-222222222224', '11111111-1111-1111-1111-111111111111', 'pkg-1', 'SUBMITTED', 1, NULL, '[]', 0, NULL, NOW(6), NOW(6), NULL),
 ('22222222-2222-2222-2222-222222222225', '11111111-1111-1111-1111-111111111111', 'pkg-1', 'SUBMITTED', 1, NULL, '[]', 0, NULL, NOW(6), NOW(6), NULL),
 ('22222222-2222-2222-2222-222222222226', '11111111-1111-1111-1111-111111111111', 'pkg-1', 'SUBMITTED', 1, NULL, '[]', 0, NULL, NOW(6), NOW(6), NULL),
 ('22222222-2222-2222-2222-222222222227', '11111111-1111-1111-1111-111111111111', 'pkg-1', 'SUBMITTED', 1, NULL, '[]', 0, NULL, NOW(6), NOW(6), NULL),
 ('22222222-2222-2222-2222-222222222228', '11111111-1111-1111-1111-111111111111', 'pkg-1', 'SUBMITTED', 1, NULL, '[]', 0, NULL, NOW(6), NOW(6), NULL);

-- [P8] clarification_skipped = 2 (illegal bit value)
INSERT INTO assessment_attempt (id, user_id, package_id, status, revision, clarification_dimensions,
                                clarification_skipped, started_at, updated_at)
VALUES ('33333333-3333-3333-3333-333333333331', '11111111-1111-1111-1111-111111111111', 'pkg-1', 'DRAFT', 0, '[]', 2, NOW(6), NOW(6));

-- ---------- report / type-code CHECK probes ----------
-- [P9] illegal type code 'XX'
INSERT INTO assessment_report (id, attempt_id, user_id, status, computed_type_code, score_json, report_json, report_hash, created_at)
VALUES ('44444444-4444-4444-4444-444444444401', '22222222-2222-2222-2222-222222222221', '11111111-1111-1111-1111-111111111111', 'READY', 'XX', '{}', '{}', REPEAT('b',64), NOW(6));

-- [P10] legal type code 'ISTJ'
INSERT INTO assessment_report (id, attempt_id, user_id, status, computed_type_code, score_json, report_json, report_hash, created_at)
VALUES ('44444444-4444-4444-4444-444444444402', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'READY', 'ISTJ', '{}', '{}', REPEAT('b',64), NOW(6));

-- [P11] TIED semantics: computed_type_code IS NULL
INSERT INTO assessment_report (id, attempt_id, user_id, status, computed_type_code, score_json, report_json, report_hash, created_at)
VALUES ('44444444-4444-4444-4444-444444444403', '22222222-2222-2222-2222-222222222223', '11111111-1111-1111-1111-111111111111', 'READY', NULL, '{}', '{}', REPEAT('b',64), NOW(6));

-- [P12] lowercase 'istj' (probe whether ai_ci makes the CHECK whitelist toothless)
INSERT INTO assessment_report (id, attempt_id, user_id, status, computed_type_code, score_json, report_json, report_hash, created_at)
VALUES ('44444444-4444-4444-4444-444444444404', '22222222-2222-2222-2222-222222222224', '11111111-1111-1111-1111-111111111111', 'READY', 'istj', '{}', '{}', REPEAT('b',64), NOW(6));

-- [P13] 2-char value (does CHAR_LENGTH on a CHAR(4) column see the padding?)
INSERT INTO assessment_report (id, attempt_id, user_id, status, computed_type_code, score_json, report_json, report_hash, created_at)
VALUES ('44444444-4444-4444-4444-444444444405', '22222222-2222-2222-2222-222222222225', '11111111-1111-1111-1111-111111111111', 'READY', 'EI', '{}', '{}', REPEAT('b',64), NOW(6));

-- [P14] 4 chars but not whitelisted ('XXXX')
INSERT INTO assessment_report (id, attempt_id, user_id, status, computed_type_code, score_json, report_json, report_hash, created_at)
VALUES ('44444444-4444-4444-4444-444444444406', '22222222-2222-2222-2222-222222222226', '11111111-1111-1111-1111-111111111111', 'READY', 'XXXX', '{}', '{}', REPEAT('b',64), NOW(6));

-- [P15] second report for the same attempt_id -> UNIQUE must reject
INSERT INTO assessment_report (id, attempt_id, user_id, status, computed_type_code, score_json, report_json, report_hash, created_at)
VALUES ('44444444-4444-4444-4444-444444444407', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'READY', 'ISTJ', '{}', '{}', REPEAT('c',64), NOW(6));

-- [P16] nonexistent user_id -> FK must reject
INSERT INTO assessment_report (id, attempt_id, user_id, status, computed_type_code, score_json, report_json, report_hash, created_at)
VALUES ('44444444-4444-4444-4444-444444444408', '22222222-2222-2222-2222-222222222227', '99999999-9999-9999-9999-999999999999', 'READY', 'ISTJ', '{}', '{}', REPEAT('d',64), NOW(6));

-- ---------- answer CHECK probes ----------
-- [P17] kind='RATING' with rating NULL (CHECK evaluates to UNKNOWN -> allowed?)
INSERT INTO assessment_answer (attempt_id, question_id, kind, rating, updated_at)
VALUES ('22222222-2222-2222-2222-222222222221', 'Q1', 'RATING', NULL, NOW(6));

-- [P18] kind='RATING', rating=9 (out of range)
INSERT INTO assessment_answer (attempt_id, question_id, kind, rating, updated_at)
VALUES ('22222222-2222-2222-2222-222222222221', 'Q2', 'RATING', 9, NOW(6));

-- [P19] kind='UNKNOWN' carrying a rating
INSERT INTO assessment_answer (attempt_id, question_id, kind, rating, updated_at)
VALUES ('22222222-2222-2222-2222-222222222221', 'Q3', 'UNKNOWN', 3, NOW(6));

-- [P20] lowercase kind='rating' (probe ai_ci)
INSERT INTO assessment_answer (attempt_id, question_id, kind, rating, updated_at)
VALUES ('22222222-2222-2222-2222-222222222222', 'Q4', 'rating', 4, NOW(6));

-- [P21] legal RATING
INSERT INTO assessment_answer (attempt_id, question_id, kind, rating, updated_at)
VALUES ('22222222-2222-2222-2222-222222222223', 'Q5', 'RATING', 5, NOW(6));

-- ---------- singleton settings probes ----------
-- [P22] id = 'default' (legal)
INSERT INTO typeme_ai_setting (id, enabled, api_key_source, model, prompt_version, daily_limit_per_user,
       retry_limit_per_hour, global_daily_call_budget, global_daily_token_budget, worker_concurrency,
       connect_timeout_ms, request_deadline_ms, max_tokens, mock_mode, updated_at)
VALUES ('default', 0, 'none', 'deepseek-flash', 'p1', 2, 3, 200, 200000, 2, 5000, 90000, 2600, 0, NOW(6));

-- [P23] id = 'other' (must be rejected by ck_ai_setting_singleton)
INSERT INTO typeme_ai_setting (id, enabled, api_key_source, model, prompt_version, daily_limit_per_user,
       retry_limit_per_hour, global_daily_call_budget, global_daily_token_budget, worker_concurrency,
       connect_timeout_ms, request_deadline_ms, max_tokens, mock_mode, updated_at)
VALUES ('other', 0, 'none', 'm', 'p1', 2, 3, 200, 200000, 2, 5000, 90000, 2600, 0, NOW(6));

-- [P24] id = 'DEFAULT' (probe ai_ci widening the singleton constraint)
INSERT INTO typeme_ai_setting (id, enabled, api_key_source, model, prompt_version, daily_limit_per_user,
       retry_limit_per_hour, global_daily_call_budget, global_daily_token_budget, worker_concurrency,
       connect_timeout_ms, request_deadline_ms, max_tokens, mock_mode, updated_at)
VALUES ('DEFAULT', 0, 'none', 'm', 'p1', 2, 3, 200, 200000, 2, 5000, 90000, 2600, 0, NOW(6));

-- [P25] api_key_source='ENV' on the P22 row (uppercase; an earlier version of this probe
--        used a second id, which tripped the singleton CHECK first and proved nothing)
UPDATE typeme_ai_setting SET api_key_source = 'ENV' WHERE id = 'default';

-- [P26] enabled=7 (illegal bit value)
INSERT INTO typeme_ai_setting (id, enabled, api_key_source, model, prompt_version, daily_limit_per_user,
       retry_limit_per_hour, global_daily_call_budget, global_daily_token_budget, worker_concurrency,
       connect_timeout_ms, request_deadline_ms, max_tokens, mock_mode, updated_at)
VALUES ('bit-test', 7, 'none', 'm', 'p1', 2, 3, 200, 200000, 2, 5000, 90000, 2600, 0, NOW(6));

-- ---------- idempotency status probes ----------
-- [P27] status='in_progress' lowercase (probe ai_ci)
INSERT INTO api_idempotency (user_id, operation, idempotency_key, request_hash, status, created_at, expires_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'createReport', 'k1', REPEAT('e',64), 'in_progress', NOW(6), NOW(6));

-- [P28] status='BOGUS'
INSERT INTO api_idempotency (user_id, operation, idempotency_key, request_hash, status, created_at, expires_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'createReport', 'k2', REPEAT('e',64), 'BOGUS', NOW(6), NOW(6));

-- ---------- CHAR_LENGTH / collation direct probes ----------
-- [P29] does CHAR_LENGTH see CHAR(4) padding? is comparison case-insensitive?
SELECT CHAR_LENGTH(CAST('EI' AS CHAR(4))) AS char4_len_ei,
       CHAR_LENGTH(CAST('ISTJ' AS CHAR(4))) AS char4_len_istj,
       CHAR_LENGTH('istj') AS literal_len_istj,
       ('istj' IN ('ISTJ','INTJ')) AS ci_in_list,
       ('ISTJ' IN ('ISTJ','INTJ')) AS cs_in_list,
       ('alice' = 'Alice') AS ci_eq,
       ('alice  ' = 'alice') AS pad_eq;

-- [P30] session collation recheck
SELECT @@character_set_client AS cs_client, @@character_set_connection AS cs_conn,
       @@collation_connection AS coll_conn, DATABASE() AS db;

-- ---------- FK / cascade order behavior ----------
-- [P31] deleting app_user: assessment_attempt has no ON DELETE CASCADE, must block
DELETE FROM app_user WHERE id = '11111111-1111-1111-1111-111111111111';

-- [P32] leftover row counts after all probes
SELECT 'app_user' AS t, COUNT(*) AS n FROM app_user
UNION ALL SELECT 'assessment_report', COUNT(*) FROM assessment_report
UNION ALL SELECT 'assessment_answer', COUNT(*) FROM assessment_answer
UNION ALL SELECT 'typeme_ai_setting', COUNT(*) FROM typeme_ai_setting
UNION ALL SELECT 'api_idempotency', COUNT(*) FROM api_idempotency;

-- ---------- post-fix additions: the case-sensitivity holes, plus V5 deletion job ----------
-- [S1] lowercase 'pending' on account_deletion_job.status (was accepted before the fix)
INSERT INTO account_deletion_job (id, user_id, status, requested_at, attempt_count)
VALUES ('99999999-9999-9999-9999-999999999901', '11111111-1111-1111-1111-111111111111', 'pending', NOW(6), 0);

-- [S2] legal 'PENDING'
INSERT INTO account_deletion_job (id, user_id, status, requested_at, attempt_count)
VALUES ('99999999-9999-9999-9999-999999999902', '11111111-1111-1111-1111-111111111111', 'PENDING', NOW(6), 0);

-- [S3] lowercase 'istj' on report_self_reflection.self_selected_type_code
INSERT INTO report_self_reflection (report_id, user_id, self_selected_type_code, note, updated_at)
VALUES ('44444444-4444-4444-4444-444444444402', '11111111-1111-1111-1111-111111111111', 'istj', NULL, NOW(6));

-- [S4] legal 'ISTJ' on the same table
INSERT INTO report_self_reflection (report_id, user_id, self_selected_type_code, note, updated_at)
VALUES ('44444444-4444-4444-4444-444444444402', '11111111-1111-1111-1111-111111111111', 'ISTJ', NULL, NOW(6));

-- [S5] lowercase api_key_source 'env' must be accepted (it is the canonical value)
UPDATE typeme_ai_setting SET api_key_source = 'env' WHERE id = 'default';

-- [S6] app_user_session has no FK by design: insert a session for a nonexistent user
INSERT INTO app_user_session (session_id, user_id, created_at, last_seen_at, absolute_expires_at)
VALUES ('sess-orphan', '99999999-9999-9999-9999-999999999999', NOW(6), NOW(6), NOW(6));

-- [S7] stale-session cleanup for a nonexistent user must not be blocked by an FK
DELETE FROM app_user_session WHERE session_id = 'sess-orphan';

-- [S8] final numeric recheck of the pinned collations
SELECT table_name, column_name, character_set_name, collation_name, column_type
FROM information_schema.columns
WHERE table_schema = 'typeme_dev'
  AND (table_name, column_name) IN (
      ('app_user','role'),
      ('assessment_answer','kind'),
      ('assessment_report','computed_type_code'),
      ('report_self_reflection','self_selected_type_code'),
      ('api_idempotency','status'),
      ('account_deletion_job','status'),
      ('typeme_ai_setting','id'),
      ('typeme_ai_setting','api_key_source'))
ORDER BY table_name, column_name;

-- [S9] the same columns that were NOT pinned stay ai_ci (deliberate: username uniqueness
--      should stay case-insensitive; hex digests are compared as text)
SELECT table_name, column_name, collation_name
FROM information_schema.columns
WHERE table_schema = 'typeme_dev'
  AND (table_name, column_name) IN (
      ('app_user','username_normalized'),
      ('ai_analysis_job','request_hash'),
      ('assessment_report','report_hash'))
ORDER BY table_name, column_name;
