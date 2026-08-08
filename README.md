# Paper Echo · SCoPE 论文跟读器

用**听读跟读**的方式，把 SCoPE 论文（IAI 2026，*A Prompting Framework for Chemical Information Extraction*）读到能流利开口。

## 这是什么

- 论文全文 **123 句**按顺序拆开，每句配 **qwen3-tts 英文朗读**（女生主持音色）
- 句子里的**生词**按 CET4（CEFR B1）水平自动标注，点词弹出详解：音标 / 词性 / 释义 / 搭配 / 词族 / 记忆提示 / 例句
- 生词**也能点朗读**，跟读练习全覆盖

## 功能

- 🔊 每句跟读（可 0.75x 慢速）
- ▶ 全文连播（影子跟读）
- 🔁 单句循环（一句练熟再下一句）
- 🎙 录音对比（录下自己的朗读，和原音对比听）
- 🇨🇳 中文翻译对照（点击展开）
- 📒 生词复习本（读到生词点"不认识"自动收集，可导出 txt 导入 Anki / WordGrove）
- 🎲 随机抽句（模拟被提问）
- 进度自动保存（读过哪些句、复习本都存本地）
- 朗读模式（大字号纯净视图）/ 暗色模式

## 使用

直接打开 [https://zhangs1r.github.io/scope-reader/](https://zhangs1r.github.io/scope-reader/)（手机电脑都行，手机优先）。

数据全部在本地（无后端、无跟踪），进度存浏览器 localStorage。

## 数据

- `data/sentences.json` — 123 句原文（MinerU 从 PDF 转换）
- `data/words.json` — 118 个生词详解（CET4 标注，CEFR 词表对照）
- `data/translations.json` — 中文翻译
- `audio/sent/` — 句子朗读 mp3（qwen3-tts 生成）
- `audio/word/` — 单词朗读 mp3

## 本地开发

```bash
python3 -m http.server 8901
# 打开 http://localhost:8901
```

## 技术

纯 HTML/CSS/JS 静态站，GitHub Pages 自动部署。音频全部离线打包。

— 为 IAI 2026 oral presentation 准备 · 张建强
