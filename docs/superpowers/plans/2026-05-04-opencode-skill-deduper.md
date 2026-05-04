# opencode-skill-deduper 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将已验证的本地 `skill-deduper` 逻辑整理为可发布到 GitHub 和 npm 的独立 OpenCode 插件包。

**架构：** `src/dedupe.ts` 负责纯函数识别和压缩重复 skill 内容；`src/index.ts` 只负责 OpenCode 插件 hook 绑定和日志输出。测试通过构造 OpenCode/OmO 风格的 message parts 验证行为，不依赖真实模型请求。

**技术栈：** TypeScript、OpenCode plugin API、Vitest、npm package、GitHub Actions。

---

### 任务 1：去重核心

**文件：**
- 创建：`src/dedupe.ts`
- 测试：`src/dedupe.test.ts`

- [x] **步骤 1：编写失败的测试**

覆盖 OmO `## Skill: ...`、OpenCode 原生 `<skill_content name="...">`、slash `<skill-instruction>`、统计日志和非重复保留。

- [x] **步骤 2：运行测试验证失败**

运行：`npm test`

预期：FAIL，缺少 `src/dedupe.ts`。

- [x] **步骤 3：编写最少实现代码**

实现 `dedupeSkillMessages(output)` 和 `logDedupeStats(result)`。

- [ ] **步骤 4：运行测试验证通过**

运行：`npm test`

预期：PASS。

### 任务 2：发布元数据和文档

**文件：**
- 创建：`README.md`
- 创建：`LICENSE`
- 创建：`.gitignore`
- 修改：`package.json`

- [x] **步骤 1：补齐 npm 元数据**

设置包名、导出、脚本、许可证、仓库地址和关键词。

- [x] **步骤 2：编写 README**

说明安装、行为、日志、限制和回退方式。

- [ ] **步骤 3：打包验证**

运行：`npm pack --dry-run`

预期：输出只包含 `dist/`、`README.md`、`LICENSE` 和 `package.json`。

### 任务 3：CI 和发布前验证

**文件：**
- 创建：`.github/workflows/ci.yml`

- [ ] **步骤 1：添加 CI**

在 Node.js 20 上执行 `npm ci`、`npm test`、`npm run typecheck`、`npm run build`。

- [ ] **步骤 2：本地运行验证**

运行：`npm test`、`npm run typecheck`、`npm run build`、`npm pack --dry-run`。

预期：全部 exit 0。

### 任务 4：真实 OpenCode surface QA

**文件：**
- 使用构建产物：`dist/index.js`

- [ ] **步骤 1：本地加载插件**

使用本地 `file:` 或临时 OpenCode 插件配置加载构建产物。

- [ ] **步骤 2：触发重复 skill 加载**

启动 OpenCode 真实会话，让同名 skill 加载两次。

- [ ] **步骤 3：验证日志**

确认日志出现 `[skill-deduper] elided duplicate skill content`。

### 任务 5：GitHub 发布

**文件：**
- Git 仓库：`C:\Users\34404\opencode-skill-deduper`

- [ ] **步骤 1：初始化并提交**

使用 Conventional Commits：`feat: 新增 OpenCode skill 去重插件包`。

- [ ] **步骤 2：创建 GitHub 仓库并推送**

运行：`gh repo create jiwangyihao/opencode-skill-deduper --public --source . --remote origin --push`。

- [ ] **步骤 3：处理 npm 发布阻塞**

如果 `npm whoami` 仍为 `E401 Unauthorized`，停止在 npm 发布前并向用户说明需要登录。
