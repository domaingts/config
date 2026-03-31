const SCRIPT_NAME = "哲也同学";

const STORAGE_KEYS = {
  blockedUsers: "zhihu_blocked_users",
  currentUserInfo: "zhihu_current_userinfo",
  keywordBlock: "zhihu_keyword_block",
  blackAnswersId: "zhihu_black_answers",
  serverUrl: "zheye_server_url",
};

const DEFAULT_ANSWER_BLOCKED_USERS = ["会员推荐", "盐选推荐"];
const KEYWORD_MAX_COUNT = 1000;

const $ = MagicJS(SCRIPT_NAME, "INFO");

function urlMatches(pattern) {
  return new RegExp(pattern).test($.request.url);
}

function getUserInfo() {
  const fallback = { id: "default", is_vip: false };

  try {
    const { id = fallback.id, is_vip = fallback.is_vip } = $.data.read(
      STORAGE_KEYS.currentUserInfo,
      {}
    );
    return { id, is_vip };
  } catch (error) {
    $.logger.error(`获取用户信息出现异常：${error}`);
    return fallback;
  }
}

function modifyAppTabConfig() {
  try {
    if ($.data.read("zhihu_settings_app_conf", false) === false) {
      return null;
    }

    const body = JSON.parse($.response.body);
    const allowedTabs = ["follow", "recommend", "hot"];

    body.tab_list = body.tab_list?.filter((tab) => allowedTabs.includes(tab.tab_type)) || [];

    $.logger.debug(`修改推荐页Tab：${JSON.stringify(body)}`);
    return { body: JSON.stringify(body) };
  } catch (error) {
    $.logger.error(`移除推荐页Tab出现异常：${error}`);
  }
}

function buildKeywordResponse(body, statusLine) {
  const headers = {
    "Cache-Control": "no-cache, no-store, must-revalidate, private, max-age=0",
    Connection: "keep-alive",
    "Content-Type": "application/json;charset=utf-8",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer-when-downgrade",
    Server: "CLOUD ELB 1.0.0",
    Vary: "Accept-Encoding",
    "X-Cache-Lookup": "Cache Miss",
    "x-cdn-provider": "tencent",
  };

  if ($.env.isQuanX) {
    return { body, headers, status: statusLine };
  }

  return {
    response: {
      body,
      headers,
      status: {
        "HTTP/1.1 200 OK": 200,
        "HTTP/1.1 400 Bad Request": 400,
      }[statusLine],
    },
  };
}

function unlockBlockedKeywords() {
  try {
    if ($.data.read("zhihu_settings_blocked_keywords", true) === false) {
      return null;
    }

    const user = getUserInfo();
    const localKeywords = $.data.read(STORAGE_KEYS.keywordBlock, null, user.id) || [];

    let match = decodeURIComponent($.request.body).match(/keyword=(.*)/);
    let keyword = match ? match[1] : "";

    $.logger.debug(`准备操作本地关键词：${keyword}`);

    if ($.request.method === "GET") {
      const body = JSON.stringify({
        success: true,
        is_vip: true,
        kw_min_length: 2,
        kw_max_length: 100,
        kw_max_count: KEYWORD_MAX_COUNT,
        data: localKeywords,
      });

      $.logger.debug(`获取本地脚本屏蔽关键词：\n${localKeywords.join("、")}`);
      return buildKeywordResponse(body, "HTTP/1.1 200 OK");
    }

    if ($.request.method === "POST") {
      if (localKeywords.includes(keyword)) {
        return buildKeywordResponse(
          JSON.stringify({
            error: { message: "关键词已存在", code: 100002 },
          }),
          "HTTP/1.1 400 Bad Request"
        );
      }

      localKeywords.push(keyword);
      $.data.write(STORAGE_KEYS.keywordBlock, localKeywords, user.id);

      $.logger.debug(`添加本地脚本屏蔽关键词“${keyword}”`);
      return buildKeywordResponse(JSON.stringify({ success: true }), "HTTP/1.1 200 OK");
    }

    if ($.request.method === "DELETE") {
      match = decodeURIComponent($.request.url).match(/keyword=(.*)/);
      keyword = match ? match[1] : "";

      const filteredKeywords = localKeywords.filter((item) => item !== keyword);
      $.data.write(STORAGE_KEYS.keywordBlock, filteredKeywords, user.id);

      $.logger.debug(`删除本地脚本屏蔽关键词：“${keyword}”`);
      return buildKeywordResponse(JSON.stringify({ success: true }), "HTTP/1.1 200 OK");
    }
  } catch (error) {
    $.logger.error(`关键词屏蔽操作出现异常：${error}`);
  }
}

