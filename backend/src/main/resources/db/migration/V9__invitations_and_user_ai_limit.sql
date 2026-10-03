-- Registration invitations are single-use bearer secrets; only SHA-256 is persisted.
ALTER TABLE app_user ADD COLUMN ai_daily_limit INT NULL;
ALTER TABLE app_user ADD CONSTRAINT ck_user_ai_daily_limit CHECK (ai_daily_limit IS NULL OR (ai_daily_limit >= 0 AND ai_daily_limit <= 10000));
CREATE TABLE registration_invitation (
    id CHAR(36) NOT NULL PRIMARY KEY,
    code_hash CHAR(64) NOT NULL UNIQUE,
    created_by CHAR(36) NULL,
    created_at DATETIME(6) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    revoked_at DATETIME(6) NULL,
    used_at DATETIME(6) NULL,
    used_by CHAR(36) NULL,
    CONSTRAINT fk_invite_creator FOREIGN KEY (created_by) REFERENCES app_user(id),
    CONSTRAINT fk_invite_user FOREIGN KEY (used_by) REFERENCES app_user(id)
);
CREATE INDEX idx_invite_created ON registration_invitation(created_at, id);
-- Serializes first-admin initialization across application instances.
CREATE TABLE admin_bootstrap_lock (id INT NOT NULL PRIMARY KEY);
INSERT INTO admin_bootstrap_lock (id) VALUES (1);
