# TypeMe 插画素材

2026-09-18 已接入用户交付的 21 张生成图，当前使用同名 WebP 网页版本（人物保留透明通道）。原始 PNG 保留在用户桌面，没有修改。人物网页尺寸 640×800，场景按比例缩至最大 1440×1200，总计约 2.62 MB。验收与来源哈希见 [图片验收记录](../../../../docs/optimization/verification/2026-09-18-generated-images/REPORT.md)。

提示词与尺寸说明：[完整生图包](../../../../docs/design/2026-09-18-illustrations/image-generation-prompts.md)。

场景文件：`home-hero.webp`、`assessment-jung.webp`、`assessment-bigfive.webp`、`reflection.webp`、`welcome.webp`。

人物文件：`type-intj.png`、`type-intp.png`、`type-entj.png`、`type-entp.png`、`type-infj.png`、`type-infp.png`、`type-enfj.png`、`type-enfp.png`、`type-istj.png`、`type-isfj.png`、`type-estj.png`、`type-esfj.png`、`type-istp.png`、`type-isfp.png`、`type-estp.png`、`type-esfp.png`。

也接受同名 `.avif`、`.png` 或 `.webp`；同名优先顺序 WebP、AVIF、PNG。仅本目录下这些固定名称会在页面使用。请勿把未经筛选的生成稿、敏感照片或无关素材放到这里。

添加/替换后重新运行前端 `npm.cmd run build`。图片缺失时使用本地 SVG 兜底，不请求不存在的图片；加载失败时同样回退。人物保持真正透明的 4:5 全身构图，场景不用透明。

## 迁到对象存储（图片域名）

2026-09-20 起，插画可以改从对象存储读取，用来降低源站带宽。
接线只在 `frontend/src/design/illustrationAssets.ts` 一处，页面不硬编码远程地址。

1. 改图后运行 `node scripts/gen-image-publish.mjs`，它会扫本目录、算 SHA-256，并更新
   `docs/cloud/2026-09-20-image-cos/upload-manifest.*`（上传清单）。检查是否一致用 `--check`。
2. 上传按该清单执行（`node scripts/cos-upload-images.mjs --plan` 先看计划，`--verify-key` 再验签名，`--execute` 才真传），
   对象键为 `illustrations/<发布版本>/<名字>.<内容哈希>.webp`。当前发布版本 `2026-09-20` 的 21 个对象**已上传**，
   核对用 `node scripts/check-remote-images.mjs`（完全匿名）。当前图片域名是
   `https://yan-public-1407914221.cos.ap-beijing.myqcloud.com`，见 `docs/cloud/2026-09-20-image-cos/PLAN.md`。
3. **把地址写进数据库**（2026-09-20 起地址由库表决定，不再有构建期域名开关）：
   - 生成交付件：`node scripts/gen-image-publish.mjs --emit-sql --out docs/2026-09-20/illustration-asset.sql`
     （已有文件拒绝覆盖：这份文件是交付记录，改地址请用下面的接口）；
   - **它不是 Flyway 迁移**：刻意不放在 `backend/src/main/resources/db/migration/` 下，
     所以部署时不会被自动执行；由人在服务器上跑一次（`mysql ... < illustration-asset.sql`）。
     执行前读接口返回 500（表不存在），页面继续用本目录的本地资源，不会崩。
   - 只想换一张图的地址时，不必发版也不必动 SQL：管理员
     `PUT /api/v3/platform/illustrations`（见 `docs/2026-09-20/图片URL入库方案.md`），下一次加载即生效。
   - 三方核对（库 ↔ 本目录素材 ↔ 远端对象）：`node scripts/check-remote-images.mjs --from-api=<服务地址>`。
4. 本目录的图片**始终随包发布**：它既是地址表里没有这张图时的资源，也是远端加载失败时唯一一次回退的目标。

上传用的密钥只在运维侧，不进前端、不进仓库、不进日志。
