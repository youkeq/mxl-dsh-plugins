# mxl-dsh-plugins — DSH 自定义插件集

为 DeepSeek Harness (DSH) 编写的自定义插件集合，即装即用，互不依赖。

## 插件一览

| 插件 | 说明 |
|------|------|
| [dsh-mxl-vision-assist](./dsh-mxl-vision-assist/) | 视觉辅助：对话框直接发图自动识别（视图模式）+ AI 自己截图自检（transient 零落盘，截完不留文件） |
| [dsh-mxl-custom-settings](./dsh-mxl-custom-settings/) | 自定义设置面板：在 设置 → 自定义设置 中可视化管理工作区自定义插件的开关与选项 |

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
