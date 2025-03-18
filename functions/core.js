/**
 * Open Wegram Bot - 核心逻辑
 * 该代码在 Cloudflare Worker 和 Vercel 部署中共享使用
 */

/**
 * 校验密钥令牌是否合法
 * 要求：
 *   1. 长度大于15
 *   2. 包含大写字母
 *   3. 包含小写字母
 *   4. 包含数字
 *
 * @param {string} token - 密钥令牌
 * @returns {boolean} - 返回校验结果
 */
export function validateSecretToken(token) {
    return token.length > 15 && /[A-Z]/.test(token) && /[a-z]/.test(token) && /[0-9]/.test(token);
}

/**
 * 返回 JSON 格式的响应对象
 *
 * @param {Object} data - 返回的数据对象
 * @param {number} status - HTTP 状态码，默认为 200
 * @returns {Response} - 返回构造好的 Response 对象
 */
export function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {'Content-Type': 'application/json'}
    });
}

/**
 * 向 Telegram API 发送 POST 请求
 *
 * @param {string} token - Bot 的 token
 * @param {string} method - Telegram API 方法名称
 * @param {Object} body - 请求体数据对象
 * @returns {Promise<Response>} - 返回 fetch 请求的 Promise 对象
 */
export async function postToTelegramApi(token, method, body) {
    return fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    });
}

/**
 * 处理安装 webhook 请求
 *
 * 该函数用于安装 Telegram 机器人的 webhook，
 * 会校验 secretToken 并调用 Telegram API 设置 webhook，
 * 同时根据结果返回 JSON 格式的响应。
 *
 * @param {Request} request - 请求对象
 * @param {string} ownerUid - 机器人所有者的用户 ID
 * @param {string} botToken - 机器人的 token
 * @param {string} prefix - 请求 URL 中的前缀
 * @param {string} secretToken - 密钥令牌，用于安全校验
 * @returns {Promise<Response>} - 返回处理结果响应
 */