function processUserInfo() {
  try {
    const body = JSON.parse($.response.body);
    $.data.write(STORAGE_KEYS.blackAnswersId, []);

    if (!body?.id || body?.vip_info?.is_vip === undefined) {
      $.logger.warning("没有获取到本次登录用户信息，如未对功能造成影响，请忽略此日志。");
      return null;
    }

    const userInfo = {
      id: body.id,
      is_vip: body.vip_info.is_vip ?? false,
    };
    $.data.write(STORAGE_KEYS.currentUserInfo, userInfo);

    if (
      $.data.read("zhihu_settings_blocked_keywords") !== false &&
      body.vip_info.is_vip === false
    ) {
      body.vip_info.is_vip = true;
      body.vip_info.vip_type = 2;
      body.vip_info.vip_icon = {
        url: "https://picx.zhimg.com/v2-aa8a1823abfc46f14136f01d55224925.jpg?source=88ceefae",
        night_mode_url:
          "https://picx.zhimg.com/v2-aa8a1823abfc46f14136f01d55224925.jpg?source=88ceefae",
      };

      return { body: JSON.stringify(body) };
    }
  } catch (error) {
    $.logger.error(`获取当前用户信息出现异常：${error}`);
    return null;
  }
}

function manageBlackUser() {
  const user = getUserInfo();
  const builtinUsers = {};

  let blockedUsers = $.data.read(STORAGE_KEYS.blockedUsers, "", user.id);
  blockedUsers = typeof blockedUsers === "object" ? blockedUsers : {};

  DEFAULT_ANSWER_BLOCKED_USERS.forEach((name) => {
    blockedUsers[name] = builtinUsers[name] = "00000000000000000000000000000000";
  });

  $.logger.debug(`当前用户id：${user.id}，脚本黑名单：${JSON.stringify(blockedUsers)}`);

  try {
    if ($.request.method === "GET") {
      if (!$.request.url.includes("offset")) {
        blockedUsers = builtinUsers;
        $.logger.debug("脚本黑名单已清空，请滑动至黑名单末尾保证重新获取完成。");
        $.notification.post(
          "开始同步黑名单数据，请滑动至黑名单末尾，直至弹出“同步成功”的通知。"
        );
      }

      const body = JSON.parse($.response.body);
      body?.data?.forEach(({ name, id }) => {
        if (name !== "[已重置]" && name && id) {
          blockedUsers[name] = id;
        }
      });

      $.data.write(STORAGE_KEYS.blockedUsers, blockedUsers, user.id);

      if (body?.paging?.is_end) {
        $.notification.post(
          `同步黑名单数据成功！当前黑名单共${Object.keys(blockedUsers).length - DEFAULT_ANSWER_BLOCKED_USERS.length}人。\n脚本内置黑名单${DEFAULT_ANSWER_BLOCKED_USERS.length}人。`
        );
        $.logger.debug(`脚本黑名单内容：${JSON.stringify(blockedUsers)}。`);
      }
    } else if ($.request.method === "POST") {
      const { name, id } = JSON.parse($.response.body);
      if (name && id) {
        blockedUsers[name] = id;
        $.data.write(STORAGE_KEYS.blockedUsers, blockedUsers, user.id);
        $.logger.debug(`${name}写入脚本黑名单成功，当前脚本黑名单数据：${JSON.stringify(blockedUsers)}`);
        $.notification.post(`已将用户“${name}”写入脚本黑名单。`);
      }
    } else if ($.request.method === "DELETE") {
      if (JSON.parse($.response.body).success) {
        const matched = $.request.url.match(
          /^https:\/\/api\.zhihu\.com\/settings\/blocked_users\/([0-9a-zA-Z]*)/
        );
        const deletedId = matched?.[1];

        if (deletedId) {
          for (const name in blockedUsers) {
            if (blockedUsers[name] === deletedId) {
              delete blockedUsers[name];
              $.data.write(STORAGE_KEYS.blockedUsers, blockedUsers, user.id);
              $.logger.debug(`${name}移出脚本黑名单成功，当前脚本黑名单数据：${JSON.stringify(blockedUsers)}`);
              $.notification.post(`已将用户“${name}”移出脚本黑名单！`);
              break;
            }
          }
        }
      }
    }
  } catch (error) {
    $.logger.error(`操作黑名单失败，异常信息：${error}`);
    $.notification.post("操作黑名单失败，执行异常，请查阅日志。");
  }
}

