"use strict";

/*
 * QPlayer QQ 音乐音源插件
 *
 * 实现了 QPlayer JavaScript 插件 ABI 1.0：搜索、详情、首页推荐、每日推荐、
 * 最近播放、登录、收藏、歌单写入、播放地址与歌词。
 *
 * 协议实现部分参考并改编自 TIMER-err/qplayer-qqmusic-plugin（MIT License），
 * 版权声明见仓库根目录 LICENSE。
 */

var UA_PC = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
var UA_MOBILE = "Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1";
var MUSICU = "https://u.y.qq.com/cgi-bin/musicu.fcg";
var SEARCH_HOST = "https://c.y.qq.com";
var STREAM_HOST = "https://ws.stream.qqmusic.qq.com/";
var REF_SEARCH = "https://y.qq.com/portal/search.html";
var REF_BASE = "https://y.qq.com/";
var REF_LYRIC = "https://y.qq.com/portal/player.html";

// QQ 网页登录固定参数（QQ 互联接入方标识）
var QQ_APPID = "716027609";
var QQ_DAID = "383";
var QQ_PT_3RD_AID = "100497308";
var PTQRSHOW = "https://ssl.ptlogin2.qq.com/ptqrshow";
var PTQRLOGIN = "https://ssl.ptlogin2.qq.com/ptqrlogin";
var CHECK_SIG = "https://ssl.ptlogin2.graph.qq.com/check_sig";
var OAUTH_AUTHORIZE = "https://graph.qq.com/oauth2.0/authorize";
var REF_XUI = "https://xui.ptlogin2.qq.com/";
var QQ_REDIRECT_URI = "https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/";

var FAV_DIR_ID = 201;
var DISS_PAGE = 500;
var MAX_PLAYLIST_SONGS = 3000;
var SEARCH_PAGE_SIZE = 30;

function call(method, args) {
  return qplayer.call(method, args || {});
}

function clampNumber(value, min, max) {
  value = Number(value);
  if (!value || value < min) return min;
  return value > max ? max : value;
}

function secureUrl(value) {
  value = String(value || "");
  if (value.indexOf("http://") === 0) return "https://" + value.slice(7);
  if (value.indexOf("//") === 0) return "https:" + value;
  return value;
}

// ---- 登录态 ----------------------------------------------------------------

function loadCookies() {
  return call("credentials.get", { key: "cookies" }).then(function (stored) {
    if (!stored) return {};
    try { return JSON.parse(stored); } catch (_) { return {}; }
  });
}

function loadSession() {
  return call("credentials.get", { key: "session" }).then(function (stored) {
    if (!stored) return {};
    try { return JSON.parse(stored); } catch (_) { return {}; }
  }, function () { return {}; });
}

function saveSession(value) {
  return call("credentials.put", { key: "session", value: JSON.stringify(value) });
}

function httpGetText(url, referer, ua, timeoutMs) {
  return call("http.request", {
    url: url, method: "GET",
    headers: { "User-Agent": ua || UA_PC, "Referer": referer || REF_BASE },
    timeoutMs: timeoutMs || 15000
  }).then(function (response) {
    if (response.status < 200 || response.status >= 300) throw new Error("HTTP " + response.status);
    return String(response.body || "");
  });
}

function cookieValue(cookies, keys) {
  for (var i = 0; i < keys.length; i++) {
    var v = cookies[keys[i]];
    if (v) return String(v);
  }
  return "";
}

function musicKey(cookies) {
  return cookieValue(cookies, ["musickey", "qm_keyst", "qqmusic_key"]);
}

function musicUin(cookies) {
  var uin = cookieValue(cookies, ["musicid", "uin", "wxuin", "qqmusic_uin"]);
  if (!uin) return "0";
  var digits = String(uin).replace(/^[oO]0*/, "");
  return digits ? digits : String(uin);
}

function gtk(key) {
  var h = 5381;
  for (var i = 0; i < key.length; i++) h = (h + ((h << 5) + key.charCodeAt(i))) | 0;
  return h & 0x7fffffff;
}

function hash33(str) {
  var h = 0;
  for (var i = 0; i < str.length; i++) h = (h + ((h << 5) + str.charCodeAt(i))) | 0;
  return h & 0x7fffffff;
}

function uuid4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    var v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function setCookieValue(setCookies, name) {
  for (var i = 0; i < (setCookies || []).length; i++) {
    var first = String(setCookies[i]).split(";")[0];
    var eq = first.indexOf("=");
    if (eq > 0 && first.slice(0, eq).trim() === name) return first.slice(eq + 1).trim();
  }
  return "";
}

function cookieHeaderFromSetCookies(setCookies) {
  return (setCookies || []).map(function (line) {
    return String(line).split(";")[0];
  }).join("; ");
}

function formEncode(params) {
  return Object.keys(params).map(function (key) {
    return encodeURIComponent(key) + "=" + encodeURIComponent(String(params[key]));
  }).join("&");
}

function httpRaw(method, url, opts) {
  opts = opts || {};
  var headers = { "User-Agent": opts.ua || UA_PC, "Referer": opts.referer || REF_BASE };
  if (opts.cookie) headers["Cookie"] = opts.cookie;
  if (opts.contentType) headers["Content-Type"] = opts.contentType;
  return call("http.request", {
    url: url, method: method, headers: headers,
    body: opts.body,
    includeBase64: !!opts.base64,
    followRedirects: opts.followRedirects !== false,
    timeoutMs: opts.timeoutMs || 15000
  });
}

function httpGetJson(url, referer, ua) {
  return call("http.request", {
    url: url, method: "GET",
    headers: { "User-Agent": ua || UA_MOBILE, "Referer": referer || REF_BASE },
    timeoutMs: 15000
  }).then(function (response) {
    if (response.status < 200 || response.status >= 300) throw new Error("HTTP " + response.status);
    return JSON.parse(response.body || "{}");
  });
}

function httpPostJson(url, body, referer, headers) {
  var all = { "User-Agent": UA_PC, "Content-Type": "application/json", "Referer": referer || REF_BASE };
  if (headers) {
    Object.keys(headers).forEach(function (key) { all[key] = headers[key]; });
  }
  return call("http.request", {
    url: url, method: "POST", headers: all,
    body: typeof body === "string" ? body : JSON.stringify(body),
    timeoutMs: 15000
  }).then(function (response) {
    if (response.status < 200 || response.status >= 300) throw new Error("HTTP " + response.status);
    return JSON.parse(response.body || "{}");
  });
}

var WRITE_COMM = "write";
var ANDROID_COMM = { ct: 11, cv: 14090008, v: 14090008, chid: "10003505", tmeAppID: "qqmusic" };

function musicuOnce(entries, override) {
  return Promise.all([loadCookies(), loadSession()]).then(function (both) {
    var cookies = both[0];
    var session = both[1] || {};
    var key = musicKey(cookies);
    var uin = key ? musicUin(cookies) : "0";
    var gtkValue = gtk(key);
    var comm = {
      cv: 4747474, ct: 24, format: "json", inCharset: "utf-8", outCharset: "utf-8",
      notice: 0, platform: "yqq.json", needNewCode: 1, uin: uin,
      g_tk: gtkValue, g_tk_new_20200303: gtkValue
    };
    if (override === WRITE_COMM) {
      Object.keys(ANDROID_COMM).forEach(function (k) { comm[k] = ANDROID_COMM[k]; });
      comm.qq = uin;
      comm.needNewCode = 0;
      delete comm.platform;
    } else if (override) {
      Object.keys(override).forEach(function (k) { comm[k] = override[k]; });
    }
    var loginType = Number(session.loginType || cookies.tmeLoginType || 0);
    if (key && loginType) {
      comm.authst = key;
      comm.tmeLoginType = loginType;
    }
    var body = { comm: comm };
    Object.keys(entries).forEach(function (k) { body[k] = entries[k]; });
    var headers = null;
    if (key) {
      var parts = [];
      Object.keys(cookies).forEach(function (name) {
        if (cookies[name]) parts.push(encodeURIComponent(name) + "=" + encodeURIComponent(String(cookies[name])));
      });
      if (parts.length) headers = { "Cookie": parts.join("; ") };
    }
    return httpPostJson(MUSICU, body, REF_BASE, headers);
  });
}

function needsRefresh(body) {
  if (!body || typeof body !== "object") return false;
  var keys = Object.keys(body);
  for (var i = 0; i < keys.length; i++) {
    var node = body[keys[i]];
    if (!node || typeof node !== "object") continue;
    if (Number(node.code) === 1000) return true;
    if (node.data && Number(node.data.retcode) === 104009) return true;
  }
  return false;
}

var refreshing = null;
var refreshedAt = 0;

