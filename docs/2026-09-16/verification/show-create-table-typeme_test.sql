===== account_deletion_job =====
*************************** 1. row ***************************
       Table: account_deletion_job
Create Table: CREATE TABLE `account_deletion_job` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
  `requested_at` datetime(6) NOT NULL,
  `completed_at` datetime(6) DEFAULT NULL,
  `attempt_count` int NOT NULL,
  `last_error_code` varchar(32) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_deletion_job_user` (`user_id`),
  KEY `idx_deletion_job_pending` (`status`,`requested_at`),
  CONSTRAINT `ck_deletion_job_status` CHECK ((`status` in (_utf8mb4'PENDING',_utf8mb4'RUNNING',_utf8mb4'DONE',_utf8mb4'FAILED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci

===== account_recovery_code =====
*************************** 1. row ***************************
       Table: account_recovery_code
Create Table: CREATE TABLE `account_recovery_code` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `code_hash` varchar(512) NOT NULL,
  `code_index` int NOT NULL,
  `used_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `revoked_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_recovery_user` (`user_id`,`used_at`),
  CONSTRAINT `fk_recovery_user` FOREIGN KEY (`user_id`) REFERENCES `app_user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci

===== ai_analysis_job =====
*************************** 1. row ***************************
       Table: ai_analysis_job
Create Table: CREATE TABLE `ai_analysis_job` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `report_id` char(36) NOT NULL,
  `idempotency_key` varchar(80) NOT NULL,
  `request_hash` char(64) NOT NULL,
  `prompt_version` varchar(32) NOT NULL,
  `topic` varchar(32) NOT NULL,
  `model_requested` varchar(64) NOT NULL,
  `model_returned` varchar(64) DEFAULT NULL,
  `status` varchar(16) NOT NULL,
  `attempt_count` int NOT NULL DEFAULT '0',
  `lease_until` datetime(6) DEFAULT NULL,
  `lease_owner` varchar(64) DEFAULT NULL,
  `next_run_at` datetime(6) DEFAULT NULL,
  `requested_at` datetime(6) DEFAULT NULL,
  `response_json` mediumtext,
  `usage_json` varchar(500) DEFAULT NULL,
  `error_code` varchar(32) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `finished_at` datetime(6) DEFAULT NULL,
  `user_note` varchar(320) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ai_job_idem` (`user_id`,`idempotency_key`),
  UNIQUE KEY `uk_ai_job_request` (`user_id`,`request_hash`),
  KEY `fk_ai_job_report` (`report_id`),
  KEY `idx_ai_job_pending` (`status`,`next_run_at`),
  CONSTRAINT `fk_ai_job_report` FOREIGN KEY (`report_id`) REFERENCES `assessment_report` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ai_job_user` FOREIGN KEY (`user_id`) REFERENCES `app_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci

===== ai_consent =====
*************************** 1. row ***************************
       Table: ai_consent
Create Table: CREATE TABLE `ai_consent` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `job_id` char(36) NOT NULL,
  `policy_version` varchar(32) NOT NULL,
  `scope` varchar(500) NOT NULL,
  `evidence_ids` varchar(500) NOT NULL,
  `confirmed_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ai_consent_job` (`job_id`),
  CONSTRAINT `fk_ai_consent_job` FOREIGN KEY (`job_id`) REFERENCES `ai_analysis_job` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci

===== ai_usage_budget =====
*************************** 1. row ***************************
       Table: ai_usage_budget