function autoInsertBlackList() {
  try {
    if ($.data.read("zhihu_settings_blocked_users", true) === false) {
      return null;
    }

    const body = JSON.parse($.response.body);

    if (body.name && body.id && body.is_blocking === true) {
      const user = getUserInfo();
      let blockedUsers = $.data.read(STORAGE_KEYS.blockedUsers, "", user.id);
      blockedUsers = (typeof blockedUsers === "object" && blockedUsers) ?? {};

      if (!blockedUsers[body.name]) {
        $.logger.debug(`当前需要加入黑名单的用户Id：${body.id}，用户名：${body.name}`);
        blockedUsers[body.name] = body.id;
        $.data.write(STORAGE_KEYS.blockedUsers, blockedUsers, user.id);
        $.logger.debug(`${body.name}写入脚本黑名单成功，当前脚本黑名单数据：${JSON.stringify(blockedUsers)}`);
        $.notification.post(`已自动将用户“${body.name}”写入脚本黑名单。`);
      }
    }

    return { body: JSON.stringify(body) };
  } catch (error) {
    $.logger.error(`去除MCN信息出现异常：${error}`);
  }
}

function removeMoments() {
  try {
    const enabled = $.data.read("zhihu_settings_blocked_users", false);
    if (enabled === false) {
      return null;
    }

    const body = JSON.parse($.response?.body || "{}");
    const user = getUserInfo();
    const blockedUsers = $.data.read(STORAGE_KEYS.blockedUsers, {}, user.id) || {};

    body.data =
      body.data?.filter((item) => {
        const authorName = item.target?.author;
        return !(enabled && authorName && blockedUsers.hasOwnProperty(authorName));
      }) || [];

    return { body: JSON.stringify(body) };
  } catch (error) {
    $.logger.error(`关注列表去广告出现异常：${error}`);
  }
}

function prependRecommendTag(card, text) {
  if (card?.common_card?.footline?.elements) {
    card.common_card.footline.elements.unshift({
      tag: {
        color: "MapText06A",
        text,
        type: "MASK_BORDER",
      },
    });
  }
}

function getAllTagConfigs() {
  let customConfig = {};

  try {
    const configText = $.data.read("zhihu_settings_custom_tags", "");
    $.logger.debug(`自定义标签配置：${configText}`);

    customConfig = configText
      .split(";")
      .filter((item) => item.trim() !== "")
      .map((item) => item.split(":"))
      .reduce((accumulator, pair) => {
        if (pair.length !== 2) {
          $.logger.error(`自定义标签配置错误：${pair.join(":")}`);
        } else {
          accumulator[pair[0]] = pair[1];
        }
        return accumulator;
      }, {});

    const mergedConfig = {
      "付费内容": "查看完整内容|查看全部章节",
      "营销推广": "ad-link-card|xg.zhihu.com|营销平台",
      "购物推广": "mcn-link-card",
      ...customConfig,
    };

    $.logger.debug(`合并后的标签配置：${JSON.stringify(mergedConfig)}`);
    return mergedConfig;
  } catch (error) {
    $.notification.post("推荐页设置自定义标签出现异常，请检查标签配置");
    $.logger.error(`推荐页设置自定义标签出现异常，请检查标签配置：${error}`);
  }

  return customConfig;
}

async function setContentTagByCloud(links, cards) {
  const serverUrl = $.data.read(STORAGE_KEYS.serverUrl);

  if (!serverUrl) {
    $.notification.post("未设置服务端地址，无法进行内容探测。\n请配置服务端地址，或使用本地探测。");
    return;
  }

  $.logger.debug(`向云端请求以下链接\n${links.join("\n")}`);

  const apiUrl = `${serverUrl}/api/v1.1/answer/links`;
  $.logger.debug(`服务端地址\n${apiUrl}`);

  const payload = {
    links,
    custom_tags: getAllTagConfigs(),
  };

  await $.http
    .post({
      url: apiUrl,
      headers: { "Content-Type": "application/json" },
      body: payload,
    })
    .then((response) => {
      $.logger.debug(`云端探测结果<${typeof response.body}>\n${JSON.stringify(response.body)}`);
      for (let index = 0; index < response.body.length; index++) {
        try {
          const tag = response.body[index];
          if (tag !== "") {
            prependRecommendTag(cards[index], tag);
          }
        } catch (error) {
          $.logger.error(error);
        }
      }
    })
    .catch((error) => {
      $.logger.error(`云端请求出现异常\n${JSON.stringify(error)}`);
    });
}

async function setContentTagByLocal(links, result) {
  $.logger.debug(`将在本地请求以下回答：${links.join(",")}`);
  const tagConfig = getAllTagConfigs();

  function checkOne(index) {
    return new Promise((resolve) => {
      if (!links[index]) {
        resolve("");
        return;
      }

      $.logger.debug(`本地请求回答内容：${links[index]}`);
      $.http
        .get({ url: links[index], timeout: 1000 })
        .then((response) => {
          let found = false;
          $.logger.debug(`检测标签配置:\n${JSON.stringify(tagConfig)}`);

          for (let [tagName, pattern] of Object.entries(tagConfig)) {
            $.logger.debug(`检测内容：${tagName}，正则：${pattern}`);
            if (typeof pattern !== "string") {
              pattern = String(pattern) || "";
            }
            if (pattern && new RegExp(pattern).test(response.body)) {
              resolve(tagName);
              found = true;
              break;
            }
          }

          if (!found) {
            resolve("");
          }
        })
        .catch((error) => {
          $.logger.error(`本地请求出现异常\n${JSON.stringify(error)}`);
          resolve("");
        });
    });
  }

  const tasks = [];
  for (let i = 0; i < links.length; i++) {
    tasks.push(checkOne(i));
  }

  await Promise.all(tasks).then((tags) => {
    $.logger.info(`本地探测结果<${tags.length}>\n${JSON.stringify(tags)}`);
    for (let i = 0; i < tags.length; i++) {
      try {
        const tag = tags[i];
        if (tag !== "") {
          prependRecommendTag(result.data[i], tag);
        }
      } catch (error) {
        $.logger.error(error);
      }
    }
  });
}

