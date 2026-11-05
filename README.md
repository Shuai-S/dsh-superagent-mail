# dsh-superagent-mail

多邮箱 IMAP/SMTP Source 插件：为 dsh-superagent 引擎新增 `mail` Source kind。
每个配置的邮箱是独立的接收范围与回复路由；白名单发件人的新邮件自动成为工单，
回复经 SMTP 带上 In-Reply-To 回到原邮件串。

## 安装

```sh
# 从 npm 安装
dsh plugin --profile superagent add dsh-superagent-mail

# 或从本地源码安装（开发场景）
dsh plugin --profile superagent add "link:$PWD"
```

安装后重启引擎生效。

## 配置（面板 Settings → 来源 → 邮箱）

邮箱账户 rows：id / name / imapHost / imapPort / smtpHost / smtpPort / user / password(授权码) / folder(默认 INBOX)。
常见服务商：QQ 邮箱 imap.qq.com:993 + smtp.qq.com:465（授权码）；163：imap.163.com:993 + smtp.163.com:465。

Policy：允许的发件人邮箱地址（白名单）。默认空名单 = 不接任何活。

## 行为

- 每邮箱独立 UID 游标（首次配置建立基线，不回放历史邮件）
- 收件人含本邮箱的邮件 = 明确指派（direct）；仅抄送不算
- 同主题邮件归同一线程（Re:/Fwd: 前缀剥离后主题哈希）
- 回复经 SMTP，In-Reply-To/References 指向原邮件
- 附件暂不下载，附件数量记入消息元数据
- 凭据以明文保存在引擎本地配置（SQLite，仅限本机读取），不进入日志与会话记录
