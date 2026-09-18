# TypeMe 插画素材

2026-09-18 已接入用户交付的 21 张生成图，当前使用同名 WebP 网页版本（人物保留透明通道）。原始 PNG 保留在用户桌面，没有修改。人物网页尺寸 640×800，场景按比例缩至最大 1440×1200，总计约 2.62 MB。验收与来源哈希见 [图片验收记录](../../../../docs/optimization/verification/2026-09-18-generated-images/REPORT.md)。

提示词与尺寸说明：[完整生图包](../../../../docs/design/2026-09-18-illustrations/image-generation-prompts.md)。

场景文件：`home-hero.webp`、`assessment-jung.webp`、`assessment-bigfive.webp`、`reflection.webp`、`welcome.webp`。

人物文件：`type-intj.png`、`type-intp.png`、`type-entj.png`、`type-entp.png`、`type-infj.png`、`type-infp.png`、`type-enfj.png`、`type-enfp.png`、`type-istj.png`、`type-isfj.png`、`type-estj.png`、`type-esfj.png`、`type-istp.png`、`type-isfp.png`、`type-estp.png`、`type-esfp.png`。

也接受同名 `.avif`、`.png` 或 `.webp`；同名优先顺序 WebP、AVIF、PNG。仅本目录下这些固定名称会在页面使用。请勿把未经筛选的生成稿、敏感照片或无关素材放到这里。

添加/替换后重新运行前端 `npm.cmd run build`。图片缺失时使用本地 SVG 兜底，不请求不存在的图片；加载失败时同样回退。人物保持真正透明的 4:5 全身构图，场景不用透明。
