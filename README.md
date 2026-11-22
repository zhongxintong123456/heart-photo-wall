# 爱心照片墙

爱心照片墙原型。在这个目录运行 `python3 -m http.server 8767`，然后打开 `http://localhost:8767/`。摄像头模式要求本机地址或 HTTPS。

- 点击「上传照片」可以在当前浏览器添加或替换最多 16 张照片。照片保存在本机浏览器中，空余位置显示占位卡片。
- 也可以在 `js/media-data.js` 的 `personalPhotos` 中为部署版本填写照片及话语。
- 手势开启后，张开手掌散开照片，握拳聚成爱心，🤟 随机聚焦。按钮、拖拽和相册浏览无需摄像头。
- 改编自 [Valentine-Demo](https://github.com/thanhzkda/Valentine-Demo)，原许可见 [LICENSE](LICENSE)。