function refreshCredential() {
  var now = Date.now();
  if (refreshing) return refreshing;
  if (now - refreshedAt < 60000) return Promise.resolve(false);
  refreshing = Promise.all([loadCookies(), loadSession()]).then(function (both) {
    var cookies = both[0], session = both[1] || {};
    var key = musicKey(cookies);
    var uin = musicUin(cookies);
    if (!key || uin === "0") return false;
    var loginType = Number(session.loginType || cookies.tmeLoginType || 2);
    var param = loginType === 1
      ? {
          openid: String(cookies.wxopenid || session.openid || ""),
          refresh_token: String(session.refreshToken || cookies.wxrefresh_token || ""),
          str_musicid: String(uin), musickey: key,
          unionid: String(session.unionid || cookies.wxunionid || ""), loginMode: 2
        }
      : {
          openid: String(cookies.psrf_qqopenid || ""),
          access_token: String(cookies.psrf_qqaccess_token || ""),
          refresh_token: String(cookies.psrf_qqrefresh_token || ""),
          expired_in: Number(cookies.psrf_access_token_expiresAt || 0),
          musicid: Number(uin), musickey: key, loginMode: 2
        };
    var comm = {
      format: "json", inCharset: "utf-8", outCharset: "utf-8", notice: 0,
      tmeLoginType: loginType
    };
    Object.keys(ANDROID_COMM).forEach(function (k) { comm[k] = ANDROID_COMM[k]; });
    return httpPostJson(MUSICU, {
      comm: comm,
      req: { module: "music.login.LoginServer", method: "Login", param: param }
    }, REF_BASE).then(function (body) {
      var data = (body.req || {}).data || {};
      var fresh = String(data.musickey || "");
      if (!fresh) return false;
      var id = String(data.musicid || data.str_musicid || uin);
      var updated = {};
      Object.keys(cookies).forEach(function (k) { updated[k] = cookies[k]; });
      updated.musickey = fresh;
      updated.qm_keyst = fresh;
      updated.qqmusic_key = fresh;
      updated.uin = id;
      updated.musicid = id;
      if (data.refresh_token) updated.psrf_qqrefresh_token = String(data.refresh_token);
      if (data.access_token) updated.psrf_qqaccess_token = String(data.access_token);
      if (data.expired_at) updated.psrf_access_token_expiresAt = String(data.expired_at);
      if (data.musickeyCreateTime) updated.psrf_musickey_createtime = String(data.musickeyCreateTime);
      return call("credentials.put", { key: "cookies", value: JSON.stringify(updated) })
        .then(function () { return true; });
    });
  }).catch(function () { return false; }).then(function (ok) {
    refreshing = null;
    refreshedAt = Date.now();
    return ok;
  });
  return refreshing;
}

function musicu(entries, override) {
  return musicuOnce(entries, override).then(function (body) {
    if (!needsRefresh(body)) return body;
    return refreshCredential().then(function (ok) {
      return ok ? musicuOnce(entries, override) : body;
    });
  });
}

// ---- DTO -------------------------------------------------------------------

function artistsOf(list) {
  var out = [];
  (list || []).forEach(function (item) {
    var id = String((item && (item.mid || item.id)) || "");
    if (id) out.push({ id: id, name: String((item && (item.name || item.title)) || "") });
  });
  return out;
}

var numericIds = {};
var songCache = {};

function rememberNumericId(mid, id) {
  if (mid && id) numericIds[String(mid)] = Number(id);
}

function photoUrl(prefix, id, size) {
  if (!id) return "";
  size = size || 300;
  return "https://y.gtimg.cn/music/photo_new/" + prefix + "R" + size + "x" + size + "M000" + id + ".jpg";
}

function songDto(raw) {
  raw = raw || {};
  var album = raw.album || {};
  var mid = raw.songmid || raw.mid || "";
  rememberNumericId(mid, raw.songid || raw.id);
  var albumMid = String(album.mid || raw.albummid || "");
  var albumName = String(album.name || raw.albumname || "");
  var artworkId = album.pmid || albumMid;
  var dto = {
    id: String(mid),
    title: String(raw.songname || raw.name || raw.title || ""),
    artists: artistsOf(raw.singer || raw.singers),
    album: albumMid ? { id: albumMid, name: albumName } : null,
    durationMs: Number(raw.interval || 0) * 1000,
    artworkUrl: secureUrl(photoUrl("T002", artworkId, 300)),
    artworkThumbUrl: secureUrl(photoUrl("T002", artworkId, 150)),
    playable: true,
    trial: false
  };
  if (dto.id) songCache[dto.id] = dto;
  return dto;
}

function songsOf(list, pick) {
  var out = [];
  (list || []).forEach(function (row) {
    var dto = songDto(pick ? pick(row) : row);
    if (dto.id) out.push(dto);
  });
  return out;
}

function publishMs(text) {
  var parts = String(text || "").split("-");
  if (parts.length < 3) return 0;
  var year = Number(parts[0]), month = Number(parts[1]), day = Number(parts[2]);
  if (!year || !month || !day) return 0;
  return Date.UTC(year, month - 1, day);
}

function albumDto(raw, songs) {
  raw = raw || {};
  var mid = raw.albumMid || raw.mid || "";
  var artists = raw.singerMid && raw.singerName
    ? [{ id: String(raw.singerMid), name: raw.singerName }]
    : ((songs && songs[0] && songs[0].artists) || []);
  return {
    id: String(mid),
    name: raw.albumName || raw.name || "",
    artworkUrl: secureUrl(photoUrl("T002", raw.pmid || mid, 300)),
    artworkThumbUrl: secureUrl(photoUrl("T002", raw.pmid || mid, 150)),
    publishTimeMs: publishMs(raw.publishDate),
    description: raw.desc || "",
    trackCount: Number(raw.totalNum || (songs || []).length || 0),
    artists: artists,
    songs: songs || []
  };
}

function searchAlbumDto(raw) {
  raw = raw || {};
  var mid = String(raw.albumMID || raw.albumMid || "");
  var artists = [];
  (raw.singer_list || []).forEach(function (s) {
    var id = String((s && (s.mid || s.id)) || "");
    if (id) artists.push({ id: id, name: String((s && s.name) || "") });
  });
  if (!artists.length && raw.singerMID && raw.singerName) {
    artists.push({ id: String(raw.singerMID), name: String(raw.singerName) });
  }
  return {
    id: mid,
    name: String(raw.albumName || ""),
    artworkUrl: secureUrl(photoUrl("T002", mid, 300)),
    artworkThumbUrl: secureUrl(photoUrl("T002", mid, 150)),
    publishTimeMs: publishMs(raw.publicTime),
    trackCount: Number(raw.song_count || 0),
    artists: artists
  };
}

function searchArtistDto(raw) {
  raw = raw || {};
  var mid = String(raw.singerMID || raw.mid || "");
  return {
    id: mid,
    name: String(raw.singerName || raw.name || ""),
    artworkUrl: secureUrl(raw.singerPic || photoUrl("T001", mid, 300)),
    artworkThumbUrl: secureUrl(raw.singerPic || photoUrl("T001", mid, 150)),
    albumCount: Number(raw.albumNum || 0),
    songCount: Number(raw.songNum || 0)
  };
}

function ownerRef(uin, name) {
  var id = String(uin || "");
  if (!/^[0-9]+$/.test(id) || id === "0") id = "";
  var label = String(name || "");
  return id || label ? { id: id, name: label } : null;
}

function decodeEntities(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, function (_, code) { return String.fromCharCode(Number(code)); })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function playlistDto(raw) {
  raw = raw || {};
  var creator = raw.creator && typeof raw.creator === "object" ? raw.creator : {};
  var creatorUin = creator.creator_uin || creator.qq || (typeof raw.creator !== "object" ? raw.creator : "");
  return {
    id: String(raw.content_id || raw.tid || raw.id || raw.dissid || ""),
    name: decodeEntities(raw.title || raw.name || raw.dissname || ""),
    description: decodeEntities(raw.desc || raw.introduction || ""),
    artworkUrl: secureUrl(raw.cover || raw.picUrl || raw.logo || raw.imgurl || ""),
    owner: ownerRef(creatorUin || raw.uin,
      raw.username || raw.nickname || raw.nick || creator.name),
    trackCount: Number(raw.song_cnt || raw.total_song_num || raw.songnum || raw.songNum || raw.song_count || 0),
    playCount: Number(raw.access_num || raw.play_count || raw.listen_num || raw.listennum || 0),
    subscribed: false,
    owned: false
  };
}

function squareDto(entry) {
  var basic = ((entry || {}).Playlist || {}).basic || {};
  var cover = basic.cover || {};
  return {
    id: String(basic.tid || ""),
    name: String(basic.title || ""),
    description: String(basic.desc || ""),
    artworkUrl: secureUrl(cover.medium_url || cover.small_url || cover.big_url || ""),
    owner: ownerRef((basic.creator || {}).uin, (basic.creator || {}).nick),
    trackCount: Number(basic.song_cnt || 0),
    playCount: Number(basic.play_cnt || 0),
    subscribed: Number(basic.fav || 0) === 1,
    owned: false
  };
}

