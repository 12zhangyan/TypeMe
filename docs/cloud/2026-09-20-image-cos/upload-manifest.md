# 图片上传清单（发布版本 2026-09-20）

由 `node scripts/gen-image-publish.mjs` 生成，请勿手改。素材来源：`frontend/src/assets/illustrations/`
（已压缩的网页版本，共 21 张、2622284 字节）。

**只包含网站公开插画**：5 张场景图 + 16 张人物图。不含报告、答卷、账号信息或任何私人文件；
脚本按白名单校验，素材目录里出现名单以外的图片会直接报错。

对象键一律为 `illustrations/2026-09-20/<名字>.<内容哈希前 12 位><扩展名>`。
同名文件改了内容就是新对象，因此可以放心长缓存（`public, max-age=31536000, immutable`），
永远不需要刷缓存，也不会出现"旧内容配新页面"。

| 文件名 | 对象键 | SHA-256（前 16 位） | 字节 | Content-Type | Cache-Control |
| --- | --- | --- | ---: | --- | --- |
| `assessment-bigfive.webp` | `illustrations/2026-09-20/assessment-bigfive.e13c9e572c1c.webp` | `e13c9e572c1cf9de…` | 188506 | `image/webp` | `public, max-age=31536000, immutable` |
| `assessment-jung.webp` | `illustrations/2026-09-20/assessment-jung.b364f47f1802.webp` | `b364f47f1802989b…` | 250596 | `image/webp` | `public, max-age=31536000, immutable` |
| `home-hero.webp` | `illustrations/2026-09-20/home-hero.4583aa734b96.webp` | `4583aa734b964aba…` | 236960 | `image/webp` | `public, max-age=31536000, immutable` |
| `reflection.webp` | `illustrations/2026-09-20/reflection.6923255424c0.webp` | `6923255424c004f6…` | 188174 | `image/webp` | `public, max-age=31536000, immutable` |
| `type-enfj.webp` | `illustrations/2026-09-20/type-enfj.3e54194d48bf.webp` | `3e54194d48bf2da6…` | 115146 | `image/webp` | `public, max-age=31536000, immutable` |
| `type-enfp.webp` | `illustrations/2026-09-20/type-enfp.c06b798e47d3.webp` | `c06b798e47d3cabe…` | 82260 | `image/webp` | `public, max-age=31536000, immutable` |
| `type-entj.webp` | `illustrations/2026-09-20/type-entj.a01db804d119.webp` | `a01db804d119684e…` | 127244 | `image/webp` | `public, max-age=31536000, immutable` |
| `type-entp.webp` | `illustrations/2026-09-20/type-entp.1228b4dfe038.webp` | `1228b4dfe03871d6…` | 101030 | `image/webp` | `public, max-age=31536000, immutable` |
| `type-esfj.webp` | `illustrations/2026-09-20/type-esfj.d9199a6a37e3.webp` | `d9199a6a37e3dfb0…` | 102930 | `image/webp` | `public, max-age=31536000, immutable` |
| `type-esfp.webp` | `illustrations/2026-09-20/type-esfp.16016c5e0828.webp` | `16016c5e0828f6c6…` | 77802 | `image/webp` | `public, max-age=31536000, immutable` |
| `type-estj.webp` | `illustrations/2026-09-20/type-estj.a37348063c17.webp` | `a37348063c17c787…` | 118468 | `image/webp` | `public, max-age=31536000, immutable` |
| `type-estp.webp` | `illustrations/2026-09-20/type-estp.d3b59822d424.webp` | `d3b59822d424d658…` | 97648 | `image/webp` | `public, max-age=31536000, immutable` |
| `type-infj.webp` | `illustrations/2026-09-20/type-infj.9cde37ca45c2.webp` | `9cde37ca45c2bc93…` | 78532 | `image/webp` | `public, max-age=31536000, immutable` |
| `type-infp.webp` | `illustrations/2026-09-20/type-infp.6f366d5766eb.webp` | `6f366d5766ebc7a9…` | 96774 | `image/webp` | `public, max-age=31536000, immutable` |
| `type-intj.webp` | `illustrations/2026-09-20/type-intj.c96c6a363703.webp` | `c96c6a3637037401…` | 91190 | `image/webp` | `public, max-age=31536000, immutable` |
| `type-intp.webp` | `illustrations/2026-09-20/type-intp.0c15455e1bda.webp` | `0c15455e1bda8fb5…` | 100022 | `image/webp` | `public, max-age=31536000, immutable` |
| `type-isfj.webp` | `illustrations/2026-09-20/type-isfj.7da3a212b9ef.webp` | `7da3a212b9efa04c…` | 132444 | `image/webp` | `public, max-age=31536000, immutable` |
| `type-isfp.webp` | `illustrations/2026-09-20/type-isfp.22d83e8252d4.webp` | `22d83e8252d48818…` | 68574 | `image/webp` | `public, max-age=31536000, immutable` |
| `type-istj.webp` | `illustrations/2026-09-20/type-istj.eee7d23c2768.webp` | `eee7d23c2768ce74…` | 120152 | `image/webp` | `public, max-age=31536000, immutable` |
| `type-istp.webp` | `illustrations/2026-09-20/type-istp.a4def3a28f98.webp` | `a4def3a28f982936…` | 99104 | `image/webp` | `public, max-age=31536000, immutable` |
| `welcome.webp` | `illustrations/2026-09-20/welcome.74f652dd3194.webp` | `74f652dd3194a091…` | 148728 | `image/webp` | `public, max-age=31536000, immutable` |

完整 SHA-256 与本地路径见同目录 `upload-manifest.json`（上传脚本应以该文件为输入）。
云端方案、最小权限与切换步骤见 `PLAN.md`。
