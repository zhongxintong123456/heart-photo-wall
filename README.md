# 爱心照片墙

爱心照片墙原型。在这个目录运行 `python3 -m http.server 8767`，然后打开 `http://localhost:8767/`。摄像头模式要求本机地址或 HTTPS。

- 在 `js/media-data.js` 的 `personalPhotos` 中填写照片路径和话语。没有配置照片时，场景会使用空白卡片。
- 手势开启后，张开手掌散开照片，握拳聚成爱心，🤟 随机聚焦。按钮、拖拽和相册浏览无需摄像头。
- 改编自 [Valentine-Demo](https://github.com/thanhzkda/Valentine-Demo)，原许可见 [LICENSE](LICENSE)。