function dirinfoDto(dir, tid, songs, subscribed) {
  dir = dir || {};
  var dirid = Number(dir.dirid || 0);
  var owned = Number(dir.owndir || 0) === 1;
  return {
    id: String(tid),
    name: String(dir.title || ""),
    description: String(dir.desc || ""),
    artworkUrl: secureUrl(dir.picurl || dir.picurl2 || ""),
    owner: ownerRef(dir.host_uin, dir.host_nick),
    trackCount: Number(dir.songnum || (songs || []).length || 0),
    playCount: Number(dir.listennum || 0),
    subscribed: !owned && !!subscribed,
    owned: owned,
    mutable: owned,
    deletable: owned && dirid !== FAV_DIR_ID,
    songs: songs || []
  };
}

function ownPlaylistDto(raw) {
  raw = raw || {};
  var dirid = Number(raw.dirId || 0);
  return {
    id: String(raw.tid || ""),
    name: String(raw.dirName || ""),
    description: String(raw.desc || ""),
    artworkUrl: secureUrl(raw.picUrl || raw.bigpicUrl || raw.albumPicUrl || ""),
    owner: ownerRef(raw.uin, raw.nick),
    trackCount: Number(raw.songNum || 0),
    playCount: Number(raw.play_cnt || 0),
    subscribed: false, owned: true,
    mutable: true, deletable: dirid !== FAV_DIR_ID
  };
}

function favPlaylistDto(raw) {
  raw = raw || {};
  return {
    id: String(raw.tid || ""),
    name: String(raw.name || raw.dirName || ""),
    description: String(raw.desc || ""),
    artworkUrl: secureUrl(raw.logo || raw.picUrl || raw.albumPicUrl || ""),
    owner: ownerRef(raw.uin, raw.nickname || raw.nick),
    trackCount: Number(raw.songnum || raw.songNum || 0),
    playCount: 0,
    subscribed: true, owned: false,
    mutable: false, deletable: false
  };
}

// ---- 搜索 ------------------------------------------------------------------

function pageFromCursor(cursor, pageSize) {
  var offset = parseInt(cursor, 10);
  if (isNaN(offset) || offset < 0) offset = 0;
  return Math.floor(offset / pageSize) + 1;
}

function nextCursor(page, pageSize, total, got) {
  var totalNum = Number(total || 0);
  if (totalNum > 0) return page * pageSize < totalNum ? String(page * pageSize) : "";
  return got >= pageSize ? String(page * pageSize) : "";
}

function searchSongs(args) {
  var page = pageFromCursor(args.cursor, SEARCH_PAGE_SIZE);
  var url = SEARCH_HOST + "/soso/fcgi-bin/search_for_qq_cp?w="
    + encodeURIComponent(args.query || "")
    + "&format=json&p=" + page + "&n=" + SEARCH_PAGE_SIZE;
  return httpGetJson(url, REF_SEARCH, UA_MOBILE).then(function (body) {
    var data = (body.data || {}).song || {};
    var items = songsOf(data.list);
    return {
      items: items,
      nextCursor: nextCursor(page, SEARCH_PAGE_SIZE, data.totalnum, items.length)
    };
  });
}

function searchAlbums(args) {
  var page = pageFromCursor(args.cursor, SEARCH_PAGE_SIZE);
  var url = SEARCH_HOST + "/soso/fcgi-bin/client_search_cp?w="
    + encodeURIComponent(args.query || "")
    + "&format=json&p=" + page + "&n=" + SEARCH_PAGE_SIZE + "&cr=1&g_tk=5381&t=8";
  return httpGetJson(url, REF_SEARCH, UA_MOBILE).then(function (body) {
    var data = (body.data || {}).album || {};
    var items = (data.list || []).map(searchAlbumDto).filter(function (item) {
      return item.id && item.name;
    });
    return {
      items: items,
      nextCursor: nextCursor(page, SEARCH_PAGE_SIZE, data.totalnum, items.length)
    };
  });
}

function searchArtists(args) {
  var page = pageFromCursor(args.cursor, SEARCH_PAGE_SIZE);
  var url = SEARCH_HOST + "/soso/fcgi-bin/client_search_cp?w="
    + encodeURIComponent(args.query || "")
    + "&format=json&p=" + page + "&n=" + SEARCH_PAGE_SIZE + "&cr=1&g_tk=5381&t=9";
  return httpGetJson(url, REF_SEARCH, UA_MOBILE).then(function (body) {
    var data = (body.data || {}).singer || {};
    var items = (data.list || []).map(searchArtistDto).filter(function (item) {
      return item.id && item.name;
    });
    return {
      items: items,
      nextCursor: nextCursor(page, SEARCH_PAGE_SIZE, data.totalnum, items.length)
    };
  });
}

function searchPlaylists(args) {
  var page = pageFromCursor(args.cursor, SEARCH_PAGE_SIZE);
  var url = SEARCH_HOST + "/soso/fcgi-bin/client_music_search_songlist?remoteplace=txt.yqq.playlist"
    + "&page_no=" + (page - 1)
    + "&num_per_page=" + SEARCH_PAGE_SIZE
    + "&query=" + encodeURIComponent(args.query || "");
  return httpGetText(url, REF_SEARCH, UA_MOBILE).then(function (text) {
    var body = parseLooseJson(text);
    var data = body.data || {};
    var items = (data.list || []).map(playlistDto).filter(function (item) {
      return item.id && item.name;
    });
    return {
      items: items,
      nextCursor: nextCursor(page, SEARCH_PAGE_SIZE, data.display_num, items.length)
    };
  });
}

// ---- 详情 ------------------------------------------------------------------

function songDetails(args) {
  var mids = (args.ids || []).filter(Boolean).slice(0, 500);
  if (!mids.length) return Promise.resolve([]);
  var out = [];
  var chunks = [];
  for (var i = 0; i < mids.length; i += 100) chunks.push(mids.slice(i, i + 100));
  return chunks.reduce(function (chain, chunk) {
    return chain.then(function () {
      var entries = {};
      chunk.forEach(function (mid, index) {
        entries["req_" + index] = {
          module: "music.pf_song_detail_svr",
          method: "get_song_detail_yqq",
          param: { song_mid: mid }
        };
      });
      return musicu(entries).then(function (body) {
        chunk.forEach(function (mid, index) {
          var data = body["req_" + index] && body["req_" + index].data;
          if (data && data.track_info) out.push(songDto(data.track_info));
        });
      });
    });
  }, Promise.resolve()).then(function () { return out; });
}

function dissPage(tid, begin, num) {
  return loadCookies().then(function (cookies) {
    return musicu({
      req: {
        module: "music.srfDissInfo.aiDissInfo",
        method: "uniform_get_Dissinfo",
        param: {
          disstid: Number(tid), userinfo: 1, tag: 1, orderlist: 1,
          song_begin: begin, song_num: num, onlysonglist: begin > 0 ? 1 : 0,
          enc_host_uin: String(cookies.euin || "")
        }
      }
    });
  }).then(function (body) {
    var node = body.req || {};
    if (Number(node.code || 0) !== 0) throw new Error("歌单加载失败(" + node.code + ")");
    return node.data || {};
  });
}

function favTids() {
  return requireUin().then(function (uin) {
    if (!uin) return [];
    return musicu({
      fav: {
        module: "music.musicasset.PlaylistFavRead",
        method: "GetPlaylistFavInfo",
        param: { uin: uin, offset: 0, size: 200 }
      }
    }).then(function (body) {
      return ((body.fav && body.fav.data || {}).v_list || []).map(function (item) {
        return String((item || {}).tid || "");
      });
    }, function () { return []; });
  });
}

function playlistDetails(args) {
  var tid = String(args.id || "");
  if (!tid) throw new Error("缺少歌单 ID");
  return Promise.all([dissPage(tid, 0, DISS_PAGE), favTids()]).then(function (both) {
    var first = both[0];
    var subscribed = both[1].indexOf(tid) >= 0;
    var dir = first.dirinfo || {};
    var songs = (first.songlist || []).slice();
    var total = Math.min(MAX_PLAYLIST_SONGS,
      Number(dir.songnum || first.total_song_num || songs.length || 0));
    var offsets = [];
    for (var begin = songs.length; begin > 0 && begin < total; begin += DISS_PAGE) {
      offsets.push(begin);
    }
    return offsets.reduce(function (chain, offset) {
      return chain.then(function () {
        return dissPage(tid, offset, DISS_PAGE).then(function (page) {
          songs = songs.concat(page.songlist || []);
        });
      });
    }, Promise.resolve()).then(function () {
      return dirinfoDto(dir, tid, songsOf(songs), subscribed);
    });
  });
}

