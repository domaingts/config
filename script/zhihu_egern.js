// Egern new JS API rewrite of the Zhihu "哲也同学" script
// Docs used: Egern JS API export default / ctx.request / ctx.response / ctx.storage / ctx.notify / ctx.respond
// This version removes the old MagicJS compatibility layer and uses the native Egern runtime API.

const STORAGE_KEYS = {
  blockedUsers: "zheye.blockedUsers",
  currentUserInfo: "zheye.currentUserInfo",
  keywordBlock: "zheye.keywordBlock",
  blackAnswersId: "zheye.blackAnswersId",
  serverUrl: "zheye.serverUrl",
};

const SETTINGS_KEYS = {
  appTabs: "zhihu_settings_app_conf",
  blockedKeywords: "zhihu_settings_blocked_keywords",
  blockedUsers: "zhihu_settings_blocked_users",
  recommendStream: "zhihu_settings_recommend_stream",
  removeArticle: "zhihu_settings_remove_article",
  removeAdvertorial: "zhihu_settings_remove_advertorial",
  removePin: "zhihu_settings_remove_pin",
  checkPaidContent: "zhihu_settings_check_paid_content",
  requestContent: "zhihu_settings_request_content",
  marketingMsg: "zhihu_settings_marketing_msg",
  hotList: "zhihu_settings_hot_list",
  presetWords: "zhihu_settings_preset_words",
  customTags: "zhihu_settings_custom_tags",
};

const DEFAULT_ANSWER_BLOCKED_USERS = ["会员推荐", "盐选推荐"];
const KEYWORD_MAX_COUNT = 1000;
const MASKED_AVATAR = "https://picx.zhimg.com/v2-abed1a8c04700ba7d72b45195223e0ff_xll.jpg";

export default async function (ctx) {
  const { request, response } = ctx;
  const url = request?.url || "";
  const method = (request?.method || "GET").toUpperCase();

  if (response) {
    return await handleResponse(ctx, url, method);
  }

  if (request) {
    return await handleRequest(ctx, url, method);
  }

  cleanup(ctx);
}

async function handleRequest(ctx, url, method) {
  if (/^https:\/\/api\.zhihu\.com\/feed-root\/block/.test(url)) {
    return await unlockBlockedKeywords(ctx, method);
  }
}

async function handleResponse(ctx, url, method) {
  if (/^https:\/\/api\.zhihu\.com\/people\/self$/.test(url)) {
    return await processUserInfo(ctx);
  }

  if (/^https:\/\/api\.zhihu\.com\/root\/tab\/v2/.test(url)) {
    return await modifyAppTabConfig(ctx);
  }

  if (/^https:\/\/(api|web-render)\.zhihu\.com\/topstory\/recommend/.test(url)) {
    return await removeRecommend(ctx);
  }

  if (/^https:\/\/api\.zhihu\.com\/questions\/\d+\/feeds/.test(url)) {
    return await removeQuestions(ctx);
  }

  if (/^https:\/\/api\.zhihu\.com\/next-render\?/.test(url)) {
    return await modifyAnswersNextRender(ctx);
  }

  if (/^https:\/\/api\.zhihu\.com\/notifications\/v3\/message/.test(url)) {
    return await removeMarketingMsg(ctx);
  }

  if (/^https:\/\/api\.zhihu\.com\/comment_v5\/(answers|pins|comments?|articles)\/\d+\/(root|child)_comment/.test(url)) {
    return await removeComment(ctx);
  }

  if (
    /^https:\/\/(page-info|api)\.zhihu\.com\/(answers|articles)\/v2\/\d+/.test(url) ||
    /^https:\/\/api\.zhihu\.com\/articles\/v\d\/\d+/.test(url)
  ) {
    return await removeAnswerOrArticleAd(ctx);
  }

  if (/^https:\/\/api\.zhihu\.com\/people\/\d+/.test(url)) {
    return await autoInsertBlackList(ctx);
  }

  if (/^https:\/\/api\.zhihu\.com\/moments_v3\?/.test(url)) {
    return await removeMoments(ctx);
  }

  if (/^https?:\/\/api\.zhihu\.com\/topstory\/hot-lists/.test(url)) {
    return await removeHotListAds(ctx);
  }

  if (/^https:\/\/api\.zhihu\.com\/search\/preset_words/.test(url)) {
    return await removeKeywordAds(ctx);
  }

  if (/^https:\/\/api\.zhihu\.com\/search\/recommend_query/.test(url)) {
    return await removeQueryAds(ctx);
  }

  if (/^https:\/\/api\.zhihu\.com\/settings\/blocked_users/.test(url)) {
    return await manageBlackUser(ctx, method);
  }
}