export async function handleInstall(request, ownerUid, botToken, prefix, secretToken) {
    // 校验 secretToken 是否满足要求
    if (!validateSecretToken(secretToken)) {
        return jsonResponse({
            success: false,
            message: '密钥令牌必须至少包含16个字符，且包含大写字母、小写字母和数字。'
        }, 400);
    }

    // 解析请求 URL，并构建 webhook 的 URL
    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.hostname}`;
    const webhookUrl = `${baseUrl}/${prefix}/webhook/${ownerUid}/${botToken}`;

    try {
        // 调用 Telegram API 设置 webhook
        const response = await postToTelegramApi(botToken, 'setWebhook', {
            url: webhookUrl,
            allowed_updates: ['message'],
            secret_token: secretToken
        });

        const result = await response.json();
        if (result.ok) {
            // 安装成功，返回成功信息
            return jsonResponse({success: true, message: 'Webhook 安装成功。'});
        }

        // 安装失败，返回错误信息
        return jsonResponse({success: false, message: `Webhook 安装失败：${result.description}`}, 400);
    } catch (error) {
        // 捕获异常并返回错误信息
        return jsonResponse({success: false, message: `安装 webhook 时出错：${error.message}`}, 500);
    }
}

/**
 * 处理卸载 webhook 请求
 *
 * 该函数用于卸载 Telegram 机器人的 webhook，
 * 会校验 secretToken 并调用 Telegram API 删除 webhook，
 * 同时根据结果返回 JSON 格式的响应。
 *
 * @param {string} botToken - 机器人的 token
 * @param {string} secretToken - 密钥令牌，用于安全校验
 * @returns {Promise<Response>} - 返回处理结果响应
 */
export async function handleUninstall(botToken, secretToken) {
    // 校验 secretToken 是否满足要求
    if (!validateSecretToken(secretToken)) {
        return jsonResponse({
            success: false,
            message: '密钥令牌必须至少包含16个字符，且包含大写字母、小写字母和数字。'
        }, 400);
    }

    try {
        // 调用 Telegram API 删除 webhook
        const response = await postToTelegramApi(botToken, 'deleteWebhook', {});
        const result = await response.json();
        if (result.ok) {
            // 卸载成功，返回成功信息
            return jsonResponse({success: true, message: 'Webhook 卸载成功。'});
        }

        // 卸载失败，返回错误信息
        return jsonResponse({success: false, message: `Webhook 卸载失败：${result.description}`}, 400);
    } catch (error) {
        // 捕获异常并返回错误信息
        return jsonResponse({success: false, message: `卸载 webhook 时出错：${error.message}`}, 500);
    }
}

/**
 * 处理 Telegram webhook 请求
 *
 * 该函数首先校验请求头中的 secret token，
 * 然后解析请求体中的消息更新，
 * 根据消息内容做不同的处理逻辑。
 *
 * @param {Request} request - 请求对象
 * @param {string} ownerUid - 机器人所有者的用户 ID
 * @param {string} botToken - 机器人的 token
 * @param {string} secretToken - 密钥令牌，用于安全校验
 * @returns {Promise<Response>} - 返回处理结果响应
 */
export async function handleWebhook(request, ownerUid, botToken, secretToken) {
    // 校验请求头中提供的 secret token 是否正确
    if (secretToken !== request.headers.get('X-Telegram-Bot-Api-Secret-Token')) {
        return new Response('未授权', {status: 401});
    }

    // 解析请求体中的 JSON 数据
    const update = await request.json();
    // 如果消息更新中没有 message 字段，则直接返回成功
    if (!update.message) {
        return new Response('成功');
    }

    const message = update.message;
    const reply = message.reply_to_message;
    try {
        // 如果消息为回复消息，并且消息的 chat id 与 ownerUid 相符，则执行以下操作
        if (reply && message.chat.id.toString() === ownerUid) {
            const rm = reply.reply_markup;
            if (rm && rm.inline_keyboard && rm.inline_keyboard.length > 0) {
                // 尝试从 inline_keyboard 中获取发送者的 UID
                let senderUid = rm.inline_keyboard[0][0].callback_data;
                if (!senderUid) {
                    senderUid = rm.inline_keyboard[0][0].url.split('tg://user?id=')[1];
                }

                // 调用 Telegram API 复制消息，将消息发送给发送者
                await postToTelegramApi(botToken, 'copyMessage', {
                    chat_id: parseInt(senderUid),
                    from_chat_id: message.chat.id,
                    message_id: message.message_id
                });
            }

            return new Response('成功');
        }

        // 如果消息内容为 "/start" 指令，则直接返回成功（忽略不处理）
        if ("/start" === message.text) {
            return new Response('成功');
        }

        // 处理非回复消息的情况
        const sender = message.chat;
        const senderUid = sender.id.toString();
        // 构造发送者的名称，如果存在 username 则使用 @username，否则拼接 first_name 和 last_name
        const senderName = sender.username ? `@${sender.username}` : [sender.first_name, sender.last_name].filter(Boolean).join(' ');

        /**
         * 定义一个函数用于复制消息
         * @param {boolean} withUrl - 是否在 inline_keyboard 中包含链接
         * @returns {Promise<Response>} - 返回 Telegram API 的响应结果
         */
        const copyMessage = async function (withUrl = false) {
            // 构造 inline_keyboard 数组，用于在消息中显示发送者信息
            const ik = [[{
                text: `🔏 来自: ${senderName} (${senderUid})`,
                callback_data: senderUid,
            }]];

            // 如果需要包含链接，则修改 inline_keyboard 中按钮的文本和增加链接属性
            if (withUrl) {
                ik[0][0].text = `🔓 来自: ${senderName} (${senderUid})`;
                ik[0][0].url = `tg://user?id=${senderUid}`;
            }

            // 调用 Telegram API 复制消息，将消息发送给 ownerUid
            return await postToTelegramApi(botToken, 'copyMessage', {
                chat_id: parseInt(ownerUid),
                from_chat_id: message.chat.id,
                message_id: message.message_id,
                reply_markup: {inline_keyboard: ik}
            });
        }

        // 首先尝试带链接复制消息
        const response = await copyMessage(true);
        // 如果返回不成功，则再尝试不带链接的复制
        if (!response.ok) {
            await copyMessage();
        }

        return new Response('成功');
    } catch (error) {
        // 控制台输出错误日志，方便调试（输出为英文）
        console.error('Error handling webhook:', error);
        return new Response('内部服务器错误', {status: 500});
    }
}

/**
 * 根据请求 URL 路径分发处理函数
 *
 * 根据请求的路径，判断是安装、卸载还是 webhook 触发，
 * 并调用相应的处理函数返回结果。
 *
 * @param {Request} request - 请求对象
 * @param {Object} config - 配置信息对象，其中包括 prefix 和 secretToken
 * @returns {Promise<Response>} - 返回处理结果响应
 */
export async function handleRequest(request, config) {
    const {prefix, secretToken} = config;

    // 解析请求 URL 和路径
    const url = new URL(request.url);
    const path = url.pathname;

    // 定义正则表达式，用于匹配安装、卸载、webhook 的路径格式
    const INSTALL_PATTERN = new RegExp(`^/${prefix}/install/([^/]+)/([^/]+)$`);
    const UNINSTALL_PATTERN = new RegExp(`^/${prefix}/uninstall/([^/]+)$`);
    const WEBHOOK_PATTERN = new RegExp(`^/${prefix}/webhook/([^/]+)/([^/]+)$`);

    let match;

    // 如果请求路径匹配安装路径，则调用 handleInstall
    if (match = path.match(INSTALL_PATTERN)) {
        return handleInstall(request, match[1], match[2], prefix, secretToken);
    }

    // 如果请求路径匹配卸载路径，则调用 handleUninstall
    if (match = path.match(UNINSTALL_PATTERN)) {
        return handleUninstall(match[1], secretToken);
    }

    // 如果请求路径匹配 webhook 路径，则调用 handleWebhook
    if (match = path.match(WEBHOOK_PATTERN)) {
        return handleWebhook(request, match[1], match[2], secretToken);
    }

    // 如果以上都不匹配，则返回 404 未找到
    return new Response('未找到', {status: 404});
}
