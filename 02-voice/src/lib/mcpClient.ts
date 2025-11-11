/**
 * MCP Client for gptr-mcp integration
 * This client communicates with the gptr-mcp server via HTTP
 */

export interface ResearchResult {
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

export interface QuickSearchResult {
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

class MCPClient {
  private apiUrl: string;

  constructor(apiUrl: string = "/api/research") {
    this.apiUrl = apiUrl;
  }

  /**
   * Perform deep research on a query
   */
  async deepResearch(query: string): Promise<ResearchResult> {
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tool: "deep_research",
          arguments: {
            query,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error("Error calling deep_research:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Perform quick search on a query
   */
  async quickSearch(query: string): Promise<QuickSearchResult> {
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tool: "quick_search",
          arguments: {
            query,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error("Error calling quick_search:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export const mcpClient = new MCPClient();
