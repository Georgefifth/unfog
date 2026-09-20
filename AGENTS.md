# Unfog — BunnieX Hackathon 项目

> 拍一张看不懂的纸 → AI 用大白话讲清楚，告诉你该怎么办。

## 比赛信息

- **赛事**: [BunnieX Hackathon](https://buuniex-hackathon.devpost.com/)（Devpost，开放式 AI 主题，仅限学生，342 人）
- **截止**: 2026-09-22 17:00 IST（= 11:30 UTC）。逾期不收。
- **评判标准**: Innovation —— 创意独特性是唯一明列标准
- **赞助商**: Featherless AI（冠军奖 $300 额度）→ 本项目用它家 API 做全部 LLM/VL 推理
- **提交物**: Devpost 项目页（标题/描述/问题/方案/技术栈/影响）、演示视频或在线 demo、GitHub 仓库链接
- **规则**: 原创、允许开源库和公开 API、须可演示运行

## 产品定位

**Unfog** = confusing paperwork → clarity → action。

用户拍下/上传任何看不懂的文件（医疗账单、罚单、租约条款、拒信、学校表格、银行对账单、截图），或直接粘贴文字，Unfog 返回：

1. **Plain-language summary** — 这东西到底说了什么
2. **Key facts** — 金额、截止日期、当事方（结构化提取）
3. **Red flags** — 坑在哪、要注意什么
4. **Action checklist** — 下一步具体做什么（可勾选）
5. **Action 层** — 一键起草回复信/申诉信、电话沟通脚本（这是和普通摘要器的差异点）
6. **Q&A chat** — 基于文档内容追问
7. **多语言** — 用用户自己的语言解释（移民/留学生场景）

隐私卖点：文档只存在会话内，服务端不落盘。

## 技术栈

- **后端**: Python 3.12 + FastAPI (`server.py`)，SSE 流式输出
- **前端**: 纯静态 HTML/CSS/JS（`static/`），无构建步骤
- **AI**: Featherless AI（OpenAI 兼容 API，`https://api.featherless.ai/v1`）
  - 视觉理解: `Qwen/Qwen3-VL-30B-A3B-Instruct`（主力，快），备用 `Qwen/Qwen2.5-VL-72B-Instruct`
  - 文本(chat/draft): `Qwen/Qwen3-32B`，备用 `deepseek-ai/DeepSeek-R1-Distill-Llama-70B`
- **样品文档**: `scripts/gen_samples.py` 用 Pillow 生成到 `static/samples/`

## Featherless API 注意事项（踩过的坑）

- `FEATHERLESS_API_KEY` 已在环境变量里，不要写进代码/仓库
- **Llama 系模型被 gate**（`model_gated_needs_oauth`），需绑 HF 账号 → 一律用 Qwen/DeepSeek
- **Cloudflare 会拦 Python 默认 UA**（error 1010）：requests/urllib 必须带自定义 `User-Agent`（见 `server.py` 的 `FEATHERLESS_HEADERS`）
- 冷门模型首次调用有 ~30-90s 冷启动；可能返回 `capacity_exhausted` → 实现重试 + 模型降级
- Qwen3 会输出 `<think>...</think>`：给 Qwen3 模型在最后一条 user 消息追加 `/no_think`（`_no_think()`）。**不要给非 Qwen3 模型传 `chat_template_kwargs`**——会触发 `!` token 洪泛
- **上游偶发纯 `!` 洪泛**（token 0 失控）：流式层 `_emit_point` 挂起 `!` 尾巴，纯 flood 时整体降级到下一个模型；非流式 `_strip_think` 同样过滤

## 开发命令

```bash
pip install -r requirements.txt
python3 scripts/gen_samples.py        # 生成示例文档图
python3 server.py                      # http://localhost:8000
```

## 目录结构

```
server.py            # FastAPI 后端 + Featherless 调用 + SSE
prompts.py           # 所有 LLM prompt（分析/chat/起草）
static/index.html    # 单页应用
static/app.js        # 前端逻辑（上传、SSE、渲染、勾选清单）
static/style.css
static/samples/      # 生成的示例文档
scripts/gen_samples.py
requirements.txt
README.md            # Devpost 提交用主文档
```

## 约定

- 代码注释/提交信息用英文；README 用英文（评委看）
- 不提交 secrets；`.env` 在 `.gitignore`
- 优先小而完整的闭环，再加分项（TTS 朗读、ICS 导出、ELI5 模式）

## 当前进度

- [x] 比赛调研 + Featherless API 验证
- [x] 主题确定：Unfog 文书解码器
- [x] 后端 analyze/chat/draft 接口（SSE 流式、模型降级、`!` flood 过滤、UTF-8 编码修复）
- [x] 前端单页（上传→结果卡片→追问/起草，支持拖拽/拍照/粘贴文本/示例图）
- [x] 示例文档生成（4 张 PIL 仿真文书）
- [x] README + git 初始化
- [x] 迭代 2：legitimacy 防骗卡、多文件+PDF(PyMuPDF)、截止倒计时+ICS 导出、🎭 电话彩排 roleplay、localStorage 历史+清单记忆、导出 md 简报、loading 秒表
- [ ] 部署到公网（demo link 加分）或录 3 分钟演示视频
- [ ] Devpost 提交页填写

## 已验证的端到端结果

- 罚单图 → 正确提取金额/截止日/翻倍罚款陷阱，suggested_actions 合理
- 医疗账单 → 识别 facility fee 等条目，chat 能回答 "facility fee 能不能免"
- 涨租通知（中文输出）→ 识别自动续租陷阱，urgency=high
- 拒信 → 返回 appeal_letter 动作（已加入 spec）
- 纯文本粘贴路径 OK
- 已知上游怪癖：输出末尾偶发 `!` token 洪泛 → 已过滤；偶发 `capacity_exhausted` → 重试+降级

## 提交要点（写 Devpost 页面时）

- Problem: 医疗账单/罚单/租约/拒信看不懂 → 错过截止日期、多付钱、放弃申诉；移民/老人/学生最重
- Solution: 拍照→结构化 JSON→大白话+红旗+清单+起草申诉信/电话脚本+追问，12 语言
- Stack: Featherless AI（Qwen3-VL-30B 视觉 + Qwen2.5-72B 文本）、FastAPI、SSE、Vanilla JS
- Innovation 论点: 不只是摘要——action layer 把"看懂"闭环到"搞定"；文档无关+多语言；grounded 引用真实金额/编号
