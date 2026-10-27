-- 注册图形验证码的"已使用令牌"账本：答对即插入 nonce，主键唯一用来挡重放。
-- 只存随机 nonce，不存答案，也不存任何用户信息；过期行由清理任务删除。
CREATE TABLE registration_captcha_used (
    nonce CHAR(32) NOT NULL PRIMARY KEY,
    used_at DATETIME(6) NOT NULL,
    expires_at DATETIME(6) NOT NULL
);
CREATE INDEX idx_captcha_used_expires ON registration_captcha_used(expires_at);
