# OpenCode Skill Deduper

[![npm version](https://img.shields.io/npm/v/opencode-skill-deduper.svg)](https://www.npmjs.com/package/opencode-skill-deduper)
[![npm downloads](https://img.shields.io/npm/dw/opencode-skill-deduper.svg)](https://www.npmjs.com/package/opencode-skill-deduper)
[![License: MPL-2.0](https://img.shields.io/badge/License-MPL--2.0-brightgreen.svg)](LICENSE)

> **Latest in v0.1.2 | v0.1.2 最近更新**
>
> - Moves dedupe statistics off stdout and into OpenCode app log | 将压缩统计从 stdout 迁移到 OpenCode app log
> - Shows a TUI notifier summary without appending session messages | 通过 TUI notifier 显示摘要，且不追加 session 消息
> - Adds regression coverage for stdout-free app log and notifier behavior | 新增无 stdout、app log 与 notifier 行为回归测试

[中文](#中文) | [English](#english)

---

<a name="中文"></a>

## 中文

在 **OpenCode** 中自动压缩重复加载的 **skill** 正文。同一个 skill 多次进入上下文时，插件会在发送模型请求前保留最新完整副本，并把更早的重复副本替换成短提示，减少长会话里的上下文浪费。

它只作用于 OpenCode 的 `experimental.chat.messages.transform` 请求转换阶段：不会改写本地 session 历史，也不会删除最新的 skill 指令。

## 功能一览

- **保留最新副本** — 每个 skill 只保留最新一次完整内容
- **压缩旧副本** — 旧的重复 skill 正文会被替换成短占位文本
- **兼容原生 OpenCode** — 支持 `<skill_content name="...">` 形式的 skill 输出
- **兼容 OmO / Oh My OpenCode** — 支持 `## Skill: ...` 形式的 skill 输出
- **兼容 slash 注入** — 当 `<skill-instruction>` 内容中包含 skill 路径时，也能识别对应 skill 名
- **可观察记录** — 真的压缩内容时通过 OpenCode app log 与 TUI notifier 记录压缩次数和节省字符数；不会写入 stdout，也不会追加 session 消息

---

## 安装

<details open>
<summary><b>面向人类用户</b></summary>

**选项 A：让 LLM 帮你安装**

把下面这段话丢给任意 LLM（OpenCode / Claude Code / Cursor 等）：

```text
请先查看 opencode-skill-deduper 最新 GitHub Release 正文里的“升级方式”，然后严格执行其中带明确版本号的安装/升级命令。默认应使用带 `-g/--global` 的全局命令来更新你平时实际在用的 OpenCode 实例；只有你明确想改当前项目目录下的 `.opencode` 时，才省略 `-g`。不要手动编辑 OpenCode 配置，也不要使用裸包名或 latest。参考说明：https://github.com/jiwangyihao/opencode-skill-deduper/releases/latest
```

**选项 B：手动安装**

1. **先查看最新 GitHub Release** 的 `## 升级方式` 小节。

2. **执行其中带明确版本号的全局命令**。例如当前版本是：

   ```bash
   opencode plugin opencode-skill-deduper@0.1.2 --force -g
   ```

3. **如果你是刻意只想改当前项目目录下的 `.opencode`**，才使用不带 `-g` 的局部命令；否则默认不要省略 `-g`。

4. **如果升级后看起来仍然没有变化**，先清理 OpenCode 插件缓存，再重新执行同一条带版本号命令。

   ```bash
   rm -rf ~/.cache/opencode/packages/opencode-skill-deduper@*
   ```

5. **如果 OpenCode 已在运行，重启后再验证**。

</details>

<details>
<summary><b>面向 LLM 智能体</b></summary>

### 步骤指引

1. 先读取本仓库**最新 GitHub Release 正文**，提取其中 `## 升级方式` 给出的**带明确版本号**命令。

2. 直接执行那条命令。默认应使用带 `-g/--global` 的全局命令来更新用户平时实际在用的 OpenCode 实例；如果用户明确只想改当前项目目录下的 `.opencode`，才省略 `-g`。例如当前版本：

   ```bash
   opencode plugin opencode-skill-deduper@0.1.2 --force -g
   ```

3. 不要手动编辑 OpenCode 配置来安装或升级这个插件，也不要使用裸包名或 `latest`。

4. 如果执行后版本看起来仍然没更新，先清理 OpenCode 插件缓存，再重新执行同一条带版本号命令：

   ```bash
   rm -rf ~/.cache/opencode/packages/opencode-skill-deduper@*
   ```

5. 如果 OpenCode 已在运行，重启后再验证。

### 验证

加载同一个长 skill 两次后，OpenCode app log 中应出现类似记录：

```json
{
  "service": "skill-deduper",
  "level": "info",
  "message": "elided duplicate skill content",
  "extra": {
    "elided": 1,
    "savedChars": 4099,
    "skills": [{ "name": "using-superpowers", "elided": 1, "savedChars": 4099 }]
  }
}
```

同时，TUI notifier 会显示一条不进入 session 消息历史的通知，文本类似：

```text
[skill-deduper] Elided duplicate skill content before this request.

Elided blocks: 1
Saved characters: 4099
Skills:
- using-superpowers: 1 elided, 4099 chars saved
```

> **说明**：最新 OpenCode 当前不会总是主动刷新已缓存的 npm 插件。安装或升级时优先以最新 GitHub Release 正文里的 `## 升级方式` 为准；默认应走带 `-g` 的全局命令，只有明确想改当前项目 `.opencode` 时才省略 `-g`。

</details>

---

## 使用方式

安装后无需额外命令。插件会在 OpenCode 发起模型请求前检查消息内容：

```text
Message 1: full using-superpowers skill content
Message 2: full using-superpowers skill content
```

转换后：

```text
Message 1: [skill-deduper] Skill using-superpowers was reloaded later; older copy elided (... chars).
Message 2: full using-superpowers skill content
```

最新副本仍保持完整，所以模型仍能看到当前有效的 skill 指令。

## 适合谁使用

- 经常在同一个 OpenCode 会话里重复加载 Superpowers、OmO skills 或其他长 skill 的用户
- 经常使用 slash command、原生 `skill` 工具或多代理工作流的用户
- 希望减少重复 skill 正文挤占上下文窗口的用户

## 注意事项

- 插件只识别以明确 skill 标记或 skill 路径开头的内容，不会压缩任意重复文本。
- 用户粘贴的对话转录或任务说明即使包含 slash command、`## Skill:` 等字样，也会按普通用户内容保留。
- 插件只影响发往模型的请求，不改写 OpenCode 存储的 session 历史。
- OpenCode 的 `experimental.chat.messages.transform` hook 仍是实验接口，后续 OpenCode 版本可能调整插件 API。

---

<a name="english"></a>

## English

Automatically elide repeated **skill** bodies in **OpenCode**. When the same skill appears more than once in the request context, this plugin keeps the newest full copy and replaces older copies with a compact marker before the model request is sent.

It only runs in OpenCode's `experimental.chat.messages.transform` phase. It does not rewrite stored session history and does not remove the newest skill instructions.

## What You Get

- **Newest copy kept** — each skill keeps its latest full body
- **Older copies elided** — repeated earlier skill bodies become compact placeholders
- **Native OpenCode support** — recognizes `<skill_content name="...">` skill output
- **OmO / Oh My OpenCode support** — recognizes `## Skill: ...` skill output
- **Slash-injected support** — recognizes `<skill-instruction>` blocks when the skill path exposes the skill name
- **Observable records** — records elided duplicate counts and saved characters through OpenCode app log and the TUI notifier without writing to stdout or appending session messages

---

## Installation

<details open>
<summary><b>For Humans</b></summary>

**Option A: Let an LLM do it**

Paste this into any LLM agent (OpenCode, Claude Code, Cursor, etc.):

```text
First read the latest GitHub Release for opencode-skill-deduper and execute the exact versioned install/upgrade command from its "Upgrade / 升级方式" section. By default, use the global command with `-g/--global` so you update the OpenCode instances you actually run; omit `-g` only if you intentionally want to change the current project's `.opencode`. Do not manually edit the OpenCode config, and do not use a bare package name or latest. Reference: https://github.com/jiwangyihao/opencode-skill-deduper/releases/latest
```

**Option B: Manual setup**

1. **Read the latest GitHub Release** and look for the `## Upgrade` section.

2. **Run the exact versioned global command** from that section. For the current version, the command is:

   ```bash
   opencode plugin opencode-skill-deduper@0.1.2 --force -g
   ```

3. **Only omit `-g` if you intentionally want to update the current project's `.opencode` instead of the global OpenCode config.**

4. **If an upgrade still looks stale**, clear the OpenCode plugin cache and rerun the same versioned command:

   ```bash
   rm -rf ~/.cache/opencode/packages/opencode-skill-deduper@*
   ```

5. **If OpenCode is already running, restart it before verification**.

</details>

<details>
<summary><b>For LLM Agents</b></summary>

### Step-by-Step Instructions

1. Read the **latest GitHub Release body** for this repository and extract the exact versioned command from `## Upgrade / 升级方式`.

2. Execute that command directly. By default, use the global command with `-g/--global`; only omit `-g` if you intentionally want to update the current project's `.opencode`. For the current version:

   ```bash
   opencode plugin opencode-skill-deduper@0.1.2 --force -g
   ```

3. Do not install or upgrade this plugin by hand-editing the OpenCode config, and do not use a bare package name or `latest`.

4. If the installed version still does not change, clear the OpenCode plugin cache and rerun the same versioned command:

   ```bash
   rm -rf ~/.cache/opencode/packages/opencode-skill-deduper@*
   ```

5. If OpenCode is already running, restart it before verification.

### Verification

After loading the same long skill twice, OpenCode app log should include a record similar to:

```json
{
  "service": "skill-deduper",
  "level": "info",
  "message": "elided duplicate skill content",
  "extra": {
    "elided": 1,
    "savedChars": 4099,
    "skills": [{ "name": "using-superpowers", "elided": 1, "savedChars": 4099 }]
  }
}
```

The TUI notifier also shows a notification that does not enter session message history, similar to:

```text
[skill-deduper] Elided duplicate skill content before this request.

Elided blocks: 1
Saved characters: 4099
Skills:
- using-superpowers: 1 elided, 4099 chars saved
```

> **Note**: Current OpenCode does not always refresh cached npm plugins automatically. Prefer the exact versioned command from the latest GitHub Release. By default, that command should include `-g`; without `-g`, you are only changing the current project's `.opencode`.

</details>

---

## Usage

No extra command is required after installation. The plugin checks outgoing OpenCode model requests:

```text
Message 1: full using-superpowers skill content
Message 2: full using-superpowers skill content
```

After transform:

```text
Message 1: [skill-deduper] Skill using-superpowers was reloaded later; older copy elided (... chars).
Message 2: full using-superpowers skill content
```

The newest copy remains intact, so the model still receives the current skill instructions.

## Who Should Use This

- Users who repeatedly load Superpowers, OmO skills, or other long skills in one OpenCode session
- Users who rely on slash commands, native `skill` calls, or multi-agent workflows
- Users who want to reduce duplicated skill text in the request context

## Notes

- The plugin only detects content that starts with recognizable skill markers or skill directory paths.
- It does not deduplicate arbitrary repeated prose.
- User-pasted transcripts or task prompts stay intact even when they mention slash commands, `## Skill:`, or similar skill-looking text.
- It only affects outgoing model requests, not stored OpenCode session history.
- OpenCode's `experimental.chat.messages.transform` hook is experimental, so future OpenCode versions may change the plugin API.

---

## License

MPL-2.0 License. See [LICENSE](LICENSE) for details.