function cleanup(ctx) {
  ctx.storage.delete(STORAGE_KEYS.currentUserInfo);
  ctx.storage.delete(STORAGE_KEYS.blockedUsers);
  ctx.storage.delete(STORAGE_KEYS.keywordBlock);
  ctx.notify({ title: "哲也同学", body: "数据清理完毕" });
}

function getSetting(ctx, key, fallback) {
  const value = ctx.storage.getJSON(key);
  return value === null ? fallback : value;
}

function getUserInfo(ctx) {
  const fallback = { id: "default", is_vip: false };
  const data = ctx.storage.getJSON(STORAGE_KEYS.currentUserInfo);
  if (!data || typeof data !== "object") return fallback;
  return {
    id: data.id || fallback.id,
    is_vip: Boolean(data.is_vip),
  };
}

function scopedKey(baseKey, userId) {
  return `${baseKey}:${userId}`;
}

function getScopedJSON(ctx, baseKey, userId, fallback) {
  const value = ctx.storage.getJSON(scopedKey(baseKey, userId));
  return value === null ? fallback : value;
}

function setScopedJSON(ctx, baseKey, userId, value) {
  ctx.storage.setJSON(scopedKey(baseKey, userId), value);
}

async function parseResponseJSON(ctx) {
  if (!ctx.response) return null;
  try {
    return await ctx.response.json();
  } catch {
    return null;
  }
}

async function parseResponseText(ctx) {
  if (!ctx.response) return "";
  try {
    return await ctx.response.text();
  } catch {
    return "";
  }
}

async function parseRequestText(ctx) {
  if (!ctx.request) return "";
  try {
    return await ctx.request.text();
  } catch {
    return "";
  }
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return {
    status,
    headers: {
      "Content-Type": "application/json;charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate, private, max-age=0",
      Pragma: "no-cache",
      ...extraHeaders,
    },
    body,
  };
}

async function modifyAppTabConfig(ctx) {
  if (getSetting(ctx, SETTINGS_KEYS.appTabs, false) === false) return;

  const body = await parseResponseJSON(ctx);
  if (!body) return;

  const allowedTabs = ["follow", "recommend", "hot"];
  body.tab_list = (body.tab_list || []).filter((tab) => allowedTabs.includes(tab.tab_type));
  return { body };
}

async function unlockBlockedKeywords(ctx, method) {
  if (getSetting(ctx, SETTINGS_KEYS.blockedKeywords, true) === false) return;

  const user = getUserInfo(ctx);
  const localKeywords = getScopedJSON(ctx, STORAGE_KEYS.keywordBlock, user.id, []);

  if (method === "GET") {
    return ctx.respond(
      jsonResponse({
        success: true,
        is_vip: true,
        kw_min_length: 2,
        kw_max_length: 100,
        kw_max_count: KEYWORD_MAX_COUNT,
        data: localKeywords,
      })
    );
  }

  if (method === "POST") {
    const requestText = await parseRequestText(ctx);
    const keyword = decodeKeywordFromBody(requestText);

    if (localKeywords.includes(keyword)) {
      return ctx.respond(
        jsonResponse(
          { error: { message: "关键词已存在", code: 100002 } },
          400
        )
      );
    }

    localKeywords.push(keyword);
    setScopedJSON(ctx, STORAGE_KEYS.keywordBlock, user.id, localKeywords);
    return ctx.respond(jsonResponse({ success: true }));
  }

  if (method === "DELETE") {
    const keyword = decodeKeywordFromUrl(ctx.request.url);
    const nextKeywords = localKeywords.filter((item) => item !== keyword);
    setScopedJSON(ctx, STORAGE_KEYS.keywordBlock, user.id, nextKeywords);
    return ctx.respond(jsonResponse({ success: true }));
  }
}

