require("dotenv").config();
const OpenAI = require("openai");

async function main() {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const session = await client.beta.realtime.sessions.create({
    model: "gpt-4o-realtime-preview-2024-10-01",
    voice: "alloy",
  });
  console.log("client_secret:", session.client_secret);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
