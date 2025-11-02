# Voice Agent WebRTC Connection Fix

## 問題描述
- 原始錯誤: Connection failed: Failed to execute 'setRemoteDescription' on 'RTCPeerConnection'
- 新錯誤: Missing bearer or basic authentication in header

## 修復步驟

### 1. 修正 next.config.js
移除過時的 `serverActions` 設定。

**檔案：`next.config.js`**
```javascript
/** @type {import('next').NextConfig} */

const nextConfig = {
  // 移除 experimental.serverActions (Next.js 新版本已不需要)
};

module.exports = nextConfig;
```

### 2. 更新 token.ts
確保正確的 API 呼叫格式。

**檔案：`app/server/token.ts`**
```typescript
"use server";

export async function getSessionToken() {
  const apiKey = process.env.OPENAI_API_KEY;
  
  console.log("Checking API Key:", {
    exists: !!apiKey,
    prefix: apiKey?.substring(0, 7),
    length: apiKey?.length
  });
  
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not found in environment variables");
  }

  try {
    // 使用 fetch 直接呼叫 API
    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1"
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-10-01",
        voice: "alloy",
        instructions: "You are a helpful assistant."
      }),
    });

    console.log("API Response Status:", response.status);
    console.log("API Response Headers:", response.headers);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API Error Details:", {
        status: response.status,
        statusText: response.statusText,
        error: errorText
      });
      
      // 檢查是否是認證問題
      if (response.status === 401) {
        throw new Error("Authentication failed. Please check your API key.");
      }
      
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log("Full API Response:", JSON.stringify(data, null, 2));
    
    // OpenAI Realtime API 回傳格式
    // 可能的 token 欄位名稱
    const token = data.client_secret?.value || 
                  data.client_secret ||
                  data.session_token ||
                  data.ephemeral_key ||
                  data.token;
                  
    if (!token) {
      console.error("No token found in response. Response structure:", {
        hasClientSecret: !!data.client_secret,
        hasSessionToken: !!data.session_token,
        hasEphemeralKey: !!data.ephemeral_key,
        hasToken: !!data.token,
        allKeys: Object.keys(data)
      });
      throw new Error("No valid token in response");
    }
    
    console.log("Token successfully extracted:", {
      type: typeof token,
      prefix: token.substring(0, 10),
      length: token.length
    });
    
    return token;
    
  } catch (error) {
    console.error("Token generation failed:", error);
    
    // 提供更詳細的錯誤訊息
    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
    }
    
    throw error;
  }
}
```

### 3. 更新 page.tsx
使用正確的認證方式連接 Realtime API。