function requireUin() {
  return loadCookies().then(function (cookies) {
    var uin = musicUin(cookies);
    return musicKey(cookies) && uin !== "0" ? uin : "";
  });
}

function artistDetails(args) {
  var mid = String(args.id || "");
  if (!mid) throw new Error("缺少歌手 ID");
  var limit = Math.min(100, Math.max(1, Number(args.limit || 50)));
  return musicu({
    info: {
      module: "music.musichallSinger.SingerInfoInter",
      method: "GetSingerDetail",
      param: { singer_mids: [mid], pic: 1, group_singer: 1, wiki_singer: 1, ex_singer: 1 }
    },
    songs: {
      module: "musichall.song_list_server",
      method: "GetSingerSongList",
      param: { singerMid: mid, begin: 0, num: limit, order: 1 }
    },
    albums: {
      module: "music.musichallAlbum.AlbumListServer",
      method: "GetAlbumList",
      param: { singerMid: mid, begin: 0, num: limit, order: 1 }
    }
  }).then(function (body) {
    var singer = ((body.info && body.info.data || {}).singer_list || [])[0] || {};
    var basic = singer.basic_info || {};
    var extra = singer.ex_info || {};
    var songData = body.songs && body.songs.data || {};
    var albumData = body.albums && body.albums.data || {};
    var songs = songsOf(songData.songList, function (row) { return (row || {}).songInfo; });
    var albums = (albumData.albumList || []).map(function (row) { return albumDto(row, null); });
    return {
      id: mid,
      name: String(basic.name || ""),
      artworkUrl: secureUrl(photoUrl("T001", basic.singer_pmid || mid, 300)),
      artworkThumbUrl: secureUrl(photoUrl("T001", basic.singer_pmid || mid, 150)),
      description: String(extra.desc || ""),
      albumCount: Number(albumData.total || albums.length || 0),
      songCount: Number(songData.totalNum || songs.length || 0),
      songs: songs,
      albums: albums
    };
  });
}

function albumDetails(args) {
  var mid = String(args.id || "");
  if (!mid) throw new Error("缺少专辑 ID");
  return musicu({
    info: {
      module: "music.musichallAlbum.AlbumInfoServer",
      method: "GetAlbumDetail",
      param: { albumMid: mid }
    },
    songs: {
      module: "music.musichallAlbum.AlbumSongList",
      method: "GetAlbumSongList",
      param: { albumMid: mid, begin: 0, num: 100, order: 1 }
    }
  }).then(function (body) {
    var basic = (body.info && body.info.data || {}).basicInfo || {};
    var songData = body.songs && body.songs.data || {};
    var songs = songsOf(songData.songList, function (row) { return (row || {}).songInfo; });
    if (!basic.albumMid) basic.albumMid = mid;
    if (!basic.totalNum) basic.totalNum = songData.totalNum;
    return albumDto(basic, songs);
  });
}

// ---- 首页、每日推荐与推荐歌曲 ----------------------------------------------

function findDailyCard(cards) {
  for (var i = 0; i < (cards || []).length; i++) {
    var card = cards[i] || {};
    var title = String(card.title || "");
    var id = String(card.id || "");
    if (id && (title.indexOf("每日") >= 0 || title.indexOf("30首") >= 0)) return id;
  }
  return "";
}

function findDailyTid(body) {
  var data = body.feed && body.feed.data || {};
  var shelves = data.v_shelf || [];
  for (var i = 0; i < shelves.length; i++) {
    var shelf = shelves[i] || {};
    var direct = findDailyCard(shelf.v_card || []);
    if (direct) return direct;
    var niches = shelf.v_niche || [];
    for (var j = 0; j < niches.length; j++) {
      var found = findDailyCard((niches[j] || {}).v_card || []);
      if (found) return found;
    }
  }
  return "";
}

function hotSongs(limit) {
  var count = clampNumber(limit, 1, 100);
  var url = SEARCH_HOST + "/v8/fcg-bin/fcg_v8_toplist_cp.fcg?topid=26&page=detail&type=top"
    + "&song_begin=0&song_num=" + count
    + "&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=1";
  return httpGetJson(url, REF_BASE, UA_PC).then(function (body) {
    var rows = body.songlist || [];
    var list = rows.map(function (row) { return row.data || row; });
    return songsOf(list).slice(0, count);
  }, function () { return []; });
}

function radarSongs(limit) {
  limit = clampNumber(limit, 1, 100);
  return requireUin().then(function (uin) {
    if (!uin) return [];
    var out = [];
    var seen = {};
    function loadPage(page) {
      return musicu({
        radar: {
          module: "music.recommend.TrackRelationServer",
          method: "GetRadarSong",
          param: {
            LastToastTime: Date.now(),
            NeedNum: 149,
            Page: page,
            ReqType: 0
          }
        }
      }).then(function (body) {
        var node = body.radar || {};
        if (Number(node.code || 0) !== 0) return false;
        var rows = (node.data || {}).VecSongs || [];
        if (!rows.length) return false;
        var added = 0;
        for (var i = 0; i < rows.length; i++) {
          var track = (rows[i] || {}).Track || (rows[i] || {}).track || rows[i];
          var dto = songDto(track);
          if (dto.id && !seen[dto.id]) {
            seen[dto.id] = true;
            out.push(dto);
            added++;
          }
        }
        if (out.length >= limit || !added || page >= 10) return false;
        return loadPage(page + 1);
      }, function () { return false; });
    }
    return loadPage(1).then(function () {
      return out.slice(0, limit);
    });
  });
}

function recommendedSongs(limit) {
  limit = clampNumber(limit, 1, 100);
  return requireUin().then(function (uin) {
    if (!uin) return hotSongs(limit);
    return radarSongs(limit).then(function (songs) {
      return songs.length ? songs : hotSongs(limit);
    });
  }, function () { return hotSongs(limit); });
}

function dailyRecommendSongs(limit) {
  limit = clampNumber(limit, 1, 500);
  return requireUin().then(function (uin) {
    if (!uin) return hotSongs(Math.min(limit, 30));
    return musicu({
      feed: {
        module: "music.recommend.RecommendFeed",
        method: "get_recommend_feed",
        param: { direction: 0, page: 1, v_cache: [], v_uniq: [], s_num: 0 }
      }
    }).then(function (body) {
      var tid = findDailyTid(body);
      if (!tid) throw new Error("未找到每日推荐");
      return dissPage(tid, 0, Math.min(500, limit)).then(function (data) {
        var songs = songsOf(data.songlist).slice(0, limit);
        return songs.length ? songs : hotSongs(Math.min(limit, 30));
      });
    }).catch(function () {
      return recommendedSongs(limit).then(function (songs) {
        return songs.length ? songs : hotSongs(Math.min(limit, 30));
      });
    });
  }, function () {
    return hotSongs(Math.min(limit, 30));
  });
}

function hotRecommendPlaylists(limit) {
  return musicu({
    recomPlaylist: {
      module: "playlist.HotRecommendServer",
      method: "get_hot_recommend",
      param: { async: 1, cmd: 2 }
    }
  }).then(function (body) {
    var data = body.recomPlaylist && body.recomPlaylist.data || {};
    return (data.v_hot || []).map(playlistDto).filter(function (item) {
      return item.id && item.name;
    }).slice(0, limit);
  }, function () { return []; });
}

function homePlaylists(limit) {
  return musicu({
    square: {
      module: "music.playlist.PlaylistSquare",
      method: "GetRecommendFeed",
      param: { cmd: 2, category_id: 10000000, size: Math.min(50, limit) }
    }
  }).then(function (body) {
    var node = body.square || {};
    if (Number(node.code || 0) !== 0) return hotRecommendPlaylists(limit);
    var list = ((node.data || {}).List || []).map(squareDto).filter(function (item) {
      return item.id && item.name;
    });
    return list.length ? list.slice(0, limit) : hotRecommendPlaylists(limit);
  }, function () {
    return hotRecommendPlaylists(limit);
  });
}

function home(args) {
  if (args && args.operation === "recommendSongs") {
    return dailyRecommendSongs(30);
  }
  var limit = clampNumber(Number(args && args.limit || 12), 1, 100);
  return Promise.all([
    homePlaylists(limit).catch(function () { return []; }),
    recommendedSongs(30).catch(function () { return []; })
  ]).then(function (both) {
    return { songs: both[1], playlists: both[0] };
  });
}

// ---- 最近播放与心动推荐 ----------------------------------------------------

function resolveSong(mid) {
  if (songCache[mid]) return Promise.resolve(songCache[mid]);
  return songDetails({ ids: [mid] }).then(function (list) {
    return list[0] || songCache[mid] || null;
  }, function () { return null; });
}

