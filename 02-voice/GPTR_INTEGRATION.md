# GPT Researcher MCP Integration

This document describes the integration of GPT Researcher MCP (gptr-mcp) as a tool in the 02-voice agent, enabling real-time web research capabilities during voice conversations.

## Overview

The voice agent now has access to two research tools:
- **deep_research**: Comprehensive web research with multiple sources
- **quick_search**: Fast web search for quick answers

When users ask questions requiring current information (stock prices, news, company info, etc.), the assistant will automatically use these tools.

## Architecture

```
Voice Agent (Browser)
    ↓ WebSocket
OpenAI Realtime API
    ↓ Function Calls
Next.js API Route (/api/research)
    ↓ MCP Protocol (HTTP/SSE)
gptr-mcp Server (Python)
    ↓
GPT Researcher
```

## Setup Instructions

### 1. Start the gptr-mcp Server

The gptr-mcp server must be running in SSE mode on port 8000.

**Windows:**
```bash
cd ..\..\gptr-mcp
start-sse.bat
```

**Mac/Linux:**
```bash
cd ../../gptr-mcp
export MCP_TRANSPORT=sse
python server.py
```

You should see:
```
🚀 GPT Researcher MCP Server starting with sse transport...
```

### 2. Start the Voice Agent

In a new terminal:

```bash
npm run dev
```

The Next.js app will start on http://localhost:3000

### 3. Test the Integration

1. Open http://localhost:3000 in your browser
2. Click "Connect" to start the voice agent
3. Grant microphone permissions
4. Try asking research questions like:
   - "What's the current stock price of NVIDIA?"
   - "Tell me about the latest AI developments"
   - "What's happening in tech news today?"

## Features

### Visual Indicators

- **Green pulse**: Microphone is listening
- **Blue pulse**: Assistant is speaking
- **Purple pulse**: Research in progress
- **Orange button**: Manual interrupt button

### Research Messages

When research is triggered, you'll see system messages in the conversation:
- 🔍 Researching: [query]...
- 🔍 Searching: [query]...

### Conversation Flow

1. User asks a question requiring current information
2. Assistant recognizes the need for research
3. Assistant calls the appropriate research tool
4. System shows "Researching..." indicator
5. Research completes and results are returned
6. Assistant speaks the answer based on research

## Configuration

### Environment Variables

**02-voice/.env:**
```env
OPENAI_API_KEY=your_openai_api_key
MCP_SERVER_URL=http://localhost:8000
```

**gptr-mcp/.env:**
```env
OPENAI_API_KEY=your_openai_api_key
TAVILY_API_KEY=your_tavily_api_key
```

### Customizing Tools

Tools are configured in `src/config/realtime.ts`:

```typescript
tools: [
  {
    type: "function",
    name: "deep_research",
    description: "...",
    parameters: { ... }
  },
  {
    type: "function",
    name: "quick_search",
    description: "...",
    parameters: { ... }
  }
]
```

## Files Modified/Created

### New Files
- `src/lib/mcpClient.ts` - MCP client for communicating with gptr-mcp
- `src/app/api/research/route.ts` - API route for handling research requests
- `GPTR_INTEGRATION.md` - This documentation

### Modified Files
- `src/config/realtime.ts` - Added tools configuration
- `src/app/page.tsx` - Added function call handling
- `.env` - Added MCP_SERVER_URL

## Troubleshooting

### gptr-mcp server not starting
- Check that Python is installed and requirements are met
- Verify API keys are set in gptr-mcp/.env
- Check port 8000 is not in use

### Research not working
- Ensure gptr-mcp server is running (check http://localhost:8000/health)
- Check browser console for errors
- Verify MCP_SERVER_URL in .env

### Function calls not triggered
- Check that tools are included in session.update
- Look for function_call events in console logs
- Verify instructions mention when to use research tools

## API Reference

### mcpClient.deepResearch(query)

Performs comprehensive web research.

**Parameters:**
- `query` (string): The research query

**Returns:**
```typescript
{
  success: boolean;
  data?: {
    research_id: string;
    query: string;
    source_count: number;
    context: string;
    sources: Array<{
      title: string;
      url: string;
      content: string;
    }>;
    source_urls: string[];
  };
  error?: string;
}
```

### mcpClient.quickSearch(query)

Performs fast web search.

**Parameters:**
- `query` (string): The search query

**Returns:**
```typescript
{
  success: boolean;
  data?: {
    search_id: string;
    query: string;
    result_count: number;
    search_results: Array<{
      title: string;
      url: string;
      snippet: string;
    }>;
  };
  error?: string;
}
```

## Next Steps

- Add more research tools (write_report, get_research_sources, etc.)
- Implement caching for repeated queries
- Add user preferences for research depth
- Create dashboard for viewing research history

## Support

For issues or questions:
- Check the console logs (browser and server)
- Review the gptr-mcp README: https://github.com/assafelovic/gptr-mcp
- Check OpenAI Realtime API documentation
