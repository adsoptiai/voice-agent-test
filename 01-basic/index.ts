import { Agent, tool, run } from "@openai/agents";
import z from "zod";
import "dotenv/config";

const getWeather = tool({
  name: "getWeather",
  description: "Get the weather in a given location",
  parameters: z.object({
    location: z.string(),
  }),
  execute: async ({ location }) => {
    return `The weather in ${location} is sunny`;
  },
});

const agent = new Agent({
  name: "My Agent",
  instructions: "You are a helpful assistant.",
  model: "gpt-4o-mini",
  tools: [getWeather],
});

const result = await run(agent, "What is the weather in Tokyo?");

console.log(result.finalOutput);