function scrobble(args) {
  var mid = String(args.id || "");
  if (!mid) return true;
  return resolveSong(mid).then(function (song) {
    if (!song) return true;
    return call("storage.get", { key: "recent" }).then(function (raw) {
      var list = [];
      try { list = JSON.parse(raw || "[]"); } catch (_) { list = []; }
      var out = [song];
      for (var i = 0; i < list.length; i++) {
        var item = list[i] || {};
        if (String(item.id || "") && String(item.id) !== mid) out.push(item);
        if (out.length >= 100) break;
      }
      return call("storage.put", { key: "recent", value: JSON.stringify(out) });
    });
  }).then(function () { return true; }, function () { return true; });
}

function recent(args) {
  var limit = clampNumber(Number(args && args.limit || 100), 1, 500);
  return call("storage.get", { key: "recent" }).then(function (raw) {
    var list = [];
    try { list = JSON.parse(raw || "[]"); } catch (_) { list = []; }
    return list.slice(0, limit);
  }, function () { return []; });
}

function heartRecommendation(args) {
  var limit = clampNumber(Number(args && args.limit || 50), 1, 100);
  var current = String(args && args.songId || "");
  return recommendedSongs(limit + 1).then(function (songs) {
    var out = [];
    for (var i = 0; i < songs.length && out.length < limit; i++) {
      if (songs[i].id !== current) out.push(songs[i]);
    }
    return out;
  });
}

// ---- 用户歌单、收藏与写入 --------------------------------------------------

function userPlaylists(args) {
  var limit = clampNumber(Number(args.limit || 100), 1, 500);
  return requireUin().then(function (uin) {
    if (!uin) return [];
    return musicu({
      mine: {
        module: "music.musicasset.PlaylistBaseRead",
        method: "GetPlaylistByUin",
        param: { uin: uin }
      },
      fav: {
        module: "music.musicasset.PlaylistFavRead",
        method: "GetPlaylistFavInfo",
        param: { uin: uin, offset: 0, size: Math.min(200, limit) }
      }
    }).then(function (body) {
      var out = [];
      var mine = (body.mine && body.mine.data || {}).v_playlist || [];
      mine.forEach(function (item) {
        var dto = ownPlaylistDto(item);
        if (dto.id && dto.name) {
          if (Number((item || {}).dirId || 0) === FAV_DIR_ID) out.unshift(dto);
          else out.push(dto);
        }
      });
      var fav = (body.fav && body.fav.data || {}).v_list || [];
      fav.forEach(function (item) {
        var dto = favPlaylistDto(item);
        if (dto.id && dto.name) out.push(dto);
      });
      return out.slice(0, limit);
    });
  }, function () { return []; });
}

function playlistDirInfo(tid) {
  var wanted = String(tid || "");
  return requireUin().then(function (uin) {
    if (!uin) throw new Error("请先登录 QQ 音乐");
    return musicu({
      mine: {
        module: "music.musicasset.PlaylistBaseRead",
        method: "GetPlaylistByUin",
        param: { uin: uin }
      }
    }).then(function (body) {
      var list = (body.mine && body.mine.data || {}).v_playlist || [];
      for (var i = 0; i < list.length; i++) {
        var item = list[i] || {};
        if (String(item.tid || "") === wanted) {
          return {
            dirId: Number(item.dirId || 0),
            name: String(item.dirName || ""),
            desc: String(item.desc || "")
          };
        }
      }
      throw new Error("这个歌单不是你创建的，无法修改");
    });
  });
}

function dirIdForTid(tid) {
  var wanted = String(tid || "");
  return requireUin().then(function (uin) {
    if (!uin) throw new Error("请先登录 QQ 音乐");
    return musicu({
      mine: {
        module: "music.musicasset.PlaylistBaseRead",
        method: "GetPlaylistByUin",
        param: { uin: uin }
      }
    }).then(function (body) {
      var list = (body.mine && body.mine.data || {}).v_playlist || [];
      for (var i = 0; i < list.length; i++) {
        if (String((list[i] || {}).tid || "") === wanted) return Number(list[i].dirId || 0);
      }
      throw new Error("这个歌单不是你创建的，无法修改");
    });
  });
}

function favPlaylistTid() {
  return requireUin().then(function (uin) {
    if (!uin) return 0;
    return musicu({
      mine: {
        module: "music.musicasset.PlaylistBaseRead",
        method: "GetPlaylistByUin",
        param: { uin: uin }
      }
    }).then(function (body) {
      var list = (body.mine && body.mine.data || {}).v_playlist || [];
      for (var i = 0; i < list.length; i++) {
        if (Number((list[i] || {}).dirId || 0) === FAV_DIR_ID) return Number(list[i].tid || 0);
      }
      return 0;
    });
  });
}

function songNumericId(mid) {
  var key = String(mid || "");
  if (!key) return Promise.reject(new Error("缺少歌曲 ID"));
  if (numericIds[key]) return Promise.resolve(numericIds[key]);
  return songDetails({ ids: [key] }).then(function () {
    if (numericIds[key]) return numericIds[key];
    throw new Error("无法解析歌曲编号");
  });
}

function songNumericIds(mids) {
  var missing = [];
  for (var i = 0; i < mids.length; i++) {
    if (!numericIds[String(mids[i])]) missing.push(String(mids[i]));
  }
  var prepare = missing.length
    ? songDetails({ ids: missing })
    : Promise.resolve([]);
  return prepare.then(function () {
    return mids.map(function (mid) {
      var id = numericIds[String(mid)];
      if (!id) throw new Error("无法解析歌曲编号: " + mid);
      return id;
    });
  });
}

function writeFailure(code, action) {
  if (Number(code) === 1000) return new Error("QQ 音乐登录已失效，请重新登录");
  if (Number(code) === 80105) return new Error(action + "失败，请稍后重试");
  return new Error(action + "失败(" + code + ")");
}

function like(args) {
  switch (args.operation) {
    case "list":
      return favPlaylistTid().then(function (tid) {
        if (!tid) return [];
        return dissPage(tid, 0, DISS_PAGE).then(function (data) {
          var total = Math.min(MAX_PLAYLIST_SONGS,
            Number((data.dirinfo || {}).songnum || 0));
          var songs = (data.songlist || []).slice();
          var offsets = [];
          for (var begin = songs.length; begin > 0 && begin < total; begin += DISS_PAGE) {
            offsets.push(begin);
          }
          return offsets.reduce(function (chain, offset) {
            return chain.then(function () {
              return dissPage(tid, offset, DISS_PAGE).then(function (page) {
                songs = songs.concat(page.songlist || []);
              });
            });
          }, Promise.resolve()).then(function () {
            return songs.map(function (song) {
              rememberNumericId((song || {}).mid, (song || {}).id);
              return String((song || {}).mid || "");
            }).filter(Boolean);
          });
        });
      });
    case "set":
      return songNumericId(args.id).then(function (songId) {
        return writeSonglist(FAV_DIR_ID, [songId], args.liked !== false);
      });
    default:
      throw new Error("未知收藏操作");
  }
}

function writeSonglist(dirId, songIds, add) {
  var songs = songIds.map(function (id) { return { songId: Number(id), songType: 0 }; });
  return musicu({
    req: {
      module: "music.musicasset.PlaylistDetailWrite",
      method: add ? "AddSonglist" : "DelSonglist",
      param: { dirId: Number(dirId), v_songInfo: songs }
    }
  }, WRITE_COMM).then(function (body) {
    var node = body.req || {};
    if (Number(node.code || 0) !== 0) throw writeFailure(node.code, add ? "添加歌曲" : "移除歌曲");
    return true;
  });
}

function playlistMutation(args) {
  switch (args.operation) {
    case "create": {
      var name = String(args.name || "").trim();
      if (!name) throw new Error("歌单名称为空");
      return musicu({
        req: {
          module: "music.musicasset.PlaylistBaseWrite",
          method: "AddPlaylist",
          param: { dirName: name }
        }
      }, WRITE_COMM).then(function (body) {
        var node = body.req || {};
        if (Number(node.code || 0) !== 0) throw writeFailure(node.code, "创建歌单");
        var result = (node.data || {}).result || {};
        return { id: String(result.tid || "") };
      });
    }
    case "delete":
      return dirIdForTid(args.playlistId).then(function (dirId) {
        if (dirId === FAV_DIR_ID) throw new Error("「我喜欢」不能删除");
        return musicu({
          req: {
            module: "music.musicasset.PlaylistBaseWrite",
            method: "DelPlaylist",
            param: { dirId: dirId }
          }
        }, WRITE_COMM).then(function (body) {
          var node = body.req || {};
          if (Number(node.code || 0) !== 0) throw writeFailure(node.code, "删除歌单");
          return true;
        });
      });
    case "add":
    case "remove": {
      var adding = args.operation === "add";
      var mids = (args.songIds || []).filter(Boolean);
      if (!mids.length) return true;
      return dirIdForTid(args.playlistId).then(function (dirId) {
        return songNumericIds(mids).then(function (ids) {
          return writeSonglist(dirId, ids, adding);
        });
      });
    }
    case "subscribe":
    case "unsubscribe": {
      var tid = Number(args.playlistId || 0);
      if (!tid) throw new Error("缺少歌单 ID");
      var canceling = args.operation === "unsubscribe";
      return loadCookies().then(function (cookies) {
        var param = { uin: String(cookies.euin || ""), v_playlistId: [tid] };
        if (!canceling) param.opType = 1;
        return musicu({
          req: {
            module: "music.musicasset.PlaylistFavWrite",
            method: canceling ? "CancelFavPlaylist" : "FavPlaylist",
            param: param
          }
        }, WRITE_COMM);
      }).then(function (body) {
        var node = body.req || {};
        if (Number(node.code || 0) !== 0) {
          throw writeFailure(node.code, canceling ? "取消收藏" : "收藏歌单");
        }
        return true;
      });
    }
    default:
      throw new Error("未知歌单操作");
  }
}

