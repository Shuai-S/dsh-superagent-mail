# dsh-superagent-mail

多邮箱 IMAP/SMTP Source 插件：为 dsh-superagent 引擎新增 `mail` Source kind。
每个配置的邮箱是独立的接收范围与回复路由；白名单发件人的新邮件自动成为工单，
回复经 SMTP 带上 In-Reply-To 回到原邮件串。

## 安装（superagent profile）

```sh
pnpm install && pnpm check
dsh plugin --profile superagent add "link:$PWD"
scripts/dsh-superagent restart   # 在 dsh-superagent-prototype 内
```

## 配置（面板 Settings → 来源 → 邮箱）

邮箱账户 rows：id / name / imapHost / imapPort / smtpHost / smtpPort / user / password(授权码) / folder(默认 INBOX)。
常见服务商：QQ 邮箱 imap.qq.com:993 + smtp.qq.com:465（授权码）；163：imap.163.com:993 + smtp.163.com:465。

Policy：允许的发件人邮箱地址（白名单）。默认空名单 = 不接任何活。

## 行为

- 每邮箱独立 UID 游标（首次配置建立基线，不回放历史邮件）
- 收件人含本邮箱的邮件 = 明确指派（direct）；仅抄送不算
- 同主题邮件归同一线程（Re:/Fwd: 前缀剥离后主题哈希）
- 回复经 SMTP，In-Reply-To/References 指向原邮件
- v1 不下载附件（附件数记入 meta）；凭据 v1 明文存引擎配置，凭据绑定为 v2 升级项
