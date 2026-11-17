# QPlayer QQ 音乐音源插件

QPlayer 的独立 QQ 音乐音源插件，实现 QPlayer JavaScript 插件 ABI 1.0。
插件不包含任何音频、账号凭据或受版权保护的媒体；登录凭据通过 QPlayer 的
`credentials.*` 加密凭据库按插件隔离保存。

> 与腾讯 / QQ 音乐无隶属、合作或背书关系。使用需遵守 QQ 音乐服务条款与当地法律。

## 功能

| 能力 | 说明 |
|---|---|
| `searchSongs` / `searchAlbums` / `searchArtists` / `searchPlaylists` | 单曲、专辑、歌手、歌单搜索与分页 |
| `songDetails` | 按 songmid 批量获取歌曲详情 |
| `playlistDetails` | 歌单详情与曲目，分页续拉，私密歌单需登录 |
| `albumDetails` / `artistDetails` | 专辑、歌手详情及作品 |
| `home` | 首页推荐歌曲 + 推荐歌单 |
| `home({operation:"recommendSongs"})` | **每日 30 首**（登录后读取「每日30首」卡片对应的歌单） |
| `recent` / `scrobble` | 本地记录并展示最近播放 |
| `heartRecommendation` | 心动模式（雷达/猜你喜欢，登录后可用） |
| `userPlaylists` | 自建歌单（含「我喜欢」）与收藏歌单 |
| `like` | 「我喜欢」读取与增删 |
| `playlistMutation` | 新建/删除歌单、增删歌曲、收藏/取消收藏歌单 |
| `playlistReorder` / `playlistCover` | 歌单排序与更换封面（仅自建歌单） |
| `resolveStream` | M800/M500 MP3、F000 FLAC 播放地址（**需要登录**） |
| `lyrics` | LRC 原文与翻译 |
| `login` / `account` | QQ 扫码、QQ/微信网页登录、粘贴 Cookie；账号资料 |

推荐数据来源：

- **每日推荐**：`music.recommend.RecommendFeed/get_recommend_feed` 中找到标题含
  「每日」/「30首」的卡片，用卡片 ID 走歌单详情接口取歌。
- **推荐歌曲**：登录后用 `music.recommend.TrackRelationServer/GetRadarSong`
  逐页拉取「猜你喜欢」；未登录或接口不可用时回退到热歌榜。
- **推荐歌单**：`music.playlist.PlaylistSquare/GetRecommendFeed`，失败时回退
  `playlist.HotRecommendServer/get_hot_recommend`。

未登录时首页仍有热歌与热门歌单；每日推荐和播放地址需要登录 QQ 音乐。

## 安装

1. 生成安装包：

   ```bash
   python scripts/package.py
   ```

   产物为 `dist/qqmusic-1.0.0.qplug`，未签名，QPlayer 手动导入时会显示代码执行警告。

2. 在 QPlayer 中打开「设置 → 音源插件 → 导入插件包」，选择该文件并启用。

3. 在插件设置中登录（QQ 扫码 / 网页登录 / 粘贴 Cookie）。播放地址解析需要登录。

最低宿主版本为 **QPlayer 1.9.7**（使用了 `searchPlaylists`、`qrImageBase64` 等接口）。

## 开发

```bash
node --check src/main.js
python scripts/package.py
python scripts/verify-package.py dist/qqmusic-1.0.0.qplug
```

插件运行在 QPlayer 的 Rhino Realm 中，只能通过全局 `qplayer` 对象访问宿主能力；
本实现使用 `http.request`、`credentials.*`、`storage.*` 与声明式登录流程。

## 许可与来源

MIT。本项目以
[TIMER-err/qplayer-qqmusic-plugin](https://github.com/TIMER-err/qplayer-qqmusic-plugin)
（MIT，Copyright (c) TIMER-err）为基础修改；`scripts/verify-package.py` 直接来自
[TIMER-err/qplayer-plugin-template](https://github.com/TIMER-err/qplayer-plugin-template)
（MIT，Copyright (c) TIMER-err）。

接口调研还参考了：

- [tlyanyu/multiPlatformMusicApi](https://github.com/tlyanyu/multiPlatformMusicApi)
  （未声明许可证）：「每日30首」卡片定位与 `GetRadarSong` 参数，按其思路重新实现，未复制源文件。
- [jsososo/QQMusicApi](https://github.com/jsososo/QQMusicApi)（GPL-3.0）：
  仅确认 `client_music_search_songlist` 等接口路径，未复制源文件。
- [TIMER-err/qplayer](https://github.com/TIMER-err/qplayer)（Apache-2.0）：
  仅参考插件 ABI、权限与安全模型文档，未复制源代码。

完整的来源、修改内容与参考清单见 [LICENSE](LICENSE)。
