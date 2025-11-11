/**
 * Research API Route
 * Handles research tool calls and forwards them to the gptr-mcp server
 */

import { NextRequest, NextResponse } from "next/server";

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "http://localhost:8000";

interface ToolCallRequest {
  tool: string;
  arguments: Record<string, any>;
}

/**
 * Call a tool on the MCP server using the MCP protocol over HTTP
 */
async function callMCPTool(tool: string, args: Record<string, any>) {
  try {
    // For SSE transport, we need to:
    // 1. Get a session ID from /sse endpoint
    // 2. Send MCP messages to /messages/?session_id=...

    // First, get a session ID
    const sseResponse = await fetch(`${MCP_SERVER_URL}/sse`, {
      method: "GET",
    });

    if (!sseResponse.ok) {
      throw new Error(`Failed to get session: ${sseResponse.status}`);
    }

    // Parse the SSE stream to get session ID
    const sseText = await sseResponse.text();
    const sessionMatch = sseText.match(/session_id=([a-f0-9-]+)/);

    if (!sessionMatch) {
      throw new Error("Could not extract session ID from SSE response");
    }

    const sessionId = sessionMatch[1];
    console.log("Got MCP session ID:", sessionId);

    // Initialize the MCP session
    const initResponse = await fetch(`${MCP_SERVER_URL}/messages/?session_id=${sessionId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {
            roots: {
              listChanged: true
            }
          },
          clientInfo: {
            name: "voice-agent",
            version: "1.0.0"
          }
        }
      }),
    });

    if (!initResponse.ok) {
      throw new Error(`Failed to initialize MCP session: ${initResponse.status}`);
    }

    // Call the tool
    const toolResponse = await fetch(`${MCP_SERVER_URL}/messages/?session_id=${sessionId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: tool,
          arguments: args
        }
      }),
    });

    if (!toolResponse.ok) {
      throw new Error(`Failed to call tool: ${toolResponse.status}`);
    }

    const result = await toolResponse.json();
    console.log("MCP tool call result:", result);

    return result;
  } catch (error) {
    console.error("Error calling MCP tool:", error);
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: ToolCallRequest = await request.json();
    const { tool, arguments: args } = body;

    console.log(`Calling tool: ${tool} with args:`, args);

    if (tool === "deep_research") {
      const result = await callMCPTool("deep_research", args);

      // Extract the actual data from the MCP response
      const mcpResult = result.result;
      if (mcpResult && mcpResult.content && mcpResult.content.length > 0) {
        const content = mcpResult.content[0];
        if (content.type === "text") {
          try {
            const data = JSON.parse(content.text);
            return NextResponse.json(data);
          } catch {
            // If not JSON, return as-is
            return NextResponse.json({
              success: true,
              data: {
                context: content.text
              }
            });
          }
        }
      }

      return NextResponse.json(result);
    } else if (tool === "quick_search") {
      const result = await callMCPTool("quick_search", args);

      // Extract the actual data from the MCP response
      const mcpResult = result.result;
      if (mcpResult && mcpResult.content && mcpResult.content.length > 0) {
        const content = mcpResult.content[0];
        if (content.type === "text") {
          try {
            const data = JSON.parse(content.text);
            return NextResponse.json(data);
          } catch {
            return NextResponse.json({
              success: true,
              data: {
                results: content.text
              }
            });
          }
        }
      }

      return NextResponse.json(result);
    } else {
      return NextResponse.json(
        { success: false, error: `Unknown tool: ${tool}` },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
