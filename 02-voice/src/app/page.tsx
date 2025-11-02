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
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);

  async function connectWithWebSocket() {
    try {
      // 1. 取得 ephemeral token
      const token = await getSessionToken();
      console.log("Got token:", token ? "Yes" : "No");

      if (!token) {
        throw new Error("Failed to get authentication token");
      }

      // 2. 建立 WebSocket 連接
      // Browser WebSocket 不支援自定義 headers，必須使用 subprotocol 傳遞 token
      const url = `wss://api.openai.com/v1/realtime?model=gpt-realtime`;

      // 使用 OpenAI 的 ephemeral key 格式作為 subprotocol
      const ws = new WebSocket(url, [
        "realtime",
        `openai-insecure-api-key.${token}`,
        "openai-beta.realtime-v1"
      ]);

      ws.onopen = () => {
        console.log("WebSocket connected");

        // 送出初始設定
        ws.send(JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            instructions: "You are a helpful assistant.",
            voice: "shimmer",
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
        console.log("Received:", data.type, data);

        if (data.type === "response.audio.delta") {
          // 處理音訊回應
          playAudioDelta(data.delta);
        } else if (data.type === "response.audio_transcript.delta") {
          // 處理助理的轉寫文字
          updateMessages("assistant", data.delta);
        } else if (data.type === "conversation.item.input_audio_transcription.completed") {
          // 處理用戶語音轉寫
          updateMessages("user", data.transcript);
        } else if (data.type === "response.done") {
          // 回應完成
          console.log("Response completed");
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
      audioContextRef.current = audioContext;

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
    try {
      // 將 base64 音訊轉換為 PCM16
      const binaryString = atob(delta);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // 轉換為 Int16Array
      const pcm16 = new Int16Array(bytes.buffer);
      audioQueueRef.current.push(pcm16);

      // 如果還沒在播放，開始播放
      if (!isPlayingRef.current) {
        playAudioQueue();
      }
    } catch (error) {
      console.error("Audio playback error:", error);
    }
  }

  async function playAudioQueue() {
    if (!audioContextRef.current || audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }
    isPlayingRef.current = true;
    const audioContext = audioContextRef.current;

    while (audioQueueRef.current.length > 0) {
      const pcm16 = audioQueueRef.current.shift()!;

      // 轉換 Int16 為 Float32
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff);
      }

      // 創建音訊緩衝區
      const audioBuffer = audioContext.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);

      // 播放
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start();

      // 等待播放完成
      await new Promise(resolve => {
        source.onended = resolve;
      });
    }

    isPlayingRef.current = false;
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

      <div className="mb-6 flex items-center gap-4">
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
          <span className={`inline-flex items-center ${isListening ? "text-green-500" : "text-gray-500"}`}>
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