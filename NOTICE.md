# 第三方内容

ClaudeDeck 本身以 [MIT](LICENSE) 发布。以下内容随包分发,各自适用其自身许可证。

## 字体

`src/renderer/src/fonts/` 下的 `.woff2` 文件会打进安装包。四套字体全部采用
**SIL Open Font License 1.1**,该许可证明确允许将字体嵌入软件并随之分发。

| 字体 | 版权 |
|---|---|
| Caprasimo | Copyright 2023 The Caprasimo Project Authors |
| Figtree | Copyright 2022 The Figtree Project Authors |
| IBM Plex Mono | Copyright © 2017 IBM Corp.(保留字体名 "Plex") |
| Source Serif 4 | Copyright 2014 The Source Serif 4 Project Authors |

许可证原文与合规说明见
[src/renderer/src/fonts/LICENSES.md](src/renderer/src/fonts/LICENSES.md)。

字体未经修改,直接取自 Google Fonts 的官方 woff2。

## 运行时依赖

ClaudeDeck 通过 [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
驱动本机安装的 Claude Code CLI。两者均不随本项目分发,由用户自行安装。

**ClaudeDeck 是非官方项目**,与 Anthropic 无隶属、赞助或背书关系。
Claude 与 Claude Code 是 Anthropic 的商标,本项目仅作描述性使用。
