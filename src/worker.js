// functions/[[path]].js

// 从 core.js 导入处理请求的函数
import { handleRequest } from './core.js';

/**
 * Cloudflare Pages Functions 的入口
 * @param {Object} context - 包含 request、env、params 等信息
 */
export async function onRequest(context) {
  const { request, env } = context;

  // 从环境变量读取配置，如果不存在则使用默认值
  const config = {
    prefix: env.PREFIX ?? 'public',
    secretToken: env.SECRET_TOKEN ?? ''
  };

  // 调用 core.js 中的 handleRequest，返回响应
  return handleRequest(request, config);
}
