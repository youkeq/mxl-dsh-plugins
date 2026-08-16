# dsh-mxl-vision-assist

[![npm](https://img.shields.io/npm/v/dsh-mxl-vision-assist)](https://www.npmjs.com/package/dsh-mxl-vision-assist)

Give the main model eyes — and let the AI verify its own work by taking screenshots.

A DeepSeek Harness (DSH) plugin that automatically turns images into text descriptions for the main model, and provides a window-capture tool the AI can use to visually inspect its own output.

## Features

### Hermes-style vision: send images directly in chat
- Paste or upload an image in the conversation — the plugin automatically sends it to a vision model and feeds a full description back to the main model (【图片识别结果】).
- Images **you** send are stored normally as attachments — archived, traceable, reviewable.
- Images in past conversations are re-described automatically on every request.

### AI self-check screenshots (capture_window tool)
- A `capture_window` tool that grabs any window by **process name or window title** — even when it is covered by other windows or minimized.
- After finishing a task, the AI can screenshot, read the recognition result, and judge its own work ("verify yourself when done").
- **Transient zero-disk mode**: self-check screenshots exist in memory only — no files, no conversation records. **AI screenshots take zero disk space**; your screenshots and uploaded images are archived as usual.

### Startup probe & fault tolerance
- On startup the plugin probes the configured vision model: unusable (misconfigured / not vision-capable / unreachable) → a **red bilingual warning** in the terminal; usable → complete silence.
- Tolerant configuration: `provider / model` labels are normalized automatically, the model is pre-checked for image capability, and repeated failures trigger a circuit breaker (3 failures → pause 5 minutes → auto-recover).
- Quiet logging: zero output during normal operation; errors only, prefixed `[dsh-mxl-vision-assist]`.

## Requirements: configure a vision model first

The main model in DSH is not necessarily vision-capable. Just like Hermes mode, you must configure a vision-capable model yourself before images can be recognized:

1. **Bind the API key and the model in DSH's official model settings** (Settings → Models) — the same place where any provider is configured. The provider needs a valid API key, and the model must genuinely support image input.
2. **Tell the plugin which model to use**, in either of two ways:
   - **Config file** (recommended, no extra install): edit `<workspace>/.dsh-plugin.mxl-vision-assist.json` → `settings.visionModel` = `"provider|model"`. Location and format below. Changes take effect within ~200 ms — no restart.
   - **Custom settings panel**: install [dsh-mxl-custom-settings](./dsh-mxl-custom-settings/), then pick the model in Settings → Custom Settings. The dropdown only lists image-capable models, so you cannot select a wrong one.

If `visionModel` is left empty, the plugin automatically picks the first image-capable model found in your DSH settings; if none exists, it asks you to configure one.

## Installation

### npm (recommended)

Install from npm into the DSH profile directory:

```bash
cd <DSH_HOME>/profiles
npm i dsh-mxl-vision-assist
```

Then append to `<DSH_HOME>/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-mxl-vision-assist-persist
      name: dsh-mxl-vision-assist
```

Restart `dsh web`.

### Manual copy

1. Copy this package to `<DSH_HOME>/profiles/node_modules/dsh-mxl-vision-assist/`
2. Append the `cordis.patch.yml` row above
3. Restart `dsh web`

## Configuration

- **Config file location**: `.dsh-plugin.mxl-vision-assist.json` in the **workspace root** (the working directory of your agent session). The plugin creates it automatically on first startup — one file per workspace.
- **Format**:

```json
{
  "id": "mxl-vision-assist",
  "name": "视觉辅助",
  "description": "Vision assistant",
  "enabled": true,
  "settings": {
    "visionModel": "your-provider|your-vision-model"
  }
}
```

- `settings.visionModel`: `provider|model`, separated by a pipe. `provider` must match a provider configured in DSH's model settings; `model` must support image input. The display form `provider / model` is also accepted and normalized automatically.
- Changes are picked up within ~200 ms — no restart needed.
- `enabled: false` disables image transformation and the startup probe entirely.

## Notes

- The vision model must genuinely support image input; bind its API key in DSH's official model settings.
- Transient direct calls require the provider to have a `baseURL` configured in DSH settings; providers without one fall back to the normal screenshot flow.
- Vendor-neutral: this package contains no provider names, keys, or personal information.

---

## 中文版

# dsh-mxl-vision-assist — 视觉辅助插件

[![npm](https://img.shields.io/npm/v/dsh-mxl-vision-assist)](https://www.npmjs.com/package/dsh-mxl-vision-assist)

让主模型"看见"图片，并让 AI 可以自己截图、自己看、自己验证。

一个 DeepSeek Harness (DSH) 插件：自动把图片转成文字描述交给主模型，并提供窗口截图工具让 AI 能自己目视检查自己的产出。

## 功能

### 视图模式（类似 Hermes：对话框直接发图片）
- 在对话框中**直接发送图片**（粘贴/上传均可），插件自动调用视觉模型识别，并把完整描述交给主模型（【图片识别结果】）
- **你发的图片**正常保存在附件存储中——留档、可追溯、可回看
- 历史会话里已有的图片消息也会自动恢复识别（每轮请求自动转换）

### AI 截图自检（capture_window 工具）
- 内置 `capture_window` 工具：按**进程名 / 窗口标题**直接抓取任意窗口的内容——即使窗口被其他程序遮挡、甚至最小化
- AI 完成任务后可以**自己截图、自己看识别结果、自己判断效果**（配合"你做完自己验证"使用）
- **transient 零落盘模式**：自检截图只存在于内存，**不留任何文件、不进会话记录**——**AI 自己截的图不占硬盘、不占空间**；你自己截的图、发的图片照常留档

### 启动探测与配置容错
- **启动探测**：配置的视觉模型不可用（配错 / 不支持视觉 / 无法连接）→ 终端打印**红色双语警告**；可用 → 全程安静
- **配置容错**：`provider / model` 标签格式自动规范化、模型存在性与图片能力预检、连续失败熔断（3 次失败暂停 5 分钟，自动恢复）
- **日志静默**：正常运行零日志，仅错误输出（前缀 `[dsh-mxl-vision-assist]`）

## 前提：先配置好视觉模型

主模型未必支持看图。和 Hermes 模式一样，**需要你自己配置一个支持图片的视觉模型**，图片才能被识别：

1. **在 DSH 官方"模型"设置里绑定 API key 和模型**（设置 → 模型）——和配置任何模型渠道一样：渠道要有有效 key，且模型必须**真实支持图片输入**
2. **告诉插件用哪个模型**，二选一：
   - **配置文件**（推荐，无需额外安装）：编辑 `<工作区根目录>/.dsh-plugin.mxl-vision-assist.json` 的 `settings.visionModel` = `"provider|model"`，位置与格式见下文。**约 200ms 内生效，无需重启**
   - **自定义设置面板**：安装 [dsh-mxl-custom-settings](./dsh-mxl-custom-settings/) 后在 设置 → 自定义设置 里选择。下拉**只列支持图片的模型**，不会选错

`visionModel` 留空时，插件自动取你设置中第一个支持图片的模型；一个都没有则提示你手动配置。

## 安装

### 方式一：npm 安装（推荐）

在 DSH 的 profiles 目录执行：

```bash
cd <DSH_HOME>/profiles
npm i dsh-mxl-vision-assist
```

然后在 `<DSH_HOME>/profiles/web/cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: dsh-mxl-vision-assist-persist
      name: dsh-mxl-vision-assist
```

重启 `dsh web`。

### 方式二：手动复制

1. 将本包复制到 `<DSH_HOME>/profiles/node_modules/dsh-mxl-vision-assist/`
2. 追加上面那条 `cordis.patch.yml` 配置
3. 重启 `dsh web`

## 配置

- **配置文件位置**：工作区根目录（agent 会话的工作目录）下的 `.dsh-plugin.mxl-vision-assist.json`，插件首次启动自动创建，**每个工作区一份**
- **格式**：

```json
{
  "id": "mxl-vision-assist",
  "name": "视觉辅助",
  "description": "Vision assistant",
  "enabled": true,
  "settings": {
    "visionModel": "your-provider|your-vision-model"
  }
}
```

- `settings.visionModel`：`provider|model`，竖线分隔。`provider` 须与 DSH 模型设置里配置的渠道一致；`model` 须支持图片输入。面板显示形式 `provider / model` 也能识别，插件会自动规范化
- 修改后**约 200ms 生效，无需重启**
- `enabled: false` 时，图片转换与启动探测均不执行

## 注意事项

- 视觉模型必须**真实支持图片输入**；API key 在 DSH 官方"模型"设置页配置
- transient 直连需要该渠道在 DSH 设置中配置了 `baseURL`；未配置的渠道自动走普通截图流程
- 中立发布：本包不包含任何渠道名、密钥或个人信息
