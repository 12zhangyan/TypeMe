-- V3：报告与自我理解（契约 02 §1、§4）。

CREATE TABLE assessment_report (
    id                 CHAR(36)    NOT NULL,
    attempt_id         CHAR(36)    NOT NULL,
    user_id            CHAR(36)    NOT NULL,
    status             VARCHAR(16) NOT NULL,
    -- 钉 as_cs 的理由同 V1 的 app_user.role：默认 utf8mb4_0900_ai_ci 大小写不敏感，
    -- 会让下面的白名单放行小写 'istj'（2026-09-16 实测 MySQL 插入成功，且 CHAR_LENGTH 也是 4）。
    -- COLLATE 只能写在列定义最末尾（两个引擎的语法交集，详见 V1 的注释）。
    computed_type_code CHAR(4)     NULL COLLATE utf8mb4_0900_as_cs,
    score_json         MEDIUMTEXT  NOT NULL,
    report_json        MEDIUMTEXT  NOT NULL,
    report_hash        CHAR(64)    NOT NULL,
    created_at         DATETIME(6) NOT NULL,
    CONSTRAINT pk_assessment_report PRIMARY KEY (id),
    -- UNIQUE(attempt_id)：重复提交只产生一份报告（幂等靠数据库兜底，不靠应用层判断）。
    CONSTRAINT uk_report_attempt UNIQUE (attempt_id),
    CONSTRAINT fk_report_attempt FOREIGN KEY (attempt_id) REFERENCES assessment_attempt (id),
    CONSTRAINT fk_report_user FOREIGN KEY (user_id) REFERENCES app_user (id),
    -- 类型码格式钉在数据库里：TIED 必须为 NULL，其余必须形如 ^[EI][SN][TF][JP]$。
    --
    -- 契约写的是 MySQL 的 REGEXP，但 H2 没有 REGEXP 谓词、也不支持 LIKE 的 '[EI]' 字符类，
    -- 所以这里用可移植的等价写法：先钉长度 4，再从 16 个合法组合里取值。
    --
    -- 关于 CHAR_LENGTH 这一半（2026-09-16 实测后修正注释）：MySQL 取回 CHAR(4) 列时会剥掉补位空格，
    -- CHAR_LENGTH(CAST('EI' AS CHAR(4))) 实测为 2，所以它挡不住 'EI ' 这类脏值的说法不成立；
    -- 真正挡住 'EI' / 'XXXX' 的是 IN 白名单（实测两者都是 ERROR 3819）。
    -- 保留长度判断是因为 H2 的 CHAR 语义与 MySQL 不同、且它零成本、不会误伤 16 个合法值。
    CONSTRAINT ck_report_type_code CHECK (
        computed_type_code IS NULL OR (
            CHAR_LENGTH(computed_type_code) = 4
            AND computed_type_code IN (
                'ISTJ', 'ISFJ', 'INFJ', 'INTJ', 'ISTP', 'ISFP', 'INFP', 'INTP',
                'ESTP', 'ESFP', 'ENFP', 'ENTP', 'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ'
            )
        )
    )
);

-- 同 V2 的说明：契约的 (user_id, created_at DESC) 写成升序，两种引擎都能反向扫索引。
CREATE INDEX idx_report_user ON assessment_report (user_id, created_at);

CREATE TABLE report_self_reflection (
    report_id              CHAR(36)    NOT NULL,
    user_id                CHAR(36)    NOT NULL,
    -- 同 assessment_report.computed_type_code：钉 as_cs，否则白名单放行小写 'istj'。
    self_selected_type_code CHAR(4)    NULL COLLATE utf8mb4_0900_as_cs,
    note                   VARCHAR(500) NULL,
    updated_at             DATETIME(6) NOT NULL,
    CONSTRAINT pk_report_self_reflection PRIMARY KEY (report_id),
    CONSTRAINT uk_self_reflection UNIQUE (report_id, user_id),
    CONSTRAINT fk_reflection_report FOREIGN KEY (report_id) REFERENCES assessment_report (id) ON DELETE CASCADE,
    CONSTRAINT fk_reflection_user FOREIGN KEY (user_id) REFERENCES app_user (id),
    CONSTRAINT ck_reflection_type_code CHECK (
        self_selected_type_code IS NULL OR (
            CHAR_LENGTH(self_selected_type_code) = 4
            AND self_selected_type_code IN (
                'ISTJ', 'ISFJ', 'INFJ', 'INTJ', 'ISTP', 'ISFP', 'INFP', 'INTP',
                'ESTP', 'ESFP', 'ENFP', 'ENTP', 'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ'
            )
        )
    )
);