// ---- 歌单封面与排序 --------------------------------------------------------

var UPLOAD_IMAGE = "https://c.y.qq.com/splcloud/fcgi-bin/fcg_upload_image.fcg";

function coverUploadKind(args) {
  var mime = String(args.mimeType || "").toLowerCase();
  var name = String(args.filename || "").toLowerCase();
  if (mime.indexOf("png") >= 0 || /\.png$/.test(name)) return { ext: "png", mime: "image/png", png: 1 };
  if (mime.indexOf("webp") >= 0 || /\.webp$/.test(name)) return { ext: "webp", mime: "image/webp", png: 0 };
  if (mime.indexOf("gif") >= 0 || /\.gif$/.test(name)) return { ext: "gif", mime: "image/gif", png: 0 };
  return { ext: "jpg", mime: "image/jpeg", png: 0 };
}

function cookieHeader(cookies) {
  var parts = [];
  Object.keys(cookies || {}).forEach(function (name) {
    if (cookies[name]) parts.push(encodeURIComponent(name) + "=" + encodeURIComponent(String(cookies[name])));
  });
  return parts.length ? parts.join("; ") : "";
}

function playlistCover(args) {
  var imageBase64 = String(args.imageBase64 || "");
  if (!imageBase64) throw new Error("图片为空");
  var kind = coverUploadKind(args);
  return Promise.all([playlistDirInfo(args.playlistId), requireUin(), loadCookies()])
    .then(function (all) {
      var dir = all[0];
      var uin = all[1];
      var cookies = all[2];
      if (!uin) throw new Error("请先登录 QQ 音乐");
      if (dir.dirId === FAV_DIR_ID) throw new Error("「我喜欢」是系统歌单，不支持更换封面");
      var headers = {
        "User-Agent": UA_PC,
        "Referer": "https://y.qq.com/portal/mymusic_edit.html?dirid=" + dir.dirId
      };
      var cookie = cookieHeader(cookies);
      if (cookie) headers["Cookie"] = cookie;
      return call("http.request", {
        url: UPLOAD_IMAGE,
        method: "POST",
        headers: headers,
        multipart: {
          fields: {
            auth_appid: "music_cover",
            parentid: "/",
            fileid: String(Date.now()),
            uin: String(uin),
            crop: "0",
            x: "0",
            y: "0",
            width: "0",
            height: "0",
            origin_size: "1",
            png: String(kind.png),
            picformat: kind.ext
          },
          file: {
            field: "data",
            filename: "cover." + kind.ext,
            mimeType: kind.mime,
            bodyBase64: imageBase64
          }
        },
        timeoutMs: 30000
      }).then(function (response) {
        if (response.status < 200 || response.status >= 300) {
          throw new Error("上传封面失败 HTTP " + response.status);
        }
        var data;
        try { data = parseLooseJson(response.body); }
        catch (_) { throw new Error("上传封面失败：响应无法解析"); }
        var nested = data.data || {};
        var imageUrl = String(data.imageurl || data.picurl || nested.imageurl || nested.picurl || "");
        if (Number(data.retcode || data.code || 0) !== 0 || !imageUrl) {
          throw new Error(data.msg || data.message || "上传封面失败");
        }
        return musicu({
          req: {
            module: "music.musicasset.PlaylistBaseWrite",
            method: "EditPlaylist",
            param: {
              dirId: dir.dirId, mask: 7,
              dirNewName: dir.name, dirNewDesc: dir.desc,
              dirNewPicUrl: secureUrl(imageUrl)
            }
          }
        }, WRITE_COMM).then(function (result) {
          var node = result.req || {};
          if (Number(node.code || 0) !== 0) throw writeFailure(node.code, "更换封面");
          return { success: true };
        });
      });
    });
}

var LIST_INFO = "https://c.y.qq.com/splcloud/fcgi-bin/fcg_musiclist_getinfo_cp.fcg";
var MODIFY_SONGLIST = "https://c.y.qq.com/splcloud/fcgi-bin/fcg_unified_modify_songlist.fcg";

function formBody(fields) {
  var parts = [];
  Object.keys(fields).forEach(function (name) {
    parts.push(encodeURIComponent(name) + "=" + encodeURIComponent(String(fields[name])));
  });
  return parts.join("&");
}

function parseLooseJson(text) {
  var body = String(text || "");
  var start = body.indexOf("{");
  var end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("响应无法解析");
  return JSON.parse(body.slice(start, end + 1));
}

function songlistInfo(uin, dirId) {
  return loadCookies().then(function (cookies) {
    var url = LIST_INFO + "?uin=" + encodeURIComponent(uin)
      + "&dirid=" + Number(dirId)
      + "&new=0&dirinfo=1&user=qqmusic&miniportal=1&fromDir2Diss=1&comPic=0&format=json";
    var headers = { "User-Agent": UA_PC, "Referer": REF_BASE };
    var cookie = cookieHeader(cookies);
    if (cookie) headers["Cookie"] = cookie;
    return call("http.request", {
      url: url, method: "GET", headers: headers, timeoutMs: 20000
    }).then(function (response) {
      if (response.status < 200 || response.status >= 300) {
        throw new Error("读取歌单信息失败 HTTP " + response.status);
      }
      var data = parseLooseJson(response.body);
      if (Number(data.code || 0) !== 0) throw new Error("读取歌单信息失败(" + data.code + ")");
      return data;
    });
  });
}

function songlistEntryType(entry) {
  var raw = Number((entry || {}).type || 0) % 10 === 1 ? entry : (entry || {}).data;
  raw = raw || {};
  var type = Number(raw.type || 0);
  var mtype = type !== 0 ? "net" : "qqmusic";
  if (type === 0 && Number((raw.action || {}).soso || 0) === 1) {
    type = 3;
    mtype = "net";
  }
  if (type === 111 || type === 112 || type === 113) mtype = "qqmusic";
  return (mtype === "qqmusic" || (mtype === "net" && type === 3)) ? 3 : 1;
}

function songlistEntryMid(entry) {
  var raw = Number((entry || {}).type || 0) % 10 === 1 ? entry : (entry || {}).data;
  return String((raw || {}).songmid || "");
}

function playlistReorder(args) {
  var wanted = (args.songIds || []).map(String);
  if (!wanted.length) throw new Error("歌曲列表为空");
  return Promise.all([dirIdForTid(args.playlistId), requireUin()]).then(function (both) {
    var dirId = both[0];
    var uin = both[1];
    if (!uin) throw new Error("请先登录 QQ 音乐");
    return songlistInfo(uin, dirId).then(function (info) {
      var title = String(info.Title || "");
      if (!title) throw new Error("读不到歌单名称，已放弃排序以免清空歌单信息");
      if (info.show === undefined || info.show === null) {
        throw new Error("读不到歌单可见性，已放弃排序以免清空歌单信息");
      }
      var tagIds;
      if (typeof info.tagList === "string") {
        tagIds = info.tagList;
      } else if (Object.prototype.toString.call(info.tags) === "[object Array]") {
        tagIds = info.tags.map(function (tag) { return String((tag || {}).id || ""); })
          .filter(Boolean).join(",");
      } else {
        throw new Error("读不到歌单标签，已放弃排序以免清空歌单信息");
      }

      var byMid = {};
      (info.SongList || []).forEach(function (entry) {
        var mid = songlistEntryMid(entry);
        if (mid) byMid[mid] = songlistEntryType(entry);
      });
      var mids = [];
      var types = [];
      for (var i = 0; i < wanted.length; i++) {
        var type = byMid[wanted[i]];
        if (type === undefined) throw new Error("歌单内容已变化，请刷新后重试");
        mids.push(wanted[i]);
        types.push(type);
      }
      if (mids.length !== (info.SongList || []).length) {
        throw new Error("歌单内容已变化，请刷新后重试");
      }

      var fields = {
        uin: String(uin),
        moddirnames: title.replace(/,/g, "，"),
        moddesc: String(info.Desc || ""),
        moddirids: Number(dirId),
        dirid: Number(dirId),
        modFPicUrl: String(info.PicUrl || ""),
        dir_pic_url2: String(info.DirPicUrl2 || ""),
        moddirshows: String(info.show),
        modtagidList: tagIds,
        ismodifylist: 1,
        mids: mids.join(","),
        types: types.join(","),
        source: 103,
        modnum: 1,
        formsender: 1
      };
      return loadCookies().then(function (cookies) {
        var headers = {
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
          "User-Agent": UA_PC,
          "Referer": REF_BASE
        };
        var cookie = cookieHeader(cookies);
        if (cookie) headers["Cookie"] = cookie;
        return call("http.request", {
          url: MODIFY_SONGLIST, method: "POST", headers: headers,
          body: formBody(fields), timeoutMs: 30000
        });
      }).then(function (response) {
        if (response.status < 200 || response.status >= 300) {
          throw new Error("保存排序失败 HTTP " + response.status);
        }
        var result = parseLooseJson(response.body);
        if (Number(result.code || 0) !== 0) throw new Error(result.msg || "保存排序失败(" + result.code + ")");
        return { success: true };
      });
    });
  });
}

