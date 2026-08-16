# dsh-mxl-custom-settings — 自定义设置面板

通用的自定义插件配置面板：扫描工作区根目录的 `.dsh-plugin.<id>.json` 注册文件，渲染成设置卡片（开关 / 下拉 / 文本），在 设置 → 自定义设置 中可视化管理。

## 功能

- **通用渲染器**：不绑定任何插件——只要工作区里有注册文件（schema 支持 `select` / `switch` / `text` / `group`），自动显示为卡片
- **实时生效**：开关 / 下拉 / 文本修改后写入注册文件，对应插件通常在数百毫秒内感知，无需重启
- **插件总线**：提供 `customPluginBus`，插件可订阅面板变更
- 界面为宿主级挂载，无需打开会话即可在设置页看到

## 安装

1. 将本包复制到 `<DSH_HOME>/profiles/node_modules/dsh-mxl-custom-settings/`
2. 在 `<DSH_HOME>/profiles/web/cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: dsh-mxl-custom-settings-panel
      name: dsh-mxl-custom-settings
```

3. 重启 `dsh web`

## 注册文件格式

工作区根目录下形如 `.dsh-plugin.<id>.json`，示例：

```json
{
  "id": "example-plugin",
  "name": "示例插件",
  "description": "插件说明",
  "enabled": true,
  "schema": [
    { "key": "mySelect", "label": "下拉项", "type": "select", "options": [{ "value": "a", "label": "选项 A" }] },
    { "key": "mySwitch", "label": "开关项", "type": "switch" },
    { "key": "myText", "label": "文本项", "type": "text" }
  ],
  "settings": { "mySelect": "a", "mySwitch": false }
}
```

- `enabled`：卡片主开关，写入 `enabled` 字段
- `settings`：各字段值，按 `key` 写入

## 配套插件

- [视觉辅助 dsh-mxl-vision-assist](./dsh-mxl-vision-assist/)：本面板为它提供"视觉识别模型"下拉与开关 UI（不装本面板也可用视觉辅助，但需要手动编辑它的注册文件）
