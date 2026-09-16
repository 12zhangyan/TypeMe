-- V7：给 ai_analysis_job 补一列 user_note（AI 模块）。
--
-- 为什么需要它（契约缺口）：
--   契约 03 §4 要求把用户主动填写的 `note`（≤300 字）作为**独立数据段**发给模型
--   （user payload 的 `userNote`），契约 02 §5.1 的 ai_analysis_job 列清单里却没有任何承载它的列。
--   worker 是**异步、可能跨进程重启**执行的：创建时算出的 request_hash 含 note 的 hash，
--   但 note 正文若不落库，执行时就只能发空字符串 —— 那会让"用户写的话"被静默丢弃，
--   而且"去重键含 note、实际发送不含 note"自相矛盾。
--   因此补一列（V4 已存在且可能已被他人应用，改 V4 会造成 Flyway checksum 冲突，故新增版本）。
--
-- 编号占位说明：V5/V6 属账号模块。若账号模块后续也要 V7，请任一方改名后再提交
--   （本文件目前未被任何库应用，改号无成本）。
--
-- 兼容性：与 V4 同样的限制 —— 不用 ENGINE=/COMMENT=/ON UPDATE，不写 USE / CREATE DATABASE，
--   类型只用 VARCHAR / DATETIME 等 MySQL 与 H2(MODE=MySQL) 都认的写法。
-- 长度 320：契约限 300 字，留出规范化（去首尾空白/换行归一）后的余量，避免静默截断。

ALTER TABLE ai_analysis_job ADD COLUMN user_note VARCHAR(320) NULL;
