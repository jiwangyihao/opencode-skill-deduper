# opencode-skill-deduper

[![npm version](https://img.shields.io/npm/v/opencode-skill-deduper.svg)](https://www.npmjs.com/package/opencode-skill-deduper)
[![License: MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-blue.svg)](./LICENSE)

An OpenCode plugin that reduces repeated skill content in model requests. It keeps the newest full copy of each loaded skill and replaces older duplicate copies with a short placeholder before the chat request is sent.

这个 OpenCode 插件用于压缩重复加载的 skill 内容：同名 skill 只保留最新完整副本，旧副本会在发给模型前替换成短占位文本，从而降低上下文占用。

## Why

OpenCode sessions can load the same skill more than once through slash commands, native `skill` tool calls, or agent workflows. Without cleanup, each full skill body stays in the request context. In long or tool-heavy sessions this can waste thousands of characters per duplicate skill.

`opencode-skill-deduper` runs in `experimental.chat.messages.transform`, so it only changes the outgoing model payload. It does not rewrite the OpenCode session database or remove the latest skill content.

## Features

- Keeps the newest full copy of every skill.
- Elides older duplicate skill text with a compact marker.
- Supports OpenCode native `<skill_content name="...">` output.
- Supports OmO / Oh My OpenCode `## Skill: ...` output.
- Supports slash-injected `<skill-instruction>` blocks when the skill name appears in the skill path.
- Logs how many duplicates were elided and roughly how many characters were saved.

## Installation

Install globally with OpenCode:

```bash
opencode plugin opencode-skill-deduper@latest --force -g
```

Or add it to your OpenCode config manually:

```jsonc
{
  "plugin": ["opencode-skill-deduper"]
}
```

## Local Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

## Logs

When duplicate skill content is elided, the plugin writes a log line like this:

```text
[skill-deduper] elided duplicate skill content {"elided":1,"savedChars":4099,"skills":[{"name":"using-superpowers","elided":1,"savedChars":4099}]}
```

If no duplicate full skill content is found, the plugin stays silent.

## Behavior

Before:

```text
Message 1: full using-superpowers skill content
Message 2: full using-superpowers skill content
```

After transform:

```text
Message 1: [skill-deduper] Skill using-superpowers was reloaded later; older copy elided (... chars).
Message 2: full using-superpowers skill content
```

The latest copy remains intact so the model still has the current instructions.

## Limitations

- The plugin only detects skill text with recognizable skill markers or skill directory paths.
- It does not deduplicate arbitrary repeated prose.
- It only affects outgoing requests, not stored session history.
- The OpenCode hook is experimental, so future OpenCode versions may change the plugin API.

## 中文说明

### 使用场景

如果你在 OpenCode 中频繁加载 Superpowers、OmO skills 或其他长 skill，同一个 skill 可能在上下文中出现多次。这个插件会在模型请求发送前压缩旧副本，避免重复内容挤占上下文窗口。

### 安装

```bash
opencode plugin opencode-skill-deduper@latest --force -g
```

### 回退

如果需要停用插件，请从 OpenCode 配置的 `plugin` 列表中移除 `opencode-skill-deduper`，或移除对应的全局插件安装。

## License

MPL-2.0. See [LICENSE](./LICENSE).
