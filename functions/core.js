/**
 * Open Wegram Bot - 核心逻辑代码
 * 该代码为 Cloudflare Worker 和 Vercel 部署共享的逻辑代码
 */

// 校验密钥是否合法，要求至少16个字符且包含大写字母、小写字母和数字
export function 校验密钥(令牌) {
    return 令牌.length > 15 && /[A-Z]/.test(令牌) && /[a-z]/.test(令牌) && /[0-9]/.test(令牌);
}

// 返回 JSON 格式的响应
// 参数 数据：响应数据对象；状态码：HTTP 状态码，默认200
export function JSON响应(数据, 状态码 = 200) {
    return new Response(JSON.stringify(数据), {
        status: 状态码,
        headers: {'Content-Type': 'application/json'}
    });
}

// 向 Telegram API 发送 POST 请求
// 参数 机器人令牌：用于访问 Telegram 机器人的令牌；方法：调用的 API 方法；请求体：传递的参数对象
export async function 发送到TelegramAPI(机器人令牌, 方法, 请求体) {
    return fetch(`https://api.telegram.org/bot${机器人令牌}/${方法}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(请求体)
    });
}

// 处理安装 webhook 的请求
// 参数 请求：请求对象；拥有者UID：拥有者的用户ID；机器人令牌：Telegram机器人的令牌；前缀：URL路径前缀；密钥：用于验证的密钥
export async function 安装Webhook(请求, 拥有者UID, 机器人令牌, 前缀, 密钥) {
    // 校验密钥是否合法
    if (!校验密钥(密钥)) {
        return JSON响应({
            success: false,
            message: '密钥必须至少16个字符，并且包含大写字母、小写字母和数字。'
        }, 400);
    }

    // 解析请求URL，获取基础URL信息
    const url = new URL(请求.url);
    const 基础URL = `${url.protocol}//${url.hostname}`;
    // 构造 webhook 的 URL
    const webhookURL = `${基础URL}/${前缀}/webhook/${拥有者UID}/${机器人令牌}`;

    try {
        // 调用 Telegram API 设置 webhook
        const 响应 = await 发送到TelegramAPI(机器人令牌, 'setWebhook', {
            url: webhookURL,
            allowed_updates: ['message'],
            secret_token: 密钥
        });

        const 结果 = await 响应.json();
        if (结果.ok) {
            // 如果成功设置 webhook，则返回成功提示
            return JSON响应({success: true, message: 'Webhook 安装成功。'});
        }

        // 如果设置失败，则返回错误提示
        return JSON响应({success: false, message: `Webhook 安装失败：${结果.description}`}, 400);
    } catch (错误) {
        // 捕获异常并返回服务器错误
        return JSON响应({success: false, message: `安装 webhook 出错：${错误.message}`}, 500);
    }
}

// 处理卸载 webhook 的请求
// 参数 机器人令牌：Telegram机器人的令牌；密钥：用于验证的密钥
export async function 卸载Webhook(机器人令牌, 密钥) {
    // 校验密钥是否合法
    if (!校验密钥(密钥)) {
        return JSON响应({
            success: false,
            message: '密钥必须至少16个字符，并且包含大写字母、小写字母和数字。'
        }, 400);
    }

    try {
        // 调用 Telegram API 删除 webhook
        const 响应 = await 发送到TelegramAPI(机器人令牌, 'deleteWebhook', {});
        const 结果 = await 响应.json();
        if (结果.ok) {
            return JSON响应({success: true, message: 'Webhook 卸载成功。'});
        }

        return JSON响应({success: false, message: `Webhook 卸载失败：${结果.description}`}, 400);
    } catch (错误) {
        return JSON响应({success: false, message: `卸载 webhook 出错：${错误.message}`}, 500);
    }
}

// 处理 webhook 请求
// 参数 请求：请求对象；拥有者UID：拥有者的用户ID；机器人令牌：Telegram机器人的令牌；密钥：用于验证的密钥
export async function 处理Webhook(请求, 拥有者UID, 机器人令牌, 密钥) {
    // 校验请求头中的密钥是否匹配
    if (密钥 !== 请求.headers.get('X-Telegram-Bot-Api-Secret-Token')) {
        return new Response('未授权', {status: 401});
    }

    // 获取 Telegram 推送的更新数据
    const 更新 = await 请求.json();
    if (!更新.message) {
        return new Response('OK');
    }

    const 消息 = 更新.message;
    const 回复消息 = 消息.reply_to_message;
    try {
        // 如果消息为回复消息，并且消息所在聊天的ID与拥有者UID匹配
        if (回复消息 && 消息.chat.id.toString() === 拥有者UID) {
            const 回复标记 = 回复消息.reply_markup;
            if (回复标记 && 回复标记.inline_keyboard && 回复标记.inline_keyboard.length > 0) {
                // 尝试从回调数据或URL中获取发送者UID
                let 发送者UID = 回复标记.inline_keyboard[0][0].callback_data;
                if (!发送者UID) {
                    发送者UID = 回复标记.inline_keyboard[0][0].url.split('tg://user?id=')[1];
                }

                // 调用 Telegram API 复制消息，将消息发送给发送者
                await 发送到TelegramAPI(机器人令牌, 'copyMessage', {
                    chat_id: parseInt(发送者UID),
                    from_chat_id: 消息.chat.id,
                    message_id: 消息.message_id
                });
            }

            return new Response('OK');
        }

        // 如果消息文本为 "/start"，直接返回 OK
        if ("/start" === 消息.text) {
            return new Response('OK');
        }

        // 获取发送者信息
        const 发送者 = 消息.chat;
        const 发送者UID = 发送者.id.toString();
        // 构造发送者名称：若有用户名则使用用户名，否则组合名字和姓氏
        const 发送者名称 = 发送者.username ? `@${发送者.username}` : [发送者.first_name, 发送者.last_name].filter(Boolean).join(' ');

        // 定义一个异步函数，用于复制消息到拥有者聊天中
        // 参数 withUrl 决定是否在内联按钮中添加 URL 链接
        const 复制消息 = async function (withUrl = false) {
            // 构造内联按钮，显示发送者信息
            const 按钮组 = [[{
                text: `🔏 来自: ${发送者名称} (${发送者UID})`,
                callback_data: 发送者UID,
            }]];

            // 如果需要添加 URL 链接，则修改按钮文本并添加 URL
            if (withUrl) {
                按钮组[0][0].text = `🔓 来自: ${发送者名称} (${发送者UID})`;
                按钮组[0][0].url = `tg://user?id=${发送者UID}`;
            }

            // 调用 Telegram API 复制消息，将消息发送给拥有者
            return await 发送到TelegramAPI(机器人令牌, 'copyMessage', {
                chat_id: parseInt(拥有者UID),
                from_chat_id: 消息.chat.id,
                message_id: 消息.message_id,
                reply_markup: {inline_keyboard: 按钮组}
            });
        }

        // 尝试使用带 URL 链接的方式复制消息
        const 响应 = await 复制消息(true);
        // 如果响应不成功，则尝试不带 URL 链接的方式
        if (!响应.ok) {
            await 复制消息();
        }

        return new Response('OK');
    } catch (错误) {
        // 输出错误日志，并返回服务器内部错误
        console.error('处理 webhook 时出错:', 错误);
        return new Response('内部服务器错误', {status: 500});
    }
}

// 根据 URL 路径匹配不同功能，处理所有请求
// 参数 请求：请求对象；配置：包含前缀和密钥的配置对象
export async function 处理请求(请求, 配置) {
    const { 前缀, 密钥 } = 配置;

    // 解析请求URL，获取路径部分
    const url = new URL(请求.url);
    const 路径 = url.pathname;

    // 定义各个功能对应的 URL 正则匹配规则
    const 安装正则 = new RegExp(`^/${前缀}/install/([^/]+)/([^/]+)$`);
    const 卸载正则 = new RegExp(`^/${前缀}/uninstall/([^/]+)$`);
    const webhook正则 = new RegExp(`^/${前缀}/webhook/([^/]+)/([^/]+)$`);

    let 匹配结果;

    // 如果匹配安装 webhook 的 URL，则调用安装处理函数
    if (匹配结果 = 路径.match(安装正则)) {
        // 匹配结果中，第一个参数为拥有者UID，第二个为机器人令牌
        return 安装Webhook(请求, 匹配结果[1], 匹配结果[2], 前缀, 密钥);
    }

    // 如果匹配卸载 webhook 的 URL，则调用卸载处理函数
    if (匹配结果 = 路径.match(卸载正则)) {
        // 匹配结果中，第一个参数为机器人令牌
        return 卸载Webhook(匹配结果[1], 密钥);
    }

    // 如果匹配 webhook 请求的 URL，则调用 webhook 处理函数
    if (匹配结果 = 路径.match(webhook正则)) {
        // 匹配结果中，第一个参数为拥有者UID，第二个为机器人令牌
        return 处理Webhook(请求, 匹配结果[1], 匹配结果[2], 密钥);
    }

    // 如果都不匹配，则返回 404 未找到
    return new Response('未找到', {status: 404});
}
