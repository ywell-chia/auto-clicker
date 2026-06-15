# 🖱️ Auto Clicker Pro / 自动点击器 Pro

A powerful Chrome/Edge extension for automating webpage clicks, with multi-language support (English & Chinese).

一个功能强大的 Chrome/Edge 浏览器自动点击插件，支持中英文双语界面。

---

## ✨ Features / 功能特性

### 🎯 Multiple Trigger Types / 多种触发方式
- **🌐 Website** — Trigger when visiting a specific URL / 访问指定网站时自动触发
- **🎯 Element** — Trigger when a specific element appears / 页面出现指定元素时触发
- **📝 Text** — Trigger when specific text is found / 页面包含指定文字时触发
- **🔗 Combo** — Trigger when multiple conditions are met simultaneously / 同时满足多个条件时触发

### ⚙️ Trigger Timing / 触发时机
- **🤖 Auto** — Choose one of the three auto modes below / 选择以下三种自动模式之一
- **👆 Manual** — Execute only on manual trigger / 仅手动触发时执行

Three mutually exclusive auto modes / 三种互斥的自动模式：

| Mode / 模式 | Description / 说明 |
|---|---|
| ⏱️ Page Load / 页面加载 | Trigger once after page load (configurable delay) / 页面加载完成后触发一次（可设置延迟） |
| 🔄 Polling / 定期轮询 | Periodically check trigger conditions / 定期检查触发条件 |
| 👀 Observer / 持续监听 | Real-time monitoring via MutationObserver / 使用 MutationObserver 实时监听页面变化 |

### 📋 Multi-Step Clicking / 多步骤点击
- Add multiple click steps / 支持添加多个点击步骤
- Per-step configuration / 每个步骤可单独设置：
  - Delay before action (ms) / 延迟时间（毫秒）
  - Repeat count / 连续点击次数
  - Interval between clicks (ms) / 每次点击间隔

### 💾 Config Management / 配置管理
- Save multiple configurations / 保存多个配置
- Edit, delete, pause/resume configs / 编辑、删除、暂停/启用
- Quick test any config / 快速测试配置
- Import/Export configs (JSON) with selective pick / 导入/导出配置（JSON），支持勾选和全选
- Search configs by name / 按名称搜索配置

### 🌐 Multi-Language / 多语言支持
- English & Chinese / 支持英文和中文
- Switch language anytime via dropdown / 可随时通过下拉菜单切换语言

---

## 🚀 Installation / 安装

### 1. Download / 下载代码
```bash
git clone https://github.com/your-username/auto-clicker.git
cd auto-clicker
```

### 2. Load in Chrome or Edge / 加载到浏览器
1. Open `chrome://extensions/` or `edge://extensions/` / 打开扩展管理页面
2. Enable **Developer mode** (top right) / 开启右上角「开发者模式」
3. Click **Load unpacked** / 点击「加载已解压的扩展程序」
4. Select the `auto-clicker` folder / 选择 `auto-clicker` 文件夹

### 3. Start Using / 开始使用
1. Click the extension icon in the toolbar / 点击浏览器工具栏的插件图标
2. Configure trigger type and click steps / 配置触发方式和点击步骤
3. Save and let it auto-click! / 保存配置，开始自动点击！

---

## 📖 Usage Guide / 使用说明

### Create a Config / 创建配置
1. Enter a config name / 输入配置名称
2. Choose trigger type (Website / Element / Text / Combo) / 选择触发方式
3. Set trigger timing (Auto / Manual), if auto choose one mode / 设置触发时机，自动模式下选择一种运行方式
4. Add click steps / 添加点击步骤
5. Click **Save** / 点击「保存」

### Test a Config / 运行测试
1. After setting up, click **Test Draft** / 点击「测试当前草稿」
2. The config runs immediately on the current page / 在当前页面立即执行
3. Verify the result / 验证效果是否符合预期

### Manage Configs / 管理配置
1. Click **Saved Configs** / 点击「查看已保存」
2. Edit ✏️, Run ▶️, Pause ⏸️, or Delete 🗑️ any config / 编辑、运行、暂停、删除配置
3. Use the search box to filter / 使用搜索框快速查找

### Import & Export / 导入导出
- Click **Export** to select and export configs as JSON / 点击导出，勾选要导出的配置
- Click **Import** to load a JSON file, then select which configs to import / 点击导入，选择文件后勾选要导入的配置
- Supports **Select All** for batch operations / 支持全选批量操作

---

## 🛠️ Tech Stack / 技术栈

| Category | Technology |
|----------|-----------|
| Extension Spec / 扩展规范 | Manifest V3 |
| Language / 语言 | Vanilla JavaScript |
| Storage / 存储 | Chrome Storage API |
| Page Interaction / 页面交互 | Chrome Tabs & Scripting API |
| DOM Monitoring / DOM 监听 | MutationObserver |
| Browser Support / 浏览器支持 | Chrome, Edge |
| Build / 构建 | None (zero dependencies) / 无依赖 |

---

## 📁 Project Structure / 项目结构

```
auto-clicker/
├── manifest.json      # Extension manifest / 插件配置文件
├── popup.html         # Popup UI / 弹窗界面
├── popup.js           # Popup logic / 弹窗逻辑
├── i18n.js            # Internationalization / 国际化翻译
├── content.js         # Content script / 内容脚本（页面交互）
├── content.css        # Content script styles / 内容脚本样式
├── background.js      # Service worker / 后台服务
└── README.md          # Documentation / 说明文档
```

---

## 🔧 Development / 开发说明

1. Edit any source file / 修改任意文件
2. Refresh the extension at `chrome://extensions/` or `edge://extensions/` / 在扩展页面刷新插件
3. Re-open the popup to see changes / 重新打开插件界面查看效果

### Debugging / 调试技巧
- Right-click the popup → **Inspect** to open DevTools / 右键弹窗 → 检查元素
- Check the Console panel for logs / 查看 Console 面板的日志输出

---

## 📄 License / 许可证

MIT License

---

**Enjoy the power of automation! 🎉 / 享受自动化带来的便利！**