**檔案：`app/page.tsx`**
```typescript
"use client";

import { useRef, useState, useEffect } from "react";
import { getSessionToken } from "./server/token";

export default function Home() {
  const [connected, setConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Array<{role: string, content: string}>>([]);
  
  const wsRef = useRef<WebSocket | null>(null);
  const audioStream = useRef<MediaStream | null>(null);

  async function connectWithWebSocket() {
    try {
      // 1. 取得 ephemeral token
      const token = await getSessionToken();
      console.log("Got token:", token ? "Yes" : "No");
      
      if (!token) {
        throw new Error("Failed to get authentication token");
      }
      
      // 2. 建立 WebSocket 連接 - 注意: token 必須在 URL 中或通過 headers
      // WebSocket 標準不支援自定義 headers，所以使用 URL 參數
      const ws = new WebSocket(
        `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01`,
        [],
        {
          headers: {
            "Authorization": `Bearer ${token}`,
            "OpenAI-Beta": "realtime=v1"
          }
        }
      );
      
      // 如果上面的方式不行，試試這個替代方案：
      // const ws = new WebSocket(
      //   `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01&session_token=${token}`
      // );
      
      ws.onopen = () => {
        console.log("WebSocket connected");
        
        // 送出初始設定
        ws.send(JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            instructions: "You are a helpful assistant.",
            voice: "alloy",
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
            input_audio_transcription: {
              model: "whisper-1"
            }
          }
        }));
        
        setConnected(true);
        initializeAudio();
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log("Received:", data.type);
        
        if (data.type === "response.audio.delta") {
          // 處理音訊回應
          playAudioDelta(data.delta);
        } else if (data.type === "response.text.delta") {
          // 處理文字回應
          updateMessages("assistant", data.delta);
        } else if (data.type === "error") {
          console.error("Server error:", data.error);
          setError(data.error.message);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        setError("WebSocket connection failed");
      };

      ws.onclose = () => {
        console.log("WebSocket closed");
        setConnected(false);
        setIsListening(false);
      };
      
      wsRef.current = ws;

    } catch (error) {
      console.error("Connection error:", error);
      setError(error instanceof Error ? error.message : String(error));
    }
  }

  async function initializeAudio() {
    try {
      // 取得麥克風權限
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 24000
        } 
      });
      
      audioStream.current = stream;
      setIsListening(true);
      
      // 設定音訊處理
      const audioContext = new AudioContext({ sampleRate: 24000 });
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      
      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);
          // 轉換為 PCM16
          const pcm16 = convertToPCM16(inputData);
          
          wsRef.current.send(JSON.stringify({
            type: "input_audio_buffer.append",
            audio: btoa(String.fromCharCode(...pcm16))
          }));
        }
      };
      
      source.connect(processor);
      processor.connect(audioContext.destination);
      
    } catch (error) {
      console.error("Audio initialization failed:", error);
      setError("Failed to access microphone");
    }
  }
  
  function convertToPCM16(float32Array: Float32Array): Uint8Array {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < float32Array.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Uint8Array(buffer);
  }

  function playAudioDelta(delta: string) {
    // 實作音訊播放邏輯
    console.log("Playing audio delta");
  }

  function updateMessages(role: string, content: string) {
    setMessages(prev => {
      const lastMsg = prev[prev.length - 1];
      if (lastMsg && lastMsg.role === role) {
        // 合併連續的訊息
        return [...prev.slice(0, -1), { role, content: lastMsg.content + content }];
      }
      return [...prev, { role, content }];
    });
  }

  async function onConnect() {
    if (connected) {
      // 斷開連接
      if (audioStream.current) {
        audioStream.current.getTracks().forEach(track => track.stop());
      }
      wsRef.current?.close();
      setConnected(false);
      setIsListening(false);
    } else {
      // 建立連接
      setError(null);
      await connectWithWebSocket();
    }
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Voice Agent Demo</h1>
      
      <div className="mb-6">
        <button
          onClick={onConnect}
          className={`px-6 py-3 rounded-md font-medium transition-colors ${
            connected 
              ? "bg-red-500 text-white hover:bg-red-600" 
              : "bg-black text-white hover:bg-gray-800"
          }`}
        >
          {connected ? "Disconnect" : "Connect"}
        </button>
        
        {connected && (
          <span className={`ml-4 inline-flex items-center ${isListening ? "text-green-500" : "text-gray-500"}`}>
            <span className={`w-3 h-3 rounded-full mr-2 ${isListening ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
            {isListening ? "Listening..." : "Ready"}
          </span>
        )}
      </div>
      
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
          Error: {error}
        </div>
      )}
      
      <div className="border border-gray-200 rounded-lg p-4 min-h-[400px]">
        <h2 className="text-lg font-semibold mb-3">Conversation</h2>
        <div className="space-y-2">
          {messages.map((msg, index) => (
            <div key={index} className={`p-3 rounded-md ${
              msg.role === "user" ? "bg-blue-50 ml-8" : "bg-gray-50 mr-8"
            }`}>
              <span className="font-medium">
                {msg.role === "user" ? "You" : "Assistant"}:
              </span>
              <span className="ml-2">{msg.content}</span>
            </div>
          ))}
          {messages.length === 0 && (
            <p className="text-gray-500 text-center mt-8">
              Press Connect and start speaking to begin the conversation
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
```

### 4. 檢查 .env 檔案
確保檔案在專案根目錄，格式正確：

**檔案：`.env`**
```
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxx
```
注意：不要有引號或額外空格

### 5. 套件相依性 (選擇性)
如果要使用官方 Realtime SDK，更新 package.json：

**檔案：`package.json`**
```json
{
  "dependencies": {
    "@openai/realtime-api-beta": "latest",
    "openai": "^4.67.0",
    "dotenv": "^17.2.3",
    "next": "15.3.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "server-only": "^0.0.1",
    "zod": "^3.25.49"
  }
}
```

### 6. 執行步驟

```bash
# 1. 清除快取
rm -rf .next

# 2. 重新安裝套件 (如果有更改 package.json)
npm install

# 3. 重新啟動開發伺服器
npm run dev
```

### 7. 驗證步驟

1. 開啟瀏覽器 http://localhost:3000
2. 打開開發者工具 Console
3. 點擊 Connect 按鈕
4. 檢查 Console 輸出：
   - Token 是否成功取得
   - WebSocket 連接狀態
   - 是否有錯誤訊息

### 8. 常見問題

**問題 1: OPENAI_API_KEY not found**
- 解決：確認 .env 檔案位置和格式
- 檢查：在 terminal 執行 `echo $OPENAI_API_KEY` (Mac/Linux) 或 `echo %OPENAI_API_KEY%` (Windows)

**問題 2: Missing bearer or basic authentication in header**
- 原因：API key 沒有正確傳送
- 解決方案：
  1. 確認 .env 檔案格式正確（無引號）
  2. 確認 API key 以 `sk-` 開頭
  3. 重啟開發伺服器
  4. 清除瀏覽器快取

**問題 3: Authentication failed (401 錯誤)**
- 檢查事項：
  1. API key 是否有效（到 OpenAI platform 確認）
  2. API key 是否有 Realtime API 權限
  3. 帳戶是否有足夠額度
  
**問題 4: WebSocket connection failed**  
- 解決：檢查防火牆和 proxy 設定

**問題 5: Failed to access microphone**
- 解決：
  1. 確保使用 HTTPS 或 localhost
  2. 瀏覽器允許麥克風權限
  3. 沒有其他應用程式佔用麥克風

### 9. 替代方案

如果 WebSocket 方式仍有問題，可以：
1. 使用官方的 `@openai/realtime-api-beta` SDK
2. 降級到較穩定的文字對話模式
3. 等待官方 SDK 更新

### 10. 完整替代方案 - 使用官方 SDK

如果上述方法仍有認證問題，使用官方 SDK 的正確方式：

**檔案：`app/page-sdk.tsx`**
```typescript
"use client";

import { useRef, useState } from "react";
import { RealtimeClient } from "@openai/realtime-api-beta";
import { getSessionToken } from "./server/token";

export default function Home() {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<Array<{role: string, content: string}>>([]);
  const clientRef = useRef<RealtimeClient | null>(null);

  async function connect() {
    try {
      // 取得 ephemeral token
      const token = await getSessionToken();
      
      // 建立 Realtime client
      const client = new RealtimeClient({
        apiKey: token,  // 使用 ephemeral key
        dangerouslyAllowAPIKeyInBrowser: true
      });
      
      // 設定事件處理
      client.on("conversation.updated", ({ item, delta }) => {
        if (item.type === "message") {
          setMessages(prev => [...prev, {
            role: item.role,
            content: item.formatted.text || item.formatted.transcript || ""
          }]);
        }
      });
      
      client.on("error", (error) => {
        console.error("Client error:", error);
      });
      
      // 更新 session 設定
      await client.updateSession({
        modalities: ["text", "audio"],
        instructions: "You are a helpful assistant.",
        voice: "alloy",
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        temperature: 0.8,
        input_audio_transcription: {
          model: "whisper-1"
        }
      });
      
      // 連接到 API
      await client.connect();
      
      // 開始麥克風串流
      await client.startStreaming();
      
      clientRef.current = client;
      setConnected(true);
      
    } catch (error) {
      console.error("Connection error:", error);
    }
  }

  async function disconnect() {
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
      setConnected(false);
    }
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Voice Agent Demo (SDK Version)</h1>
      <button
        onClick={connected ? disconnect : connect}
        className={`px-6 py-3 rounded-md ${
          connected ? "bg-red-500 text-white" : "bg-black text-white"
        }`}
      >
        {connected ? "Disconnect" : "Connect"}
      </button>
      <div className="mt-4">
        {messages.map((msg, i) => (
          <div key={i} className="mb-2">
            <strong>{msg.role}:</strong> {msg.content}
          </div>
        ))}
      </div>
    </div>
  );
}
```

**安裝官方 SDK：**
```bash
npm uninstall @openai/agents
npm install @openai/realtime-api-beta
```

## 注意事項

- 此修復移除了有問題的 WebRTC 實作，改用 WebSocket 直接連接
- 音訊處理部分需要根據實際 API 回應格式調整
- 生產環境需要更完善的錯誤處理和重連機制