// ---- 播放地址与歌词 --------------------------------------------------------

function streamFilenames(mid, quality) {
  var m500 = "M500" + mid + mid + ".mp3";
  var m800 = "M800" + mid + mid + ".mp3";
  var f000 = "F000" + mid + mid + ".flac";
  var q = String(quality || "exhigh");
  if (q === "standard") return [m500, m800];
  if (q === "lossless" || q === "hires") return [f000, m800, m500];
  return [m800, m500];
}

function streamMime(filename) {
  return String(filename || "").indexOf("F000") === 0 ? "audio/flac" : "audio/mpeg";
}

function resolveStream(args) {
  var mid = String(args.id || "");
  if (!mid) throw new Error("缺少歌曲 ID");
  var guid = String(Math.floor(1000000000 + Math.random() * 9000000000));
  var filenames = streamFilenames(mid, args.quality);
  var songmid = [];
  var songtype = [];
  for (var n = 0; n < filenames.length; n++) {
    songmid.push(mid);
    songtype.push(0);
  }
  return loadCookies().then(function (cookies) {
    var uin = musicKey(cookies) ? musicUin(cookies) : "0";
    return musicu({
      req_1: {
        module: "music.vkey.GetVkey",
        method: "UrlGetVkey",
        param: {
          guid: guid, songmid: songmid, songtype: songtype,
          uin: uin, loginflag: 1, platform: "20", filename: filenames
        }
      }
    });
  }).then(function (body) {
    var data = body.req_1 && body.req_1.data || {};
    var infos = data.midurlinfo || [];
    var found = null;
    for (var i = 0; i < filenames.length && !found; i++) {
      for (var j = 0; j < infos.length; j++) {
        var info = infos[j] || {};
        if (String(info.filename) === filenames[i] && info.purl) {
          found = { filename: filenames[i], purl: info.purl };
          break;
        }
      }
    }
    if (!found) {
      for (var k = 0; k < infos.length; k++) {
        if (infos[k] && infos[k].purl) {
          found = { filename: infos[k].filename || filenames[0], purl: infos[k].purl };
          break;
        }
      }
    }
    if (found) {
      return {
        url: STREAM_HOST + found.purl,
        headers: {},
        mimeType: streamMime(found.filename),
        expiresAtMs: Date.now() + 15 * 60 * 1000,
        trial: false,
        cacheable: true
      };
    }
    return loadCookies().then(function (cookies) {
      throw new Error(musicKey(cookies)
        ? "歌曲暂无可用播放地址（可能是 VIP 歌曲或无版权）"
        : "需要登录：请到 设置 → 音源插件 → QQ音乐 登录后播放");
    });
  }, function (error) {
    var text = error && error.message ? String(error.message) : String(error || "");
    if (/timed?\s*out|timeout|connect|reset|unreachable|network|ECONN|ETIMEDOUT|socket/i.test(text)) {
      throw new Error("官方音源暂时连不上，请稍后重试");
    }
    throw error;
  });
}

function lyrics(args) {
  var mid = String(args.id || "");
  if (!mid) return Promise.resolve({ assets: [] });
  return httpGetJson(SEARCH_HOST + "/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid="
    + encodeURIComponent(mid) + "&format=json&nobase64=1&g_tk=5381",
    REF_LYRIC, UA_MOBILE).then(function (body) {
    var assets = [];
    var lyric = String(body.lyric || "");
    var trans = String(body.trans || "").replace(/\/\//g, "");
    if (lyric) assets.push({ format: "lrc", role: "original", text: lyric });
    if (trans) assets.push({ format: "lrc", role: "translation", text: trans });
    return { assets: assets };
  });
}

// ---- 账号与分享 ------------------------------------------------------------

function account() {
  return Promise.all([loadCookies(), loadSession()]).then(function (both) {
    var cookies = both[0];
    var session = both[1] || {};
    var uin = musicUin(cookies);
    var key = musicKey(cookies);
    if (!key || uin === "0") return { loggedIn: false };
    var fallback = {
      loggedIn: true, id: uin,
      displayName: session.nick || ("QQ " + uin),
      avatarUrl: secureUrl(session.logo || ""),
      membershipTier: 0, level: 0, signature: ""
    };
    return musicu({
      info: {
        module: "userInfo.BaseUserInfoServer",
        method: "get_user_baseinfo_v2",
        param: { vec_uin: [uin] }
      },
      vip: {
        module: "userInfo.VipQueryServer",
        method: "SRFVipQuery_V2",
        param: { uin_list: [uin] }
      }
    }).then(function (body) {
      var profile = ((body.info && body.info.data || {}).map_userinfo || {})[uin] || {};
      var vip = ((body.vip && body.vip.data || {}).infoMap || {})[uin] || {};
      return {
        loggedIn: true, id: uin,
        displayName: profile.nick || fallback.displayName,
        avatarUrl: secureUrl(profile.headurl || session.logo || ""),
        membershipTier: Number(vip.iSuperVip || 0) ? 2 : (Number(vip.iVipFlag || 0) ? 1 : 0),
        level: Number(vip.iCurLevel || 0),
        signature: profile.desc || profile.mark || ""
      };
    }, function () { return fallback; });
  });
}

function share(args) {
  var id = encodeURIComponent(String(args.id || ""));
  var kind = String(args.kind || "song");
  if (kind === "song") return "https://y.qq.com/n/ryqq/songDetail/" + id;
  if (kind === "album") return "https://y.qq.com/n/ryqq/albumDetail/" + id;
  if (kind === "artist") return "https://y.qq.com/n/ryqq/singer/" + id;
  if (kind === "playlist") return "https://y.qq.com/n/ryqq/playlist/" + id;
  if (kind === "user") return "https://y.qq.com/n/ryqq/profile?uid=" + id;
  return "https://y.qq.com/";
}

// ---- 登录 ------------------------------------------------------------------

function qqBeginChallenge() {
  var query = formEncode({
    appid: QQ_APPID, e: 2, l: "M", s: 3, d: 72, v: 4, t: Math.random(),
    daid: QQ_DAID, pt_3rd_aid: QQ_PT_3RD_AID
  });
  return httpRaw("GET", PTQRSHOW + "?" + query, { referer: REF_XUI, base64: true })
    .then(function (response) {
      if (response.status < 200 || response.status >= 300) {
        throw new Error("获取二维码失败: HTTP " + response.status);
      }
      var qrsig = setCookieValue(response.setCookies, "qrsig");
      var png = String(response.bodyBase64 || "");
      if (!qrsig || !png) throw new Error("未能获取登录二维码");
      return {
        id: qrsig, methodId: "qqqr", status: "waiting",
        qrImageBase64: png,
        expiresAtMs: Date.now() + 5 * 60 * 1000
      };
    });
}

function qqPollOnce(qrsig) {
  var params = formEncode({
    u1: "https://graph.qq.com/oauth2.0/login_jump", ptqrtoken: hash33(qrsig),
    ptredirect: 0, h: 1, t: 1, g: 1, from_ui: 1, ptlang: 2052,
    action: "0-0-" + Date.now(), js_ver: 20102616, js_type: 1, pt_uistyle: 40,
    aid: QQ_APPID, daid: QQ_DAID, pt_3rd_aid: QQ_PT_3RD_AID, has_onekey: 1
  });
  return httpRaw("GET", PTQRLOGIN + "?" + params,
    { referer: REF_XUI, cookie: "qrsig=" + qrsig, timeoutMs: 20000 }).then(function (response) {
    var args = [];
    var re = /'((?:\\.|[^'])*)'/g, m;
    while ((m = re.exec(String(response.body || "")))) args.push(m[1]);
    if (!args.length) return { status: "waiting" };
    switch (args[0]) {
      case "0": return { status: "success", url: args[2] || "" };
      case "67": return { status: "scanned" };
      case "65": return { status: "expired" };
      case "68": return { status: "failed", message: "已在手机上取消登录" };
      default: return { status: "waiting" };
    }
  });
}

