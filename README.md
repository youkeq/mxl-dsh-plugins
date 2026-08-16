# mxl-dsh-plugins — Custom plugins for DSH

A collection of custom plugins for DeepSeek Harness (DSH). Each plugin installs independently; none depends on the other.

## Plugins

| Plugin | What it does |
|--------|--------------|
| [dsh-mxl-vision-assist](./dsh-mxl-vision-assist/) | Vision assistant: send images in chat and get them recognized (Hermes-style), plus an AI self-check screenshot tool with transient zero-disk mode |
| [dsh-mxl-custom-settings](./dsh-mxl-custom-settings/) | Custom settings panel: visually manage switches and options of workspace custom plugins under Settings → Custom Settings |

## Quick start

Each plugin's README contains the full installation steps (copy package → add one row to `cordis.patch.yml` → restart), for example:

```yaml
- insert:
    - id: dsh-mxl-vision-assist-persist
      name: dsh-mxl-vision-assist
```

## Using them together

- The vision plugin's model dropdown and switches are best managed with the custom settings panel.
- Both plugins can be installed independently or together.
- Too lazy to install? Just let the AI do it.

---

## 中文版

# mxl-dsh-plugins — DSH 自定义插件集

为 DeepSeek Harness (DSH) 编写的自定义插件集合。每个插件独立安装、互不依赖。

## 插件一览

| 插件 | 说明 |
|------|------|
| [dsh-mxl-vision-assist](./dsh-mxl-vision-assist/) | 视觉辅助：对话框直接发图自动识别（视图模式）+ AI 自己截图自检（transient 零落盘，截完不留文件） |
| [dsh-mxl-custom-settings](./dsh-mxl-custom-settings/) | 自定义设置面板：在 设置 → 自定义设置 中可视化管理自定义插件的开关与选项 |

## 快速开始

每个插件目录内的 README 含完整安装步骤（复制包 → `cordis.patch.yml` 加一行 → 重启），例如：

```yaml
- insert:
    - id: dsh-mxl-vision-assist-persist
      name: dsh-mxl-vision-assist
```

## 配套使用

- 视觉辅助插件的模型下拉、开关等配置，推荐用自定义设置面板管理
- 两个插件可独立安装，也可一起安装
- 自己懒得装？直接丢给 AI 安装就行。
