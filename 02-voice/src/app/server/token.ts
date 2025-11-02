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