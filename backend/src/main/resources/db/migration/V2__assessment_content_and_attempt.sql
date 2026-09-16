-- V2：内容包快照、测评 attempt 与答案（契约 02 §1、§3）。
--
-- 本文件由账号/会话模块按契约逐列落盘，供导出与注销清理直接按表名操作；
-- attempt/report 的 Java 读写逻辑由并行模块（com.typeme.jung 一侧）落地。

-- 已发布内容包：应用层只 INSERT，同 package_id 已存在即拒绝，绝不 UPDATE（契约 §3.1）。
CREATE TABLE assessment_package (
    package_id             VARCHAR(64) NOT NULL,
    instrument_id          VARCHAR(64) NOT NULL,
    scoring_version        VARCHAR(64) NOT NULL,
    report_content_version VARCHAR(64) NOT NULL,
    content_status         VARCHAR(32) NOT NULL,
    -- 契约写 MEDIUMTEXT；H2 MySQL 模式把它映射成 CLOB，两边都能放下一份完整内容包。
    -- 若日后要换更 "标准" 的 TEXT，注意 MySQL 的 TEXT 上限只有 64KB（内容包远超），会静默截断。
    content_json           MEDIUMTEXT  NOT NULL,
    sha256                 CHAR(64)    NOT NULL,
    published_at           DATETIME(6) NOT NULL,
    CONSTRAINT pk_assessment_package PRIMARY KEY (package_id)
);

CREATE TABLE assessment_attempt (
    id                       CHAR(36)    NOT NULL,
    user_id                  CHAR(36)    NOT NULL,
    package_id               VARCHAR(64) NOT NULL,
    status                   VARCHAR(32) NOT NULL,
    revision                 BIGINT      NOT NULL,
    current_question_id      VARCHAR(16) NULL,
    clarification_dimensions VARCHAR(32) NOT NULL,
    clarification_skipped    TINYINT     NOT NULL,
    base_attempt_id          CHAR(36)    NULL,
    started_at               DATETIME(6) NOT NULL,
    updated_at               DATETIME(6) NOT NULL,
    submitted_at             DATETIME(6) NULL,
    CONSTRAINT pk_assessment_attempt PRIMARY KEY (id),
    CONSTRAINT fk_attempt_user FOREIGN KEY (user_id) REFERENCES app_user (id),
    CONSTRAINT fk_attempt_package FOREIGN KEY (package_id) REFERENCES assessment_package (package_id),
    CONSTRAINT ck_attempt_clarification_skipped CHECK (clarification_skipped IN (0, 1))
);

-- 契约写的是 idx_attempt_user (user_id, updated_at DESC)，意图是"按最近更新倒序列出本人草稿"。
-- 这里只建 (user_id, updated_at)：降序扫描对 MySQL 与 H2 都不是必须的（两者都能反向扫索引），
-- 而 DESC 索引是 MySQL 8 专有语法、8.0.12 之前会被静默忽略，写进迁移脚本反而制造"看起来更优"的假象。
CREATE INDEX idx_attempt_user ON assessment_attempt (user_id, updated_at);
CREATE INDEX idx_attempt_user_status ON assessment_attempt (user_id, status);

CREATE TABLE assessment_answer (
    attempt_id  CHAR(36)    NOT NULL,
    question_id VARCHAR(16) NOT NULL,
    -- 钉 as_cs 的理由同 V1 的 app_user.role：库默认 utf8mb4_0900_ai_ci 大小写不敏感，
    -- 会让下面的白名单放行小写 'rating' / 'unknown'（实测 MySQL 插入成功），
    -- 而应用层恒用大写的 'RATING' / 'UNKNOWN' 做 equals 比较，写进小写会静默走错分支。
    -- COLLATE 只能写在列定义最末尾（两个引擎的语法交集，详见 V1 的注释）。
    kind        VARCHAR(16) NOT NULL COLLATE utf8mb4_0900_as_cs,
    rating      TINYINT     NULL,
    updated_at  DATETIME(6) NOT NULL,
    CONSTRAINT pk_assessment_answer PRIMARY KEY (attempt_id, question_id),
    CONSTRAINT fk_answer_attempt FOREIGN KEY (attempt_id) REFERENCES assessment_attempt (id) ON DELETE CASCADE,
    CONSTRAINT ck_answer_kind CHECK (kind IN ('RATING', 'UNKNOWN')),
    -- 为什么要显式写 rating IS NOT NULL：MySQL（H2 同样）判定 CHECK 时，
    -- 表达式结果为 UNKNOWN 的行是**放行**的。只写 "kind = 'RATING' AND rating BETWEEN 1 AND 5"，
    -- 当 rating 为 NULL 时整个 OR 的结果是 UNKNOWN（不是 FALSE），于是
    -- "kind=RATING 但没填评分"的行能写进库（2026-09-16 实测 mysql 客户端 exit=0、插入成功）。
    -- 补上 IS NOT NULL 之后该行被 ERROR 3819 拒绝。
    CONSTRAINT ck_answer_rating CHECK (kind = 'UNKNOWN' AND rating IS NULL
                                       OR kind = 'RATING' AND rating IS NOT NULL
                                          AND rating BETWEEN 1 AND 5)
);

CREATE INDEX idx_answer_attempt ON assessment_answer (attempt_id);