function decodeKeywordFromBody(body) {
  try {
    const text = decodeURIComponent(body || "");
    const match = text.match(/keyword=(.*)/);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function decodeKeywordFromUrl(url) {
  try {
    const text = decodeURIComponent(url || "");
    const match = text.match(/keyword=(.*)/);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

async function processUserInfo(ctx) {
  const body = await parseResponseJSON(ctx);
  if (!body) return;

  ctx.storage.setJSON(STORAGE_KEYS.blackAnswersId, []);

  if (!body?.id || body?.vip_info?.is_vip === undefined) {
    return;
  }

  ctx.storage.setJSON(STORAGE_KEYS.currentUserInfo, {
    id: body.id,
    is_vip: body.vip_info.is_vip ?? false,
  });

  if (getSetting(ctx, SETTINGS_KEYS.blockedKeywords, true) !== false && body.vip_info.is_vip === false) {
    body.vip_info.is_vip = true;
    body.vip_info.vip_type = 2;
    body.vip_info.vip_icon = {
      url: "https://picx.zhimg.com/v2-aa8a1823abfc46f14136f01d55224925.jpg?source=88ceefae",
      night_mode_url: "https://picx.zhimg.com/v2-aa8a1823abfc46f14136f01d55224925.jpg?source=88ceefae",
    };
    return { body };
  }
}

async function manageBlackUser(ctx, method) {
  const user = getUserInfo(ctx);
  let blockedUsers = getScopedJSON(ctx, STORAGE_KEYS.blockedUsers, user.id, {});
  if (!blockedUsers || typeof blockedUsers !== "object") blockedUsers = {};

  const builtin = {};
  for (const name of DEFAULT_ANSWER_BLOCKED_USERS) {
    builtin[name] = "00000000000000000000000000000000";
    blockedUsers[name] = builtin[name];
  }

  const body = await parseResponseJSON(ctx);
  if (!body) return;

  if (method === "GET") {
    if (!ctx.request.url.includes("offset")) {
      blockedUsers = { ...builtin };
      ctx.notify({
        title: "哲也同学",
        body: "开始同步黑名单数据，请滑动至黑名单末尾，直至弹出“同步成功”的通知。",
      });
    }

    for (const entry of body.data || []) {
      const { name, id } = entry || {};
      if (name && id && name !== "[已重置]") {
        blockedUsers[name] = id;
      }
    }

    setScopedJSON(ctx, STORAGE_KEYS.blockedUsers, user.id, blockedUsers);

    if (body?.paging?.is_end) {
      ctx.notify({
        title: "哲也同学",
        body: `同步黑名单数据成功！当前黑名单共${Object.keys(blockedUsers).length - DEFAULT_ANSWER_BLOCKED_USERS.length}人。脚本内置黑名单${DEFAULT_ANSWER_BLOCKED_USERS.length}人。`,
      });
    }
    return;
  }

  if (method === "POST") {
    const { name, id } = body;
    if (name && id) {
      blockedUsers[name] = id;
      setScopedJSON(ctx, STORAGE_KEYS.blockedUsers, user.id, blockedUsers);
      ctx.notify({ title: "哲也同学", body: `已将用户“${name}”写入脚本黑名单。` });
    }
    return;
  }

  if (method === "DELETE" && body.success) {
    const match = ctx.request.url.match(/^https:\/\/api\.zhihu\.com\/settings\/blocked_users\/([0-9a-zA-Z]*)/);
    const deletedId = match?.[1];
    if (deletedId) {
      for (const [name, id] of Object.entries(blockedUsers)) {
        if (id === deletedId) {
          delete blockedUsers[name];
          setScopedJSON(ctx, STORAGE_KEYS.blockedUsers, user.id, blockedUsers);
          ctx.notify({ title: "哲也同学", body: `已将用户“${name}”移出脚本黑名单！` });
          break;
        }
      }
    }
  }
}

async function autoInsertBlackList(ctx) {
  if (getSetting(ctx, SETTINGS_KEYS.blockedUsers, true) === false) return;

  const body = await parseResponseJSON(ctx);
  if (!body) return;

  if (body.name && body.id && body.is_blocking === true) {
    const user = getUserInfo(ctx);
    const blockedUsers = getScopedJSON(ctx, STORAGE_KEYS.blockedUsers, user.id, {});

    if (!blockedUsers[body.name]) {
      blockedUsers[body.name] = body.id;
      setScopedJSON(ctx, STORAGE_KEYS.blockedUsers, user.id, blockedUsers);
      ctx.notify({ title: "哲也同学", body: `已自动将用户“${body.name}”写入脚本黑名单。` });
    }
  }

  return { body };
}

async function removeMoments(ctx) {
  const enabled = getSetting(ctx, SETTINGS_KEYS.blockedUsers, false);
  if (enabled === false) return;

  const body = await parseResponseJSON(ctx);
  if (!body) return;

  const user = getUserInfo(ctx);
  const blockedUsers = getScopedJSON(ctx, STORAGE_KEYS.blockedUsers, user.id, {});

  body.data = (body.data || []).filter((item) => {
    const authorName = item?.target?.author;
    return !(authorName && Object.prototype.hasOwnProperty.call(blockedUsers, authorName));
  });

  return { body };
}

function getAllTagConfigs(ctx) {
  let customConfig = {};
  const configText = getSetting(ctx, SETTINGS_KEYS.customTags, "");

  try {
    customConfig = String(configText)
      .split(";")
      .filter(Boolean)
      .map((item) => item.split(":"))
      .reduce((acc, pair) => {
        if (pair.length === 2) acc[pair[0]] = pair[1];
        return acc;
      }, {});
  } catch {
    customConfig = {};
  }

  return {
    "付费内容": "查看完整内容|查看全部章节",
    "营销推广": "ad-link-card|xg.zhihu.com|营销平台",
    "购物推广": "mcn-link-card",
    ...customConfig,
  };
}

function isFiltered(item, rawText, settings, blockedKeywords, blockedUsers) {
  if (
    item?.type === "market_card" ||
    item?.type === "feed_advert" ||
    item?.extra?.type === "SvipActivity" ||
    rawText.includes("盐选推荐") ||
    Object.prototype.hasOwnProperty.call(item || {}, "ad")
  ) {
    return true;
  }

  if (settings.removeAdvertorial && (item?.promotion_extra || rawText.includes(" · 商品介绍"))) {
    return true;
  }

  if (settings.removeArticle && /"type"\s*:\s*"article"/i.test(rawText)) {
    return true;
  }

  if (settings.recommendStream && /"(type|style|content_type)"\s*:\s*"(zvideo|BIG_IMAGE|drama|StyleVideo)"/i.test(rawText)) {
    return true;
  }

  if (settings.removePin && /type"\s*:\s*"pin"/i.test(rawText)) {
    return true;
  }

  if (settings.blockedKeywords && blockedKeywords.length > 0) {
    if (blockedKeywords.some((keyword) => keyword && rawText.includes(keyword))) {
      return true;
    }
  }

  if (settings.blockedUsers && Object.keys(blockedUsers).length > 0) {
    const authorName =
      item?.children
        ?.find((child) => child.type === "Line" && child.style === "LineAuthor_default")
        ?.elements?.find((element) => element.type === "Text")?.text || "";
    if (authorName && Object.prototype.hasOwnProperty.call(blockedUsers, authorName)) {
      return true;
    }
  }

  return false;
}

async function removeRecommend(ctx) {
  const settings = {
    recommendStream: getSetting(ctx, SETTINGS_KEYS.recommendStream, false),
    removeArticle: getSetting(ctx, SETTINGS_KEYS.removeArticle, false),
    removeAdvertorial: getSetting(ctx, SETTINGS_KEYS.removeAdvertorial, true),
    removePin: getSetting(ctx, SETTINGS_KEYS.removePin, true),
    blockedUsers: getSetting(ctx, SETTINGS_KEYS.blockedUsers, false),
    blockedKeywords: getSetting(ctx, SETTINGS_KEYS.blockedKeywords, true),
    checkPaidContent: getSetting(ctx, SETTINGS_KEYS.checkPaidContent, false),
    requestContent: getSetting(ctx, SETTINGS_KEYS.requestContent, "local"),
  };

  const body = await parseResponseJSON(ctx);
  if (!body) return;

  const user = getUserInfo(ctx);
  const blockedKeywords = settings.blockedKeywords
    ? getScopedJSON(ctx, STORAGE_KEYS.keywordBlock, user.id, [])
    : [];
  const blockedUsers = settings.blockedUsers
    ? getScopedJSON(ctx, STORAGE_KEYS.blockedUsers, user.id, {})
    : {};

  body.data = (body.data || []).filter(
    (item) => !isFiltered(item, JSON.stringify(item), settings, blockedKeywords, blockedUsers)
  );

  if (body.fresh_text) {
    const count = parseInt((body.fresh_text.match(/\d+/) || ["0"])[0], 10);
    body.fresh_text = count > 0 ? `刷新 ${count} 条内容，过滤后剩余 ${body.data.length} 条` : `过滤后剩余 ${body.data.length} 条`;
  }

  return { body };
}

async function removeQuestions(ctx) {
  const body = await parseResponseJSON(ctx);
  if (!body) return;

  delete body.ad_info;

  const user = getUserInfo(ctx);
  const blockedUsers = getScopedJSON(ctx, STORAGE_KEYS.blockedUsers, user.id, {});
  const enableBlockedUsers = getSetting(ctx, SETTINGS_KEYS.blockedUsers, false);
  const blackAnswerIds = ctx.storage.getJSON(STORAGE_KEYS.blackAnswersId) || [];

  body.data = (body.data || []).filter((entry) => {
    const answerId = entry?.target?.id;
    const authorName = entry?.target?.author?.name || "";
    const blocked = enableBlockedUsers && Object.prototype.hasOwnProperty.call(blockedUsers, authorName);

    if (entry?.target) {
      entry.target.visible_only_to_author = false;
      entry.target.is_visible = true;
      entry.target.is_copyable = true;
    }

    if (blocked && answerId !== undefined && !blackAnswerIds.includes(String(answerId))) {
      blackAnswerIds.push(String(answerId));
    }

    return !blocked;
  });

  ctx.storage.setJSON(STORAGE_KEYS.blackAnswersId, blackAnswerIds);
  return { body };
}

function insertContentTipFromObject(ctx, body, rawText) {
  const tagConfig = getAllTagConfigs(ctx);

  if (body?.endorsement) {
    for (const [tagName, pattern] of Object.entries(tagConfig)) {
      if (new RegExp(pattern).test(rawText)) {
        body.endorsement.unshift({
          action_url: "https://github.com/blackmatrix7/ios_rule_script/tree/master/script/zheye",
          background_color: { alpha: 0.1, group: "GBL01A" },
          elements: [{
            content: tagName,
            font_color: { alpha: 1, group: "GBL07A" },
            font_size: 13,
            is_bold: true,
            max_line: 1,
            type: "TEXT",
          }],
          sub_elements: [],
          sub_elements_type: "DESCRIPTION",
          za: { block_text: "ThanksForInvitingLabel", text: "", type: "text" },
        });
        break;
      }
    }
  } else if (body?.content_card_list) {
    for (const [tagName, pattern] of Object.entries(tagConfig)) {
      if (new RegExp(pattern).test(rawText)) {
        body.content_card_list.unshift({
          card_type: "km-paid-answer-header",
          dynamic_id: ":km-sku-card-head",
          extra_info: `{"title_line":{"scene":"ANSWER_DETAIL","copyright":"${tagName}","style":"v2","content_type":"ANSWER"}}`,
        });
        break;
      }
    }
  }

  return body;
}

async function removeComment(ctx) {
  const body = await parseResponseJSON(ctx);
  if (!body) return;

  body.ad_info = {};
  if (!getSetting(ctx, SETTINGS_KEYS.blockedUsers, false)) return { body };

  const { id } = getUserInfo(ctx);
  const blockedUsers = getScopedJSON(ctx, STORAGE_KEYS.blockedUsers, id, {});

  const anonymizeComment = (comment) => {
    comment.is_delete = true;
    comment.can_reply = false;
    comment.can_like = false;
    if (!comment.author) comment.author = {};
    comment.author.name = "[黑名单用户]";
    comment.author.avatar_url = MASKED_AVATAR;
    comment.author.exposed_medal = {};
  };

  const anonymizeReplyTarget = (author) => {
    if (!author) return;
    author.name = "[黑名单用户]";
    author.avatar_url = MASKED_AVATAR;
    author.exposed_medal = {};
  };

  const processComments = (comments = []) =>
    comments.map((comment) => {
      const authorName = comment?.author?.name || "";
      const replyToName = comment?.reply_to_author?.name || "";
      if (blockedUsers[authorName]) anonymizeComment(comment);
      if (blockedUsers[replyToName]) anonymizeReplyTarget(comment.reply_to_author);
      if (comment.child_comments) comment.child_comments = processComments(comment.child_comments);
      return comment;
    });

  if (body.root?.author?.name && blockedUsers[body.root.author.name]) {
    anonymizeComment(body.root);
  }

  if (body.data) {
    body.data = processComments(body.data);
  }

  return { body };
}

async function removeMarketingMsg(ctx) {
  if (getSetting(ctx, SETTINGS_KEYS.marketingMsg, true) === false) return;

  const body = await parseResponseJSON(ctx);
  if (!body) return;

  for (const item of body.column_head || []) {
    if (item?.id === "column_head_entry_invite") {
      item.text = `您有${item.unread_count}条新的邀请回答`;
      item.unread_count = 0;
    }
  }

  const hiddenTitles = ["超赞包小助手", "知乎活动助手", "考研记事本", "创作者小助手"];
  body.data = (body.data || []).reduce((list, item) => {
    const title = item?.content?.title || item?.detail_title;

    if (title === "官方账号消息") {
      const unread = item?.unread_count || 0;
      item.content.text = unread > 0 ? `未读消息${unread}条` : "全部消息已读";
      item.is_read = true;
      item.unread_count = 0;
    }

    if (!hiddenTitles.includes(title)) list.push(item);
    return list;
  }, []);

  return { body };
}

async function removeHotListAds(ctx) {
  if (getSetting(ctx, SETTINGS_KEYS.hotList, true) === false) return;

  const body = await parseResponseJSON(ctx);
  if (!body) return;

  if (Array.isArray(body.data)) {
    body.data = body.data.filter((item) => item.type === "hot_list_feed" || item.type === "hot_list_feed_video");
  }
  return { body };
}

async function removeKeywordAds(ctx) {
  if (getSetting(ctx, SETTINGS_KEYS.presetWords, true) === false) return;

  const body = await parseResponseJSON(ctx);
  if (!body?.preset_words?.words) return;

  body.preset_words.words = body.preset_words.words.filter((item) => item.type === "general");
  return { body };
}

async function removeQueryAds(ctx) {
  const body = await parseResponseJSON(ctx);
  if (!body?.recommend_queries?.queries) return;

  body.recommend_queries.queries = body.recommend_queries.queries.filter(
    (item) => !Object.prototype.hasOwnProperty.call(item, "ad_commercial_json")
  );
  return { body };
}

async function modifyAnswersNextRender(ctx) {
  const body = await parseResponseJSON(ctx);
  if (!body) return;

  const user = getUserInfo(ctx);
  const enableBlockedUsers = getSetting(ctx, SETTINGS_KEYS.blockedUsers, false);
  const blockedUsers = enableBlockedUsers ? getScopedJSON(ctx, STORAGE_KEYS.blockedUsers, user.id, {}) : {};

  body.data = (body.data || []).filter((item) => {
    const adInfo = item?.ad_info || {};
    const bizTypeList = item?.biz_type_list || [];
    const type = item?.type || "";
    const adjson = item?.adjson || "";
    const fullname = item?.author?.fullname || "";

    const isAd = Boolean(
      adInfo?.data ||
      bizTypeList.length !== 1 ||
      bizTypeList[0] !== "answer" ||
      type === "ad" ||
      adjson
    );

    const isBlocked = enableBlockedUsers && Object.prototype.hasOwnProperty.call(blockedUsers, fullname);
    return !(isAd || isBlocked);
  });

  return { body };
}

async function removeAnswerOrArticleAd(ctx) {
  const body = await parseResponseJSON(ctx);
  const rawText = JSON.stringify(body || {});
  if (!body) return;

  insertContentTipFromObject(ctx, body, rawText);
  delete body.third_business;
  return { body };
}