Create Table: CREATE TABLE `ai_usage_budget` (
  `scope_key` varchar(64) NOT NULL,
  `budget_date` date NOT NULL,
  `reserved_calls` int NOT NULL DEFAULT '0',
  `actual_calls` int NOT NULL DEFAULT '0',
  `actual_tokens` bigint NOT NULL DEFAULT '0',
  `estimated_cost_micros` bigint NOT NULL DEFAULT '0',
  `revision` bigint NOT NULL DEFAULT '0',
  PRIMARY KEY (`scope_key`,`budget_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci

===== api_idempotency =====
*************************** 1. row ***************************
       Table: api_idempotency
Create Table: CREATE TABLE `api_idempotency` (
  `user_id` char(36) NOT NULL,
  `operation` varchar(48) NOT NULL,
  `idempotency_key` varchar(80) NOT NULL,
  `request_hash` char(64) NOT NULL,
  `response_ref` varchar(64) DEFAULT NULL,
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `expires_at` datetime(6) NOT NULL,
  PRIMARY KEY (`user_id`,`operation`,`idempotency_key`),
  KEY `idx_idempotency_expires` (`expires_at`),
  CONSTRAINT `ck_idempotency_status` CHECK ((`status` in (_utf8mb4'IN_PROGRESS',_utf8mb4'COMPLETED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci

===== app_user =====
*************************** 1. row ***************************
       Table: app_user
Create Table: CREATE TABLE `app_user` (
  `id` char(36) NOT NULL,
  `username_normalized` varchar(64) NOT NULL,
  `username_display` varchar(64) NOT NULL,
  `password_hash` varchar(512) NOT NULL,
  `nickname` varchar(64) DEFAULT NULL,
  `status` varchar(16) NOT NULL,
  `role` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL DEFAULT 'USER',
  `created_at` datetime(6) NOT NULL,
  `password_changed_at` datetime(6) NOT NULL,
  `recovery_code_version` int NOT NULL,
  `deletion_requested_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_app_user_username` (`username_normalized`),
  CONSTRAINT `ck_app_user_role` CHECK ((`role` in (_utf8mb4'USER',_utf8mb4'ADMIN')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci

===== app_user_session =====
*************************** 1. row ***************************
       Table: app_user_session
Create Table: CREATE TABLE `app_user_session` (
  `session_id` varchar(64) NOT NULL,
  `user_id` char(36) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `last_seen_at` datetime(6) NOT NULL,
  `absolute_expires_at` datetime(6) NOT NULL,
  PRIMARY KEY (`session_id`),
  KEY `idx_session_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci

===== assessment_answer =====
*************************** 1. row ***************************
       Table: assessment_answer
Create Table: CREATE TABLE `assessment_answer` (
  `attempt_id` char(36) NOT NULL,
  `question_id` varchar(16) NOT NULL,
  `kind` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
  `rating` tinyint DEFAULT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`attempt_id`,`question_id`),
  KEY `idx_answer_attempt` (`attempt_id`),
  CONSTRAINT `fk_answer_attempt` FOREIGN KEY (`attempt_id`) REFERENCES `assessment_attempt` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ck_answer_kind` CHECK ((`kind` in (_utf8mb4'RATING',_utf8mb4'UNKNOWN'))),
  CONSTRAINT `ck_answer_rating` CHECK ((((`kind` = _utf8mb4'UNKNOWN') and (`rating` is null)) or ((`kind` = _utf8mb4'RATING') and (`rating` is not null) and (`rating` between 1 and 5))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci

===== assessment_attempt =====
*************************** 1. row ***************************
       Table: assessment_attempt
Create Table: CREATE TABLE `assessment_attempt` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `package_id` varchar(64) NOT NULL,
  `status` varchar(32) NOT NULL,
  `revision` bigint NOT NULL,
  `current_question_id` varchar(16) DEFAULT NULL,
  `clarification_dimensions` varchar(32) NOT NULL,
  `clarification_skipped` tinyint NOT NULL,
  `base_attempt_id` char(36) DEFAULT NULL,
  `started_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `submitted_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_attempt_package` (`package_id`),
  KEY `idx_attempt_user` (`user_id`,`updated_at`),
  KEY `idx_attempt_user_status` (`user_id`,`status`),
  CONSTRAINT `fk_attempt_package` FOREIGN KEY (`package_id`) REFERENCES `assessment_package` (`package_id`),
  CONSTRAINT `fk_attempt_user` FOREIGN KEY (`user_id`) REFERENCES `app_user` (`id`),
  CONSTRAINT `ck_attempt_clarification_skipped` CHECK ((`clarification_skipped` in (0,1)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci

===== assessment_package =====
*************************** 1. row ***************************
       Table: assessment_package
Create Table: CREATE TABLE `assessment_package` (
  `package_id` varchar(64) NOT NULL,
  `instrument_id` varchar(64) NOT NULL,
  `scoring_version` varchar(64) NOT NULL,
  `report_content_version` varchar(64) NOT NULL,
  `content_status` varchar(32) NOT NULL,
  `content_json` mediumtext NOT NULL,
  `sha256` char(64) NOT NULL,
  `published_at` datetime(6) NOT NULL,
  PRIMARY KEY (`package_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci

===== assessment_report =====
*************************** 1. row ***************************
       Table: assessment_report
Create Table: CREATE TABLE `assessment_report` (
  `id` char(36) NOT NULL,
  `attempt_id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `status` varchar(16) NOT NULL,
  `computed_type_code` char(4) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs DEFAULT NULL,
  `score_json` mediumtext NOT NULL,
  `report_json` mediumtext NOT NULL,
  `report_hash` char(64) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_report_attempt` (`attempt_id`),
  KEY `idx_report_user` (`user_id`,`created_at`),
  CONSTRAINT `fk_report_attempt` FOREIGN KEY (`attempt_id`) REFERENCES `assessment_attempt` (`id`),
  CONSTRAINT `fk_report_user` FOREIGN KEY (`user_id`) REFERENCES `app_user` (`id`),
  CONSTRAINT `ck_report_type_code` CHECK (((`computed_type_code` is null) or ((char_length(`computed_type_code`) = 4) and (`computed_type_code` in (_utf8mb4'ISTJ',_utf8mb4'ISFJ',_utf8mb4'INFJ',_utf8mb4'INTJ',_utf8mb4'ISTP',_utf8mb4'ISFP',_utf8mb4'INFP',_utf8mb4'INTP',_utf8mb4'ESTP',_utf8mb4'ESFP',_utf8mb4'ENFP',_utf8mb4'ENTP',_utf8mb4'ESTJ',_utf8mb4'ESFJ',_utf8mb4'ENFJ',_utf8mb4'ENTJ')))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci

===== rate_limit_bucket =====
*************************** 1. row ***************************
       Table: rate_limit_bucket
Create Table: CREATE TABLE `rate_limit_bucket` (
  `bucket_key` varchar(160) NOT NULL,
  `window_start` datetime(6) NOT NULL,
  `counter` int NOT NULL,
  `revision` bigint NOT NULL,
  PRIMARY KEY (`bucket_key`),
  KEY `idx_rate_limit_window` (`window_start`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci

===== report_self_reflection =====
*************************** 1. row ***************************
       Table: report_self_reflection
Create Table: CREATE TABLE `report_self_reflection` (
  `report_id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `self_selected_type_code` char(4) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs DEFAULT NULL,
  `note` varchar(500) DEFAULT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`report_id`),
  UNIQUE KEY `uk_self_reflection` (`report_id`,`user_id`),
  KEY `fk_reflection_user` (`user_id`),
  CONSTRAINT `fk_reflection_report` FOREIGN KEY (`report_id`) REFERENCES `assessment_report` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_reflection_user` FOREIGN KEY (`user_id`) REFERENCES `app_user` (`id`),
  CONSTRAINT `ck_reflection_type_code` CHECK (((`self_selected_type_code` is null) or ((char_length(`self_selected_type_code`) = 4) and (`self_selected_type_code` in (_utf8mb4'ISTJ',_utf8mb4'ISFJ',_utf8mb4'INFJ',_utf8mb4'INTJ',_utf8mb4'ISTP',_utf8mb4'ISFP',_utf8mb4'INFP',_utf8mb4'INTP',_utf8mb4'ESTP',_utf8mb4'ESFP',_utf8mb4'ENFP',_utf8mb4'ENTP',_utf8mb4'ESTJ',_utf8mb4'ESFJ',_utf8mb4'ENFJ',_utf8mb4'ENTJ')))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci

===== typeme_ai_setting =====
*************************** 1. row ***************************
       Table: typeme_ai_setting
Create Table: CREATE TABLE `typeme_ai_setting` (
  `id` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
  `enabled` tinyint NOT NULL,
  `base_url` varchar(255) DEFAULT NULL,
  `api_key_encrypted` varchar(1024) DEFAULT NULL,
  `api_key_fingerprint` char(8) DEFAULT NULL,
  `api_key_source` varchar(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
  `model` varchar(64) NOT NULL,
  `prompt_version` varchar(32) NOT NULL,
  `daily_limit_per_user` int NOT NULL,
  `retry_limit_per_hour` int NOT NULL,
  `global_daily_call_budget` int NOT NULL,
  `global_daily_token_budget` bigint NOT NULL,
  `worker_concurrency` int NOT NULL,
  `connect_timeout_ms` int NOT NULL,
  `request_deadline_ms` int NOT NULL,
  `max_tokens` int NOT NULL,
  `mock_mode` tinyint NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `updated_by` char(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `ck_ai_setting_enabled` CHECK ((`enabled` in (0,1))),
  CONSTRAINT `ck_ai_setting_mock` CHECK ((`mock_mode` in (0,1))),
  CONSTRAINT `ck_ai_setting_singleton` CHECK ((`id` = _utf8mb4'default')),
  CONSTRAINT `ck_ai_setting_source` CHECK ((`api_key_source` in (_utf8mb4'db',_utf8mb4'env',_utf8mb4'none')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci

