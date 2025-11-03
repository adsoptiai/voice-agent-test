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
  const isAssistantSpeakingRef = useRef(false);
  const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const lastInterruptTimeRef = useRef(0);
  const speechFramesRef = useRef(0);

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
            instructions:
            `You are a helpful assistant. You speak traditional chinese well. You also have Taiwan accent.
            Voice: Warm, empathetic, and professional, engaging reassuring the customer that their issue is understood and will be resolved.
            Punctuation: Well-structured with natural pauses, allowing for clarity and a steady, calming flow.
            Delivery: Calm and patient, with a supportive and understanding tone that reassures the listener, with a lively and playful tone.
            `,
            voice: "shimmer",
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
            input_audio_transcription: {
              model: "whisper-1"
            },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 200
            }
          }
        }));

        setConnected(true);
        initializeAudio();
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log("Received:", data.type, data);

        if (data.type === "session.created" || data.type === "session.updated") {
          console.log("Session configured:", data);
        } else if (data.type === "input_audio_buffer.speech_started") {
          console.log("User started speaking");
        } else if (data.type === "input_audio_buffer.speech_stopped") {
          console.log("User stopped speaking");
        } else if (data.type === "input_audio_buffer.committed") {
          console.log("Audio buffer committed");
        } else if (data.type === "conversation.item.created") {
          console.log("Conversation item created:", data.item);
        } else if (data.type === "response.created") {
          console.log("Response created, assistant will speak");
        } else if (data.type === "response.audio.delta") {
          // 處理音訊回應
          isAssistantSpeakingRef.current = true;
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
          isAssistantSpeakingRef.current = false;
        } else if (data.type === "response.audio.done") {
          // 音訊播放完成
          isAssistantSpeakingRef.current = false;
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

  function interrupt() {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const now = Date.now();
      // Prevent rapid successive interruptions (cooldown: 1 second)
      if (now - lastInterruptTimeRef.current < 1000) {
        return;
      }
      lastInterruptTimeRef.current = now;

      console.log("Interrupting assistant...");

      // Cancel the current response
      wsRef.current.send(JSON.stringify({
        type: "response.cancel"
      }));

      // Stop current audio playback
      if (currentAudioSourceRef.current) {
        try {
          currentAudioSourceRef.current.stop();
          currentAudioSourceRef.current = null;
        } catch (e) {
          // Already stopped
        }
      }

      // Clear audio queue
      audioQueueRef.current = [];
      isPlayingRef.current = false;
      isAssistantSpeakingRef.current = false;
      speechFramesRef.current = 0;
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

          // TEMPORARILY DISABLED: Calculate audio level to detect speech
          // let sum = 0;
          // for (let i = 0; i < inputData.length; i++) {
          //   sum += Math.abs(inputData[i]);
          // }
          // const average = sum / inputData.length;

          // TEMPORARILY DISABLED: Detect sustained speech before interrupting
          // Higher threshold (0.05) and requires 3 consecutive frames
          // if (isAssistantSpeakingRef.current) {
          //   if (average > 0.05) {
          //     speechFramesRef.current++;
          //     // Only interrupt after detecting speech for 3 consecutive frames (~300ms)
          //     if (speechFramesRef.current >= 3) {
          //       interrupt();
          //     }
          //   } else {
          //     speechFramesRef.current = 0;
          //   }
          // }

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

      // Store reference to current source for interruption
      currentAudioSourceRef.current = source;
      source.start();

      // 等待播放完成
      await new Promise(resolve => {
        source.onended = resolve;
      });

      // Clear reference after playback
      if (currentAudioSourceRef.current === source) {
        currentAudioSourceRef.current = null;
      }
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
      interrupt(); // Stop any ongoing playback
      if (audioStream.current) {
        audioStream.current.getTracks().forEach(track => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      wsRef.current?.close();
      setConnected(false);
      setIsListening(false);
      isAssistantSpeakingRef.current = false;
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