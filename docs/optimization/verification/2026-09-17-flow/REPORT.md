# 浏览器验收报告 —— 新测主流程（2026-09-17）

- 被验收地址：`http://127.0.0.1:5174`
- 账号：本次生成的**合成账号**（用户名与密码不写入本报告）
- 后端：指向一次性测试库；本轮未触碰 `typeme_dev`
- PASS 34 / FAIL 0 / SKIP 0

## 失败项

- 无

## 跳过项（未验证，不计入通过）

- 无

## 实测数据

- 注册（真实表单提交 → 恢复码出现）耗时 1.6s（PBKDF2 生产档）
- 注册返回的恢复码条数：8（内容不保存、不截图外传）
- 进入答题页后首屏可读文本片段：'跳到主要内容\nTypeMe\n十六型人格参考测评\n暂时离开\n\n人格倾向自测（新测）\n\n一屏一题，选完点「下一题」\n\n主测 0 / 48\n\n第 1 题 / 共 48'
- 本次实际点击作答 47 次（每题选第 1 档），最后一道主测题留到 3b 之后再交
- 作答循环结束时停在 'JP · 生活节奏 行程变化的适应\n\n一个安排做到一半\n\n左边这一侧\n按原样走完，中途不折腾\n\n右边这一侧\n中途想到更好'；按钮文案 '完成主测'；禁用=False
- 刷新前后题卡文案一致：'JP · 生活节奏 行程变化的适应\n\n一个安排做到一半\n\n左边这一侧\n按原样走完，中途不折腾\n\n右边这一侧\n中途想到更好'
- 主测结束时有维度处于边界，服务端安排了补充题；本次按真实路径选择「跳过」。
- 跨账号访问同一 attempt：GET 404 / PATCH 404
- 320px 报告页顶栏高 136px（视口高 568px，占 23.9%）
- 390px 报告页顶栏高 91px（视口高 844px，占 10.8%）
- 1440px 报告页顶栏高 69px（视口高 900px，占 7.7%）

## 截图

- `10-register-filled-390.png`
- `11-register-recovery-390.png`
- `20-assess-390.png`
- `21-assess-later-390.png`
- `30-report-detail-390.png`
- `30-reports-list-390.png`
- `31-reports-1440.png`
- `31-reports-320.png`
- `31-reports-390.png`
- `32-assess-320.png`
- `40-account-390.png`

## 复现方式

```powershell
# 1) 起一个可写测试后端（示例：内存 H2），注意不要指向真实库
cd backend
$env:JAVA_HOME='D:\develop\jdk-21'
$env:SPRING_DATASOURCE_URL='jdbc:h2:mem:typeme_verify;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1'
$env:SPRING_DATASOURCE_DRIVER_CLASS_NAME='org.h2.Driver'; $env:SERVER_PORT='8099'
mvn.cmd org.codehaus.mojo:exec-maven-plugin:3.1.0:java -Dexec.mainClass=com.typeme.TypeMeApplication -Dexec.classpathScope=test
# 2) 起前端 dev server 并指向它
cd ..\frontend; $env:VITE_DEV_API_TARGET='http://127.0.0.1:8099'; npm.cmd run dev -- --host 127.0.0.1 --port 5174
# 3) 跑本脚本
python scripts/browser-verify-jung-flow.py
```
