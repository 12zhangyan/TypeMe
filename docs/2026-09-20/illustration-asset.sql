-- 公开插画的远端地址（数据库驱动）——**手工交付件，不是 Flyway 迁移**。
--
-- 位置是有意的：它**不在** backend/src/main/resources/db/migration/ 下，
-- 所以既不会打进应用包、也不会在部署时被 Flyway 自动执行；由你在服务器上手工跑一次。
-- 从 GitHub 拉代码构建部署的 jar 不会带上它。
--
-- 生成方式：node scripts/gen-image-publish.mjs --emit-sql --out docs/2026-09-20/illustration-asset.sql
-- 运行时消费：GET /api/v3/platform/illustrations（公开只读，匿名可访问）
-- 运行期修改：PUT /api/v3/platform/illustrations（仅 ADMIN，改地址不必发版）
-- 方案与边界：docs/2026-09-20/图片URL入库方案.md
--
-- 执行方式（服务器上，只跑一次）：
--     mysql -h <主机> -u <用户> -p <库名> < illustration-asset.sql
-- 已经建表或插过数据时不要重复执行：CREATE 加了 IF NOT EXISTS，但 21 条 INSERT 会主键冲突。
-- 想改某一张图的地址请用 PUT 接口，不要改本文件再跑一遍。
--
-- 只放**网站公开插画**（5 张场景图 + 16 张人物图）：不含报告、答卷、账号信息或任何私人文件。
-- url 里带内容哈希，改图 = 换对象键 = 天然无缓存问题；sha256 用于"库 ↔ 本地素材 ↔ 远端对象"
-- 三方核对（scripts/check-remote-images.mjs）。
--
-- COLLATE 钉 as_cs 的理由同 V1/V6：默认的 *_ai_ci 大小写不敏感会让 'home-hero' 与
-- 'HOME-HERO' 变成同一个主键值，白名单校验就白做了。COLLATE 只能写在列定义最末尾
-- （MySQL 与 H2 MySQL 模式的语法交集 —— 后端契约测试也在 H2 上执行本文件）。
CREATE TABLE IF NOT EXISTS illustration_asset (
    asset_name VARCHAR(64)  NOT NULL COLLATE utf8mb4_0900_as_cs,
    url        VARCHAR(512) NOT NULL,
    sha256     CHAR(64)     NOT NULL,
    release    VARCHAR(32)  NOT NULL,
    updated_at DATETIME(6)  NOT NULL,
    CONSTRAINT pk_illustration_asset PRIMARY KEY (asset_name)
);

INSERT INTO illustration_asset (asset_name, url, sha256, release, updated_at) VALUES
    ('assessment-bigfive', 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/assessment-bigfive.e13c9e572c1c.webp', 'e13c9e572c1cf9de336da6594e120c02d4a501e0b987c304dc3840bfc34d1799', '2026-09-20', CURRENT_TIMESTAMP),
    ('assessment-jung', 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/assessment-jung.b364f47f1802.webp', 'b364f47f1802989b0be73abce2dd99fc6ea986380382e12c442ccca85c7029b6', '2026-09-20', CURRENT_TIMESTAMP),
    ('home-hero', 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/home-hero.4583aa734b96.webp', '4583aa734b964aba28f8b5c862e69d81b595e6f6ab25d2bf879b06bf27e54a8d', '2026-09-20', CURRENT_TIMESTAMP),
    ('reflection', 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/reflection.6923255424c0.webp', '6923255424c004f62dea9c6e41e902268cd68705151f8c1f1d6e33d550284fd4', '2026-09-20', CURRENT_TIMESTAMP),
    ('type-enfj', 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/type-enfj.3e54194d48bf.webp', '3e54194d48bf2da657a394d18556cffb5cfec8f9d8975246d6f83170b22d2304', '2026-09-20', CURRENT_TIMESTAMP),
    ('type-enfp', 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/type-enfp.c06b798e47d3.webp', 'c06b798e47d3cabebbfb44628f2c7e90564febd4083952c7a4cbdc5324cd1feb', '2026-09-20', CURRENT_TIMESTAMP),
    ('type-entj', 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/type-entj.a01db804d119.webp', 'a01db804d119684e8188c942453a633654fe47ebbdb1d06570e1eb7b58498069', '2026-09-20', CURRENT_TIMESTAMP),
    ('type-entp', 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/type-entp.1228b4dfe038.webp', '1228b4dfe03871d6f05545d0084b0032bf1a64f98734131ca59d582623cd913b', '2026-09-20', CURRENT_TIMESTAMP),
    ('type-esfj', 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/type-esfj.d9199a6a37e3.webp', 'd9199a6a37e3dfb09faefc57615d746072685649d083dc018b399f8e72fb448c', '2026-09-20', CURRENT_TIMESTAMP),
    ('type-esfp', 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/type-esfp.16016c5e0828.webp', '16016c5e0828f6c6e107dcb2358c35fabf8d0c3452a77de00d14b53e2ecb4152', '2026-09-20', CURRENT_TIMESTAMP),
    ('type-estj', 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/type-estj.a37348063c17.webp', 'a37348063c17c78756dca2846d984d9f644f2edc33b0978d71034d6045ae90d6', '2026-09-20', CURRENT_TIMESTAMP),
    ('type-estp', 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/type-estp.d3b59822d424.webp', 'd3b59822d424d658c04b948160ea4f8a25720329ea09e28396ab649fa4be3402', '2026-09-20', CURRENT_TIMESTAMP),
    ('type-infj', 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/type-infj.9cde37ca45c2.webp', '9cde37ca45c2bc93ac69f9e4e1d67df447def16f86913e36ef1aa6fb2dedd7f7', '2026-09-20', CURRENT_TIMESTAMP),
    ('type-infp', 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/type-infp.6f366d5766eb.webp', '6f366d5766ebc7a9b52b38b12e2add91240c04cc7b4f4e2629a3367543aa7263', '2026-09-20', CURRENT_TIMESTAMP),
    ('type-intj', 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/type-intj.c96c6a363703.webp', 'c96c6a3637037401ee063ed24145793a4f55dcdcc4fa11d5a7d7e77a2aea18da', '2026-09-20', CURRENT_TIMESTAMP),
    ('type-intp', 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/type-intp.0c15455e1bda.webp', '0c15455e1bda8fb5efd7f0249c02b1821882e30c62db3536892d27d842917c3e', '2026-09-20', CURRENT_TIMESTAMP),
    ('type-isfj', 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/type-isfj.7da3a212b9ef.webp', '7da3a212b9efa04cbe041ba1d0694ebf1fdd4bc27054e56b9cbbde798f533d26', '2026-09-20', CURRENT_TIMESTAMP),
    ('type-isfp', 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/type-isfp.22d83e8252d4.webp', '22d83e8252d48818f0dca425e36bd7ef4f61a9a4239e886d1a58fa67d8ea8859', '2026-09-20', CURRENT_TIMESTAMP),
    ('type-istj', 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/type-istj.eee7d23c2768.webp', 'eee7d23c2768ce7496357b7344e411b3acae9ace101c59668afaedb05790c7cf', '2026-09-20', CURRENT_TIMESTAMP),
    ('type-istp', 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/type-istp.a4def3a28f98.webp', 'a4def3a28f98293662c2bd5e1bab2ecd2b07982ceebe922209ca492c399674d2', '2026-09-20', CURRENT_TIMESTAMP),
    ('welcome', 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/welcome.74f652dd3194.webp', '74f652dd3194a091a63d20dae5017006e6327d0d35d5484c239e99ec0b5745cf', '2026-09-20', CURRENT_TIMESTAMP);