function headerValue(headers, name) {
  var key = Object.keys(headers || {}).filter(function (k) {
    return k.toLowerCase() === name.toLowerCase();
  })[0];
  return key ? headers[key] : "";
}

function qqAuthorize(uin, ptsigx) {
  var checkSigParams = formEncode({
    uin: uin, pttype: 1, service: "ptqrlogin", nodirect: 0, ptsigx: ptsigx,
    s_url: "https://graph.qq.com/oauth2.0/login_jump", ptlang: 2052, ptredirect: 100,
    aid: QQ_APPID, daid: QQ_DAID, j_later: 0, low_login_hour: 0, regmaster: 0,
    pt_login_type: 3, pt_aid: 0, pt_aaid: 16, pt_light: 0, pt_3rd_aid: QQ_PT_3RD_AID
  });
  return httpRaw("GET", CHECK_SIG + "?" + checkSigParams, { referer: REF_XUI, followRedirects: false })
    .then(function (checkSigResp) {
      var pSkey = setCookieValue(checkSigResp.setCookies, "p_skey");
      if (!pSkey) throw new Error("登录会话建立失败(未取得 p_skey)");
      var authorizeBody = formEncode({
        response_type: "code", client_id: QQ_PT_3RD_AID, redirect_uri: QQ_REDIRECT_URI,
        scope: "get_user_info,get_app_friends", state: "state", switch: "", from_ptlogin: 1,
        src: 1, update_auth: 1, openapi: "1010_1030", g_tk: gtk(pSkey),
        auth_time: Date.now(), ui: uuid4()
      });
      return httpRaw("POST", OAUTH_AUTHORIZE, {
        referer: REF_XUI, followRedirects: false,
        contentType: "application/x-www-form-urlencoded", body: authorizeBody,
        cookie: cookieHeaderFromSetCookies(checkSigResp.setCookies)
      });
    }).then(function (authorizeResp) {
      var location = headerValue(authorizeResp.headers, "Location");
      var match = /[?&]code=([^&]+)/.exec(location || "");
      if (!match) throw new Error("登录换取凭据失败(未取得 code)");
      return qqExchangeCode(decodeURIComponent(match[1]));
    });
}

function qqExchangeCode(code) {
  return httpPostJson(MUSICU, {
    comm: { tmeLoginType: 2, format: "json", inCharset: "utf-8", outCharset: "utf-8" },
    req_1: { module: "QQConnectLogin.LoginServer", method: "QQLogin", param: { code: code } }
  }, REF_BASE).then(function (body) {
    var data = body.req_1 && body.req_1.data || {};
    var key = String(data.musickey || "");
    var id = String(data.musicid || data.str_musicid || data.uin || "");
    if (!key || !id) throw new Error("QQ 登录未返回有效凭据");
    var cookies = {
      uin: id, musicid: id, musickey: key, qqmusic_key: key, qm_keyst: key
    };
    var session = {
      loginType: Number(data.loginType || 2),
      refreshToken: String(data.refresh_token || ""),
      unionid: String(data.unionid || ""),
      nick: String(data.nick || data.nickname || ""),
      logo: String(data.logo || data.headurl || "")
    };
    return call("credentials.put", { key: "cookies", value: JSON.stringify(cookies) })
      .then(function () { return saveSession(session); })
      .then(function () {
        return {
          loggedIn: true, id: id,
          displayName: session.nick || ("QQ " + id),
          avatarUrl: session.logo, membershipTier: 0, level: 0, signature: ""
        };
      });
  });
}

function login(args) {
  switch (args.operation) {
    case "methods":
      return [{
        id: "qqqr", type: "qr", label: "QQ 扫码",
        instructions: "打开手机 QQ，「扫一扫」这个二维码即可登录。"
      }, {
        id: "web", type: "web", label: "QQ / 微信登录",
        instructions: "打开 QQ 音乐官方登录页，用 QQ 或微信登录后自动返回。",
        webUrl: "https://y.qq.com/portal/profile.html",
        cookieUrl: "https://y.qq.com",
        credentialCookieName: "qm_keyst"
      }, {
        id: "cookie", type: "credential", label: "Cookie",
        instructions: "在 QQ 音乐客户端/网页登录后，复制含 musickey 的 Cookie；插件会提取 musickey 与 uin 并加密保存。",
        credentialLabel: "QQ 音乐 Cookie"
      }];
    case "begin":
      if (args.methodId !== "qqqr") throw new Error("该登录方式不需要创建挑战");
      return qqBeginChallenge();
    case "poll": {
      var qrsig = String(args.challengeId || "");
      if (!qrsig) throw new Error("缺少登录挑战 ID");
      var waiting = { id: qrsig, methodId: "qqqr", status: "waiting" };
      return qqPollOnce(qrsig).then(function (result) {
        if (result.status === "scanned" || result.status === "expired") {
          return { id: qrsig, methodId: "qqqr", status: result.status };
        }
        if (result.status === "failed") {
          return { id: qrsig, methodId: "qqqr", status: "failed", message: result.message || "" };
        }
        if (result.status === "success") {
          var uinMatch = /[?&]uin=([^&]+)/.exec(result.url || "");
          var sigxMatch = /[?&]ptsigx=([^&]+)/.exec(result.url || "");
          if (!uinMatch || !sigxMatch) {
            return { id: qrsig, methodId: "qqqr", status: "failed", message: "登录响应缺少必要参数" };
          }
          return qqAuthorize(decodeURIComponent(uinMatch[1]), decodeURIComponent(sigxMatch[1]))
            .then(function (profile) {
              return { id: qrsig, methodId: "qqqr", status: "success", account: profile };
            }, function (error) {
              return {
                id: qrsig, methodId: "qqqr", status: "failed",
                message: String(error && error.message || error)
              };
            });
        }
        return waiting;
      }, function () { return waiting; });
    }
    case "submit": {
      var cookieStr = String(args.credential || "");
      if (!cookieStr) return { methodId: args.methodId, status: "failed", message: "Cookie 为空" };
      var parsed = {};
      cookieStr.split(";").forEach(function (part) {
        var at = part.indexOf("=");
        if (at <= 0) return;
        var name = part.slice(0, at).trim();
        var value = part.slice(at + 1).trim();
        if (!name) return;
        try {
          parsed[decodeURIComponent(name)] = decodeURIComponent(value);
        } catch (_) {
          parsed[name] = value;
        }
      });
      var uin = musicUin(parsed);
      var key = musicKey(parsed);
      if (!key) {
        return {
          methodId: args.methodId, status: "failed",
          message: "Cookie 中找不到 musickey/qm_keyst/qqmusic_key"
        };
      }
      return call("credentials.put", { key: "cookies", value: JSON.stringify(parsed) })
        .then(function () { return call("credentials.delete", { key: "session" }); },
              function () { return call("credentials.delete", { key: "session" }); })
        .then(function () { return account(); }, function () { return null; })
        .then(function (profile) {
          return {
            methodId: args.methodId, status: "success",
            account: profile && profile.loggedIn ? profile
              : {
                  loggedIn: true, id: uin, displayName: "QQ " + uin,
                  avatarUrl: "", membershipTier: 0, level: 0, signature: ""
                }
          };
        });
    }
    case "logout":
      return call("credentials.delete", { key: "cookies" })
        .then(function () { return call("credentials.delete", { key: "session" }); },
              function () { return call("credentials.delete", { key: "session" }); })
        .then(function () { return true; }, function () { return true; });
    default:
      throw new Error("未知登录操作");
  }
}

// ---- 导出 ------------------------------------------------------------------

module.exports = {
  handlers: {
    searchSongs: searchSongs,
    searchAlbums: searchAlbums,
    searchArtists: searchArtists,
    searchPlaylists: searchPlaylists,
    songDetails: songDetails,
    playlistDetails: playlistDetails,
    albumDetails: albumDetails,
    artistDetails: artistDetails,
    home: home,
    recent: recent,
    userPlaylists: userPlaylists,
    resolveStream: resolveStream,
    lyrics: lyrics,
    account: account,
    login: login,
    like: like,
    playlistMutation: playlistMutation,
    playlistReorder: playlistReorder,
    playlistCover: playlistCover,
    scrobble: scrobble,
    heartRecommendation: heartRecommendation,
    share: share
  }
};
