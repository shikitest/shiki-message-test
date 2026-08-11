# 手机在线翻译 Worker

这个 Worker 只接受 `POST /translate`，只允许日语与中文互译。DeepL
密钥只存放在 Cloudflare Secret 中，不会进入 GitHub 或浏览器。

## 用 Cloudflare Dashboard 部署

1. 注册或登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2. 打开 **Workers & Pages**，选择 **Create application** → **Create Worker**。
3. 给 Worker 起名，例如 `shiki-message-translation-proxy`，创建后打开
   **Edit code**。
4. 将 `src/index.mjs` 的全部内容复制到编辑器，保存并部署。
5. 打开该 Worker 的 **Settings** → **Variables and Secrets** → **Add**。
6. 类型选择 **Secret**，名称填写 `DEEPL_API_KEY`，值填写你在 DeepL API
   账户中取得的密钥，然后选择 **Deploy**。不要把密钥写进普通 Variable。
7. 在同一设置区域添加以下普通 Variables：
   - `ALLOWED_ORIGINS`：
     `https://shikikii.github.io,http://localhost:8000,http://127.0.0.1:8000`
   - `DEEPL_API_PLAN`：DeepL API Free 填 `free`；以后换 Pro 才填 `pro`
   - `RATE_LIMIT_MAX`：填 `30`
8. 回到 Worker 概览，复制 `https://...workers.dev` 地址，并在末尾加
   `/translate`。
9. 打开项目的 `js/translation/translation-config.js`，把这个完整地址填入
   `translationProxyUrl`。这个 URL 可以公开；DeepL key 不可以公开。

## 可选：用 Wrangler 部署

`wrangler.jsonc` 是配置模板。进入本目录后先设置 secret，再部署：

```text
npx wrangler secret put DEEPL_API_KEY
npx wrangler deploy
```

命令会提示你输入密钥；不要把真实密钥写进任何文件。

## 安全说明

- CORS 是明确白名单，不使用 `*`。
- 每条消息最多 1,500 个 Unicode 字符。
- 只允许 `ja→zh` 和 `zh→ja`。
- 默认每个来源/IP 每分钟最多 30 次；这是单个 Worker isolate 内的轻量保护。
- 正式公开使用前，建议再配置 Cloudflare Rate Limiting binding 或 WAF Rate
  Limiting rule，获得跨 isolate 的更强保护。
- Worker 不接收聊天历史、sender、角色、conversation ID 或 RandomIME 日志。

DeepL API Free 使用 `api-free.deepl.com`；将 `DEEPL_API_PLAN` 改为 `pro`
后才会使用 Pro endpoint。
