CREATE TABLE IF NOT EXISTS illustration_asset (
    asset_name VARCHAR(64)  NOT NULL COLLATE utf8mb4_0900_as_cs,
    url        VARCHAR(512) NOT NULL,
    sha256     CHAR(64)     NOT NULL,
    release    VARCHAR(32)  NOT NULL,
    updated_at DATETIME(6)  NOT NULL,
    CONSTRAINT pk_illustration_asset PRIMARY KEY (asset_name)
);
