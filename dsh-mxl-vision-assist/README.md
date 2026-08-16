# dsh-mxl-vision-assist — 视觉辅助插件

让主模型"看见"图片，并让 AI 可以自己截图、自己看、自己验证。

## 功能

### 视图模式（类似 Hermes：对话框直接发图片）
- 在对话框中**直接发送图片**（粘贴/上传均可），插件自动调用视觉模型识别，并把完整描述交给主模型（【图片识别结果】）
- 用户发的图片**正常保存在附件存储中**——留档、可追溯、可回看
- 历史会话里已有的图片消息也会自动恢复识别（每轮请求自动转换）

### AI 截图自检（capture_window 工具）
- 内置 `capture_window` 工具：按**进程名 / 窗口标题**直接抓取任意窗口的内容——即使窗口被其他程序遮挡、甚至最小化
- AI 完成任务后可以**自己截图、自己看识别结果、自己判断效果**（配合"你做完自己验证"使用）
- **transient 零落盘模式**：自检截图只存在于内存，识别完**不留任何文件、不进会话记录**——**AI 自己截的图不占硬盘、不占空间**；普通截图和用户发的图照常留档

### 启动探测与配置容错
- **启动探测**：配置的视觉模型不可用（配错 / 不支持视觉 / 无法连接）→ 终端打印**红色双语警告**；可用 → 全程安静
- **配置容错**：`provider / model` 标签格式自动规范化、模型存在性预检、连续失败熔断（3 次失败暂停 5 分钟，自动恢复）
- **日志静默**：正常运行零日志，仅错误输出（前缀 `[dsh-mxl-vision-assist]`）

## 安装

1. 将本包复制到 `<DSH_HOME>/profiles/node_modules/dsh-mxl-vision-assist/`
2. 在 `<DSH_HOME>/profiles/web/cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: dsh-mxl-vision-assist-persist
      name: dsh-mxl-vision-assist
```

3. 重启 `dsh web`

## 配置

- **配置文件**：工作区根目录 `.dsh-plugin.mxl-vision-assist.json`（插件首次启动自动创建，每个工作区一份）
- **视觉模型**：`settings.visionModel`，格式 `provider|model`（provider 与模型名之间用竖线分隔；也接受面板显示文案格式 `provider / model`，插件自动规范化）
- **默认值**：自动取你设置中**第一个声明支持图片的模型**；一个都没有则提示手动配置
- **推荐**：安装配套的[自定义设置面板 dsh-mxl-custom-settings](./dsh-mxl-custom-settings/)，在 设置 → 自定义设置 中可视化选择模型（下拉只列支持图片的模型，不会选错）
- **不装面板**：手动编辑上述 JSON 的 `settings.visionModel` 即可（200ms 内生效，无需重启）

## 注意事项

- 视觉模型必须**真实支持图片输入**；API key 在官方"模型"设置页配置
- `transient` 直连需要该提供方在设置中配置了 `baseURL`；未配置的提供方请使用普通截图模式
- 视觉辅助关闭时（`enabled: false`），图片转换与启动探测均不执行
