/**
 * OpenAI Realtime API Configuration
 * 統一管理所有 Realtime API 相關設定
 */

export const REALTIME_CONFIG = {
  // 使用的模型
  model: "gpt-realtime-mini" as const,

  // 語音設定
  voice: "shimmer" as const,

  // 系統提示詞
  instructions: `You are a helpful assistant with access to web research capabilities. You speak traditional chinese well. You also have Taiwan accent.

When users ask questions that require current information, recent data, or web research (like stock prices, news, current events, company information), use the available research tools:
- Use deep_research for comprehensive, in-depth research on a topic
- Use quick_search for fast searches when speed is more important than depth

Voice: Warm, empathetic, and professional, engaging reassuring the customer that their issue is understood and will be resolved.
Punctuation: Well-structured with natural pauses, allowing for clarity and a steady, flow.
Delivery: Supportive and understanding tone that reassures the listener, with a lively and playful tone.`,

  // WebSocket URL
  getWebSocketUrl: () => `wss://api.openai.com/v1/realtime?model=${REALTIME_CONFIG.model}`,

  // Session API URL
  sessionApiUrl: "https://api.openai.com/v1/realtime/sessions" as const,

  // 音訊格式
  audioFormat: "pcm16" as const,
  sampleRate: 24000 as const,

  // VAD (Voice Activity Detection) 設定
  vad: {
    type: "server_vad" as const,
    threshold: 0.5,
    prefixPaddingMs: 300,
    silenceDurationMs: 200,
  },

  // Barge-in 設定
  bargeIn: {
    enabled: true,
    speechThreshold: 0.02,
    consecutiveFrames: 2,
    cooldownMs: 500,
  },

  // 工具配置 (Tools Configuration)
  tools: [
    {
      type: "function" as const,
      name: "deep_research",
      description: "Conduct comprehensive web research on a given query. Use this when you need in-depth, reliable, and current information about a topic. This tool explores multiple sources and returns detailed context with references.",
      parameters: {
        type: "object" as const,
        properties: {
          query: {
            type: "string" as const,
            description: "The research query or topic to investigate",
          },
        },
        required: ["query"],
      },
    },
    {
      type: "function" as const,
      name: "quick_search",
      description: "Perform a fast web search for quick answers. Use this when you need current information quickly and don't need comprehensive research. Returns search results with snippets.",
      parameters: {
        type: "object" as const,
        properties: {
          query: {
            type: "string" as const,
            description: "The search query",
          },
        },
        required: ["query"],
      },
    },
  ],
} as const;
