# 数码罗盘 · AI 数码设备推荐助手

前后端分离的数码设备推荐应用。用户可以对话、查询公开网页中的报价和参数、查看评价来源、导入个人知识库并收藏设备页面。

## 功能

- **AI 顾问**：通过 LangChain Agent 连接 DeepSeek、Anthropic Claude 或 OpenAI 模型；对话和工具调用会根据用户账号隔离。
- **实时研究**：Tavily Search 分别检索购买页面、规格资料和评价；结果展示网页来源及查询时间。只把已识别的商家域名标为购买链接。搜索摘要中没有价格时留空，不由模型补造。
- **知识库**：导入 UTF-8/GB18030 的 TXT、Markdown 和 Word DOCX，自动切片并按用户隔离检索。旧版 `.doc` 请先转换为 `.docx`。
- **用户与收藏**：注册、登录、个人会话记录、文档管理、来源页面收藏。

技术栈：React + TypeScript + Vite；FastAPI + LangChain + SQLAlchemy + Pydantic；SQLite。API 文档位于 `/docs`（本地后端地址为 `http://localhost:8000/docs`）。

## Docker 启动

1. 将根目录 `.env.example` 复制为 `.env`，把 `JWT_SECRET` 改成足够长的随机字符串，并填写至少一个模型 API Key。要查询实时价格、参数和评价，还需填写 `TAVILY_API_KEY`。
2. 运行 `docker compose up --build -d`。
3. 打开 `http://localhost:8080`。如需修改端口，在 `.env` 添加 `WEB_PORT=你要使用的端口`。

SQLite 数据保存在 `app_data` Docker 卷中。模型和搜索密钥只传给后端，不进入前端构建。部署到公网时，请在反向代理或平台上配置 HTTPS，并设置 `FRONTEND_ORIGIN` 为实际访问地址。Compose 配置适合单实例；多实例部署应改用 PostgreSQL，并配套数据库迁移。

## 本地开发

需要 Python 3.13+ 与 Node.js 24+。

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
# 编辑 backend/.env 中的密钥
uvicorn app.main:app --reload
```

在另一个终端：

```powershell
cd frontend
npm ci
npm run dev
```

访问 `http://localhost:5173`。Vite 会把 `/api` 转发到本地后端。

## 模型与数据来源

`DEEPSEEK_MODEL`、`ANTHROPIC_MODEL`、`OPENAI_MODEL` 可在环境文件中修改。DeepSeek 使用官方 OpenAI 兼容接口。Claude Code 和 Codex 是客户端工具；本项目对应接入 Anthropic Claude 与 OpenAI API。模型名称及访问权限以你的服务商账号为准。

实时搜索使用 [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)。价格来自检索摘要，可能受地区、活动、登录状态及库存影响；页面提供原始链接以便核对。该项目不绕过购物网站的登录或反爬限制，也不把无来源内容标为“实时报价”。

## 测试与构建

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
cd ..\frontend
npm run build
```

## 上传到平台

项目已经包含 `.gitignore`、Dockerfile、Compose 和 Nginx 配置。首次关联你的远程仓库后可推送：

```powershell
git remote add origin <你的仓库地址>
git push -u origin main
```

不要把 `.env` 或 API Key 提交到仓库；在部署平台配置环境变量。
