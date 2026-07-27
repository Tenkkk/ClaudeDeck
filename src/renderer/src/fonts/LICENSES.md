# 打包字体的授权

本目录下的 `.woff2` 文件随 ClaudeDeck 一同分发。四套字体**全部**采用
**SIL Open Font License 1.1**,该许可证明确允许将字体嵌入软件并随之分发。

| 字体 | 版权 | 许可证原文 |
|---|---|---|
| Caprasimo | Copyright 2023 The Caprasimo Project Authors | [OFL-Caprasimo.txt](OFL-Caprasimo.txt) |
| Figtree | Copyright 2022 The Figtree Project Authors | [OFL-Figtree.txt](OFL-Figtree.txt) |
| IBM Plex Mono | Copyright © 2017 IBM Corp.(保留字体名 "Plex") | [OFL-IBM-Plex-Mono.txt](OFL-IBM-Plex-Mono.txt) |
| Source Serif 4 | Copyright 2014 The Source Serif 4 Project Authors | [OFL-Source-Serif-4.txt](OFL-Source-Serif-4.txt) |

## 合规要点

- **随附许可证与版权声明** —— 即本文件与同目录的四份 `OFL-*.txt`,它们会一并打进安装包。
- **不单独售卖字体** —— 字体只作为 ClaudeDeck 的一部分分发。
- **未修改字体文件** —— 直接取自 Google Fonts 的官方 woff2,未做改名、改造或再生成。
  IBM Plex Mono 带「保留字体名」条款,只要不修改就不受影响。

## 只打包了拉丁子集

每套字体只取 `latin` 与 `latin-ext` 两个子集,合计约 325 KB。

这四套字体本身**不含汉字**,所以中文不受影响 —— 它由 `styles.css` 里字体栈中
靠后的 `Noto Sans SC`(用户装了才用)或 Windows 自带的微软雅黑承担。
完整打包 Noto Sans SC 需要 404 个 Unicode 分片、数十 MB,对一个 152 MB 的
安装包来说不划算,而 Windows 上的中文回落效果可以接受。

## 可变字体

Figtree 与 Source Serif 4 是可变字体,Google 对不同字重返回的是同一个文件。
因此它们各只打包一份,`@font-face` 里声明字重**区间**而非逐档,
避免同一份文件被存四遍。
