-- 加宽口令/恢复码哈希列。
--
-- 背景（这是一条"实测才发现"的修正，值得写清楚）：
--   PBKDF2 编码后的字符串远远长于"一串 hex"。以 Pbkdf2PasswordEncoder 的默认输出为例，
--   形如 `{pbkdf2}310000$<base64 salt>$<base64 hash>`，也就是
--   "算法前缀 + 迭代次数 + salt + 摘要" 三段拼接，实测长度 266 字符。
--   最初的 VARCHAR(255) 是照着"64 字节摘要 = 128 hex"估的，估错了；
--   于是**任何一次注册都会失败**（H2/MySQL 都是"值超长"报错）。
--
--   为什么当初没在单测里暴露：哈希长度不属于业务逻辑，容易一路"看起来对"到集成测试才炸。
--   这也说明"注册 → 登录"全流程那条用例不是形式主义：没有它，这个错误会拖到手工联调才出现。
--
-- 取 512 而不是 266：给"换算法/换迭代次数导致编码变长"留出余量，
-- 避免将来升级 PasswordEncoder 时又要改一次表结构（迁移是有成本的）。
-- 恢复码用的是同一个 PasswordEncoder，编码长度相同，一起加宽。
--
-- 兼容性：ALTER TABLE ... MODIFY 是 MySQL / H2(MODE=MySQL) 都支持的写法；
-- 不使用 MySQL 专有的 CHANGE COLUMN 或字符集子句。

ALTER TABLE app_user MODIFY COLUMN password_hash VARCHAR(512) NOT NULL;

ALTER TABLE account_recovery_code MODIFY COLUMN code_hash VARCHAR(512) NOT NULL;
