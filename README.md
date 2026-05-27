# 🎓 YOOC 易班优课自动刷课工具集

> 两个 Tampermonkey 油猴脚本，分别用于**正常倍速自动播放**和**极速刷课**。

## 📁 文件结构

```
yooc/
├── README.md                   # 本文档
├── 源码.HTML                    # 移动端网页参考源码
├── 源码pc.html                  # PC端网页参考源码
├── yooc-auto-play.user.js      # 🎬 正常版：倍速播放 + 自动下一节
└── yooc-fast-brush.user.js     # ⚡ 快速版：跳转末尾秒刷 + 自动下一节
```

---

## 🎬 脚本一：正常自动播放版 `yooc-auto-play.user.js`

适合想正常"看"视频但不想手动操作的用户。

### 功能

| 功能 | 说明 |
|------|------|
| 🚀 自动播放 | 页面加载后自动开始播放 |
| ⏩ 倍速播放 | 1x / 1.25x / 1.5x / 2x / 3x / 5x 六档可选 |
| ➡️ 自动下一节 | 视频播放完自动跳转下一节 |
| ✅ 学习进度上报 | 在 85%/90%/95% 节点自动上报完成状态 |
| 🖱️ 可拖拽面板 | 悬浮控制面板，支持拖拽移动 |
| 🖥️ 兼容双端 | PC 网页版 + 移动端网页版 |

### 配置项

```javascript
var SPEED_OPTIONS = [1, 1.25, 1.5, 2, 3, 5];   // 可选倍速
var DEFAULT_SPEED = 2;                           // 默认倍速
var AUTO_NEXT     = true;                        // 自动下一节
var DELAY_NEXT    = 5000;                        // 切换前等待(毫秒)
```

---

## ⚡ 脚本二：快速刷课版 `yooc-fast-brush.user.js`

适合想最快完成所有课程的用户。

### 工作原理

1. 页面加载后等待视频就绪
2. **直接跳转到视频 96% 位置**（跳过整段视频）
3. 自动发送 3 次完成上报（85%/90%/95% 节点）
4. 上报完成后自动跳转下一节，**URL 带 `?fast=1` 参数实现自动续刷**

### 特性

| 特性 | 说明 |
|------|------|
| ⚡ 极速刷课 | 每节课仅需几秒，跳过视频直接上报 |
| 🔄 自动续刷 | 跳转下一页后自动执行，全程无需手动操作 |
| 📊 实时计数 | 面板显示已完成/总课程数（localStorage 跨页面持久化） |
| ⏸️ 开始/暂停 | 再次点击按钮可暂停刷课，再次点击继续 |
| 🛡️ 防快进破解 | 禁用原站 nodrag 机制 |

### 配置项

```javascript
var JUMP_TO_RATIO = 0.96;    // 跳转到视频的 96% 位置
var DELAY_NEXT    = 3000;    // 跳转下一节前等待(毫秒)
var WAIT_VIDEO    = 3000;    // 等待视频就绪(毫秒)
```

---

## 📦 安装方法

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展

   | 浏览器 | 安装地址 |
   |--------|---------|
   | Chrome | [Chrome Web Store](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) |
   | Edge | [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd) |
   | Firefox | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/tampermonkey/) |

2. 点击 Tampermonkey 图标 → **添加新脚本**
3. 粘贴脚本内容 → `Ctrl+S` 保存
4. 打开 YOOC 课程页面，确认悬浮面板出现

> ⚠️ **两个脚本不要同时启用**，根据需要选择一个即可。

---

## 🔄 移植到其他网站

核心逻辑是通用的，移植时只需修改：

1. **`@match`** — 改为目标网站 URL
2. **`getVideo()`** — 改为视频元素选择器
3. **`goNext()`** — 改为当前课程/下一课程的 DOM 标识
4. **`sendDone()`** — 改为对应网站的完成上报接口
5. 删除 `nodrag` 拦截（如果目标网站没有类似机制）

---

## ⚠️ 注意事项

- **后台标签页**：Chrome 的"内存节省模式"可能休眠非活跃标签页，建议关闭或添加白名单
- **浏览器自动播放限制**：首次使用可能需手动点击一次视频
- **快速版风险**：极速刷课（跳转末尾秒刷）可能被网站检测，建议谨慎使用
- **仅供学习参考**，请合理使用