function isFiltered(item, rawText, settings, blockedKeywords, blockedUsers) {
  if (
    item.type === "market_card" ||
    item.type === "feed_advert" ||
    item.extra?.type === "SvipActivity" ||
    rawText.includes("盐选推荐") ||
    item.hasOwnProperty("ad")
  ) {
    $.logger.debug(`${rawText}匹配到广告`);
    return true;
  }

  if (
    settings.remove_advertorial &&
    (item.hasOwnProperty("promotion_extra") || rawText.includes(" · 商品介绍"))
  ) {
    $.logger.debug(`${rawText}匹配到软文`);
    return true;
  }

  if (settings.remove_article && rawText.search(/"type"\s*:\s*"article"/i) >= 0) {
    $.logger.debug(`${rawText}匹配到文章`);
    return true;
  }

  if (
    settings.recommend_stream &&
    rawText.search(/"(type|style|content_type)"\s*:\s*"(zvideo|BIG_IMAGE|drama|StyleVideo)"/i) >= 0
  ) {
    $.logger.debug(`${rawText}匹配到流媒体`);
    return true;
  }

  if (settings.remove_pin && rawText.search(/type"\s*:\s*"pin"/i) >= 0) {
    $.logger.debug(`${rawText}匹配到想法`);
    return true;
  }

  if (settings.blocked_keywords && blockedKeywords.length > 0) {
    const matched = blockedKeywords.some((keyword) => {
      const hit = rawText.search(keyword) >= 0;

      if (hit && $.isDebug && Array.isArray(item.children)) {
        const title = item.children.find((child) => child.id === "Text")?.text;
        const summary = item.children.find((child) => child.id === "text_pin_summary")?.text;
        $.logger.debug(`匹配关键字：\n${keyword}\n标题：\n${title}\n内容：\n${summary}`);
      }

      return hit;
    });

    if (matched) {
      return true;
    }
  }

  if (settings.blocked_users && Object.keys(blockedUsers).length > 0) {
    const authorName =
      item.children
        ?.find((child) => child.type === "Line" && child.style === "LineAuthor_default")
        ?.elements.find((element) => element.type === "Text")?.text || "";

    if (blockedUsers.hasOwnProperty(authorName)) {
      return true;
    }
  }

  return false;
}

async function removeRecommend() {
  if (!$.response.body) {
    $.logger.error("推荐列页去广告无法获取响应体");
    return null;
  }

  try {
    const settings = {
      recommend_stream: $.data.read("zhihu_settings_recommend_stream", false),
      remove_article: $.data.read("zhihu_settings_remove_article", false),
      remove_advertorial: $.data.read("zhihu_settings_remove_advertorial", true),
      remove_pin: $.data.read("zhihu_settings_remove_pin", true),
      blocked_users: $.data.read("zhihu_settings_blocked_users", false),
      blocked_keywords: $.data.read("zhihu_settings_blocked_keywords", true),
      check_paid_content: $.data.read("zhihu_settings_check_paid_content", false),
      request_content: $.data.read("zhihu_settings_request_content", "local"),
    };

    const user = getUserInfo();
    const blockedKeywords =
      (settings.blocked_keywords && $.data.read(STORAGE_KEYS.keywordBlock, "", user.id)) || [];
    const blockedUsers =
      (settings.blocked_users && $.data.read(STORAGE_KEYS.blockedUsers, "", user.id)) || {};

    const rawBody =
      $.response.body instanceof Uint8Array
        ? new TextDecoder().decode($.response.body)
        : $.response.body;

    const body = JSON.parse(rawBody);

    body.data = body.data.filter(
      (item) => !isFiltered(item, JSON.stringify(item), settings, blockedKeywords, blockedUsers)
    );

    if (body.fresh_text) {
      const count = parseInt((body.fresh_text.match(/\d+/) || ["0"])[0]);
      body.fresh_text =
        count > 0
          ? `刷新 ${count} 条内容，过滤后剩余 ${body.data.length} 条`
          : `过滤后剩余 ${body.data.length} 条`;
    }

    return { body: JSON.stringify(body) };
  } catch (error) {
    $.logger.error(`推荐列表去广告出现异常：${error}`);
    return null;
  }
}

function removeQuestions() {
  try {
    const body = JSON.parse($.response.body);
    delete body.ad_info;

    const user = getUserInfo();
    const blockedUsers = $.data.read(STORAGE_KEYS.blockedUsers, "", user.id) || {};
    const enableBlockedUsers = $.data.read("zhihu_settings_blocked_users", false);

    $.logger.debug(`当前黑名单列表: ${JSON.stringify(blockedUsers)}`);

    let blackAnswerIds = $.data.read(STORAGE_KEYS.blackAnswersId, []) || [];

    if (body?.data) {
      body.data = body.data.filter((entry) => {
        const {
          target,
          target: { id = "", author: { name = "" } = {} } = {},
        } = entry;

        const isBlocked = blockedUsers.hasOwnProperty(name);
        const shouldHide = enableBlockedUsers && isBlocked;

        if (target) {
          entry.target.visible_only_to_author = false;
          entry.target.is_visible = true;
          entry.target.is_copyable = true;
        }

        if (shouldHide && !blackAnswerIds.includes(id.toString())) {
          blackAnswerIds.push(id.toString());
          $.notification.debug(`记录黑名单用户${name}的回答Id:${id}`);
        }

        return !shouldHide;
      });
    }

    $.data.write(STORAGE_KEYS.blackAnswersId, blackAnswerIds);

    const output = JSON.stringify(body);
    $.logger.debug(`修改后的回答列表数据：${output}`);
    return { body: output };
  } catch (error) {
    $.logger.error(`回答列表去广告出现异常：${error}`);
  }
}

function insertContentTip() {
  const body = JSON.parse($.response.body ?? "{}");
  const tagConfig = getAllTagConfigs();

  if (body?.endorsement) {
    for (const [tagName, pattern] of Object.entries(tagConfig)) {
      $.logger.debug(`检测内容：${pattern}，标签：${tagName}`);
      if (typeof pattern === "string" && new RegExp(pattern).test($.response.body)) {
        $.logger.debug(`内容：\n ${$.response.body}\n匹配到标签：\n${tagName}`);
        const tip = {
          action_url:
            "https://github.com/blackmatrix7/ios_rule_script/tree/master/script/zheye",
          background_color: { alpha: 0.1, group: "GBL01A" },
          elements: [
            {
              content: tagName,
              font_color: { alpha: 1, group: "GBL07A" },
              font_size: 13,
              is_bold: true,
              max_line: 1,
              type: "TEXT",
            },
          ],
          sub_elements: [],
          sub_elements_type: "DESCRIPTION",
          za: {
            block_text: "ThanksForInvitingLabel",
            text: "",
            type: "text",
          },
        };
        body.endorsement.unshift(tip);
        break;
      }
    }
  } else if (body?.content_card_list) {
    for (const [tagName, pattern] of Object.entries(tagConfig)) {
      $.logger.debug(`检测内容：${pattern}，标签：${tagName}`);
      if (typeof pattern === "string" && new RegExp(pattern).test($.response.body)) {
        $.logger.debug(`内容：\n ${$.response.body}\n匹配到标签：\n${tagName}`);
        const tip = {
          card_type: "km-paid-answer-header",
          dynamic_id: ":km-sku-card-head",
          extra_info: `{"title_line":\n                          {"scene":"ANSWER_DETAIL",\n                           "copyright":"${tagName}",\n                           "style":"v2",\n                           "content_type":"ANSWER"\n                         }`,
        };
        body.content_card_list.unshift(tip);
        break;
      }
    }
  }

  return body;
}

function removeComment() {
  try {
    const responseBody = $.response?.body;
    if (!responseBody) {
      return null;
    }

    const body = JSON.parse(responseBody);
    body.ad_info = {};

    if (!$.data.read("zhihu_settings_blocked_users", false)) {
      return { body: JSON.stringify(body) };
    }

    const { id } = getUserInfo();
    const blockedUsers = $.data.read(STORAGE_KEYS.blockedUsers, {}, id) || {};

    const anonymizeComment = (comment) => {
      comment.is_delete = true;
      comment.can_reply = false;
      comment.can_like = false;
      comment.author.name = "[黑名单用户]";
      comment.author.avatar_url =
        "https://picx.zhimg.com/v2-abed1a8c04700ba7d72b45195223e0ff_xll.jpg";
      comment.author.exposed_medal = {};
    };

    const anonymizeReplyTarget = (author) => {
      author.name = "[黑名单用户]";
      author.avatar_url =
        "https://picx.zhimg.com/v2-abed1a8c04700ba7d72b45195223e0ff_xll.jpg";
      author.exposed_medal = {};
    };

    const processComments = (comments) =>
      comments.map((comment) => {
        const authorName = comment.author.name;
        const replyToName = comment.reply_to_author?.name || "";
        const authorBlocked = blockedUsers[authorName];
        const replyToBlocked = blockedUsers[replyToName];

        if (authorBlocked || replyToBlocked) {
          if (authorBlocked) {
            anonymizeComment(comment);
          }
          if (replyToBlocked) {
            anonymizeReplyTarget(comment.reply_to_author);
          }
        }

        if (comment.child_comments) {
          comment.child_comments = processComments(comment.child_comments);
        }

        return comment;
      });

    if (body.root) {
      const rootAuthorName = body.root.author.name;
      if (blockedUsers[rootAuthorName]) {
        anonymizeComment(body.root);
      }
    }

    if (body.data) {
      body.data = processComments(body.data);
    }

    return { body: JSON.stringify(body) };
  } catch (error) {
    $.logger.error(`去除评论广告出现异常：${error}`);
  }
}

function removeMarketingMsg() {
  try {
    if ($.data.read("zhihu_settings_marketing_msg", true) === false) {
      return null;
    }

    const body = JSON.parse($.response?.body || "{}");

    body?.column_head?.forEach((item) => {
      if (item?.id === "column_head_entry_invite") {
        item.text = `您有${item.unread_count}条新的邀请回答`;
        item.unread_count = 0;
      }
    });

    const hiddenTitles = ["超赞包小助手", "知乎活动助手", "考研记事本", "创作者小助手"];

    body.data =
      body?.data?.reduce((list, item) => {
        const title = item?.content?.title || item?.detail_title;

        if (title === "官方账号消息") {
          const unread = item?.unread_count || 0;
          item.content.text = unread > 0 ? `未读消息${unread}条` : "全部消息已读";
          item.is_read = true;
          item.unread_count = 0;
        }

        if (!hiddenTitles.includes(title)) {
          list.push(item);
        }
        return list;
      }, []) || [];

    return { body: JSON.stringify(body) };
  } catch (error) {
    $.logger.error(`屏蔽官方营销消息出现异常：${error}`);
    return null;
  }
}

function removeHotListAds() {
  let result = null;

  try {
    if ($.data.read("zhihu_settings_hot_list", true) === false) {
      return null;
    }

    if ($.response.body) {
      const body = JSON.parse($.response.body);
      if ("data" in body) {
        body.data = body.data.filter(
          (item) => item.type === "hot_list_feed" || item.type === "hot_list_feed_video"
        );
      }
      result = { body: JSON.stringify(body) };
    }
  } catch (error) {
    $.logger.error(`去除热榜广告出现异常：${error}`);
  }

  return result;
}

function removeKeywordAds() {
  try {
    if ($.data.read("zhihu_settings_preset_words", true) === false) {
      return null;
    }

    const responseBody = $.response?.body;
    if (!responseBody) {
      return null;
    }

    const body = JSON.parse(responseBody);
    const words = body?.preset_words?.words;

    if (!words) {
      return null;
    }

    body.preset_words.words = words.filter((item) => item.type === "general");
    return { body: JSON.stringify(body) };
  } catch (error) {
    $.logger.error(`去除预置关键字广告异常：${error}`);
    return null;
  }
}

function removeQueryAds() {
  try {
    const responseBody = $.response?.body;
    if (!responseBody) {
      return null;
    }

    const body = JSON.parse(responseBody);
    if (!body?.recommend_queries?.queries) {
      return null;
    }

    body.recommend_queries.queries = body.recommend_queries.queries.filter(
      (item) => !item.hasOwnProperty("ad_commercial_json")
    );

    return { body: JSON.stringify(body) };
  } catch (error) {
    $.logger.error(`去除猜你想搜广告异常：${error}`);
    return null;
  }
}

function modifyAnswersNextRender() {
  try {
    const responseBody = $.response?.body;
    if (!responseBody) {
      return null;
    }

    const body = JSON.parse(responseBody);
    const user = getUserInfo();
    const enableBlockedUsers = $.data.read("zhihu_settings_blocked_users", false);
    let blockedUsers = {};

    if (enableBlockedUsers) {
      blockedUsers = $.data.read(STORAGE_KEYS.blockedUsers, {}, user.id) || {};
      $.logger.debug(`脚本黑名单用户：\n${JSON.stringify(blockedUsers)}`);
    }

    body.data = body.data.filter((item) => {
      const {
        ad_info: adInfo = {},
        biz_type_list: bizTypeList = [],
        type = "",
        adjson = "",
        author: { fullname = "" } = {},
      } = item || {};

      const isAd =
        adInfo?.data ||
        bizTypeList.length !== 1 ||
        bizTypeList[0] !== "answer" ||
        type === "ad" ||
        adjson;

      const isBlocked = enableBlockedUsers && blockedUsers.hasOwnProperty(fullname);
      $.logger.debug(`用户${fullname}是否在黑名单中：${isBlocked}`);

      return !(isAd || isBlocked);
    });

    return { body: JSON.stringify(body) };
  } catch (error) {
    $.logger.error(`屏蔽回答信息流黑名单用户及广告：${error}`);
  }
}

function removeAnswerOrArticleAd() {
  $.logger.debug("开始移除回答页广告");

  try {
    const body = insertContentTip();
    delete body.third_business;

    $.logger.debug(JSON.stringify(body));
    return { body: JSON.stringify(body) };
  } catch (error) {
    $.logger.error(`移除回答页广告出现异常：${error}`);
    return null;
  }
}

function AsyncFunction() {
  return Object.prototype.toString.call(this) === "[object AsyncFunction]";
}

const urlHandlers = {
  resp_handlers: {
    "^https:\\/\\/api\\.zhihu\\.com\\/people\\/self$": processUserInfo,
    "^https:\\/\\/api\\.zhihu\\.com\\/root\\/tab\\/v2": modifyAppTabConfig,
    "^https:\\/\\/(api|web-render)\\.zhihu\\.com\\/topstory\\/recommend": removeRecommend,
    "^https:\\/\\/api\\.zhihu\\.com\\/questions\\/\\d+\\/feeds": removeQuestions,
    "^https:\\/\\/api\\.zhihu\\.com\\/next-render\\?": modifyAnswersNextRender,
    "^https:\\/\\/api\\.zhihu\\.com\\/notifications\\/v3\\/message": removeMarketingMsg,
    "^https:\\/\\/api\\.zhihu\\.com\\/comment_v5\\/(answers|pins|comments?|articles)\\/\\d+\\/(root|child)_comment": removeComment,
    "^https:\\/\\/(page-info|api)\\.zhihu\\.com\\/(answers|articles)\\/v2\\/\\d+": removeAnswerOrArticleAd,
    "^https:\\/\\/api\\.zhihu\\.com\\/articles\\/v\\d\\/\\d+": removeAnswerOrArticleAd,
    "^https:\\/\\/api\\.zhihu\\.com\\/people\\/\\d+": autoInsertBlackList,
    "^https:\\/\\/api\\.zhihu\\.com\\/moments_v3\\?": removeMoments,
    "^https?:\\/\\/api\\.zhihu\\.com\\/topstory\\/hot-lists": removeHotListAds,
    "^https:\\/\\/api\\.zhihu\\.com\\/search\\/preset_words": removeKeywordAds,
    "^https:\\/\\/api\\.zhihu\\.com\\/search\\/recommend_query": removeQueryAds,
    "^https:\\/\\/api\\.zhihu\\.com\\/settings\\/blocked_users": manageBlackUser,
  },
  req_handlers: {
    "^https:\\/\\/api\\.zhihu\\.com\\/feed-root\\/block": unlockBlockedKeywords,
  },
};

async function handleRequest(handlerGroupName) {
  let result = null;

  for (const rule in urlHandlers[handlerGroupName]) {
    $.logger.debug(`当前处理的URL：${$.request.url}，匹配规则：${rule}`);
    $.logger.debug(`匹配结果${urlMatches(rule)}`);

    if (urlMatches(rule)) {
      $.logger.debug(`当前处理的URL：${$.request.url}，匹配规则：${rule}`);
      const handler = urlHandlers[handlerGroupName][rule];
      result = handler instanceof AsyncFunction ? await handler() : handler();
      break;
    }
  }

  return result;
}

function MagicJS(name = "MagicJS", logLevel = "INFO") {
  return new (class {
    constructor(scriptName, level) {
      this._startTime = Date.now();
      this.version = "3.0.0";
      this.scriptName = scriptName;

      this.env = (() => {
        const isLoon = typeof $loon !== "undefined";
        const isQuanX = typeof $task !== "undefined";
        const isNode = typeof module !== "undefined";
        const isSurge = typeof $httpClient !== "undefined" && !isLoon;
        const isStorm = typeof $storm !== "undefined";
        const isStash = typeof $environment !== "undefined" && $environment["stash-build"] !== undefined;
        const isScriptable = typeof importModule !== "undefined";

        return {
          isLoon,
          isQuanX,
          isNode,
          isSurge,
          isStorm,
          isStash,
          isSurgeLike: isSurge || isLoon || isStorm || isStash,
          isScriptable,
          get name() {
            return isLoon
              ? "Loon"
              : isQuanX
                ? "QuantumultX"
                : isNode
                  ? "NodeJS"
                  : isSurge
                    ? "Surge"
                    : isScriptable
                      ? "Scriptable"
                      : "unknown";
          },
          get build() {
            return isSurge
              ? $environment["surge-build"]
              : isStash
                ? $environment["stash-build"]
                : isStorm
                  ? $storm.buildVersion
                  : undefined;
          },
          get language() {
            if (isSurge || isStash) {
              return $environment.language;
            }
          },
          get version() {
            return isSurge
              ? $environment["surge-version"]
              : isStash
                ? $environment["stash-version"]
                : isStorm
                  ? $storm.appVersion
                  : isNode
                    ? process.version
                    : undefined;
          },
          get system() {
            return isSurge ? $environment.system : isNode ? process.platform : undefined;
          },
          get systemVersion() {
            if (isStorm) {
              return $storm.systemVersion;
            }
          },
          get deviceName() {
            if (isStorm) {
              return $storm.deviceName;
            }
          },
        };
      })();

      this.logger = ((scope, initialLevel = "INFO") => {
        let currentLevel = initialLevel;
        const levelMap = {
          SNIFFER: 6,
          DEBUG: 5,
          INFO: 4,
          NOTIFY: 3,
          WARNING: 2,
          ERROR: 1,
          CRITICAL: 0,
          NONE: -1,
        };
        const prefixMap = {
          SNIFFER: "",
          DEBUG: "",
          INFO: "",
          NOTIFY: "",
          WARNING: "❗ ",
          ERROR: "❌ ",
          CRITICAL: "❌ ",
          NONE: "",
        };

        const print = (message, levelName = "INFO") => {
          if (levelMap[currentLevel] < levelMap[levelName.toUpperCase()]) {
            return;
          }
          console.log(`[${levelName}] [${scope}]\n${prefixMap[levelName.toUpperCase()]}${message}\n`);
        };

        return {
          getLevel: () => currentLevel,
          setLevel: (newLevel) => {
            currentLevel = newLevel;
          },
          sniffer: (msg) => print(msg, "SNIFFER"),
          debug: (msg) => print(msg, "DEBUG"),
          info: (msg) => print(msg, "INFO"),
          notify: (msg) => print(msg, "NOTIFY"),
          warning: (msg) => print(msg, "WARNING"),
          error: (msg) => print(msg, "ERROR"),
          retry: (msg) => print(msg, "RETRY"),
        };
      })(scriptName, level);

      this.http = typeof MagicHttp === "function" ? MagicHttp(this.env, this.logger) : undefined;
      this.data = typeof MagicData === "function" ? MagicData(this.env, this.logger) : undefined;
      this.notification =
        typeof MagicNotification === "function"
          ? MagicNotification(this.scriptName, this.env, this.logger, this.http)
          : undefined;
      this.utils = typeof MagicUtils === "function" ? MagicUtils(this.env, this.logger) : undefined;
      this.qinglong =
        typeof MagicQingLong === "function"
          ? MagicQingLong(this.env, this.data, this.logger)
          : undefined;

      if (this.data !== undefined) {
        const storedLogLevel = this.data.read("magic_loglevel");
        const barkUrl = this.data.read("magic_bark_url");
        if (storedLogLevel) {
          this.logger.setLevel(storedLogLevel.toUpperCase());
        }
        if (barkUrl) {
          this.notification.setBark(barkUrl);
        }
      }
    }

    get isRequest() {
      return typeof $request !== "undefined" && typeof $response === "undefined";
    }

    get isResponse() {
      return typeof $response !== "undefined";
    }

    get isDebug() {
      return this.logger.level === "DEBUG";
    }

    get request() {
      return typeof $request !== "undefined" ? $request : undefined;
    }

    get response() {
      if (typeof $response === "undefined") {
        return undefined;
      }
      if ($response.hasOwnProperty("status")) {
        $response.statusCode = $response.status;
      }
      if ($response.hasOwnProperty("statusCode")) {
        $response.status = $response.statusCode;
      }
      return $response;
    }

    done = (result = {}) => {
      this._endTime = Date.now();
      const seconds = (this._endTime - this._startTime) / 1000;
      this.logger.debug(`SCRIPT COMPLETED: ${seconds} S.`);
      if (typeof $done !== "undefined") {
        $done(result);
      }
    };
  })(name, logLevel);
}

// Note: helper library implementations (MagicNotification / MagicData / MagicHttp)
// are preserved conceptually in the original file but omitted here for brevity.
// Their purpose is environment abstraction, storage, notification, and HTTP helpers.

(async () => {
  let result = null;

  if ($.isResponse) {
    result = await handleRequest("resp_handlers");
  } else if ($.isRequest) {
    result = await handleRequest("req_handlers");
  } else {
    $.data.del(STORAGE_KEYS.currentUserInfo);
    $.data.del(STORAGE_KEYS.blockedUsers);
    $.data.del(STORAGE_KEYS.keywordBlock);
    $.notification.post("哲也同学数据清理完毕");
  }

  if (result) {
    $.done(result);
  } else {
    $.done();
  }
})();
