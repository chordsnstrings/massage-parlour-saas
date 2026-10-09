import { handleMetaMcpRequest } from '@spa/ai'

// R7 first-party Meta MCP server (Streamable HTTP, stateless). Auth = a 5-minute per-tenant token from
// signMcpToken (@spa/ai); the agents normally call it in-process, this route serves out-of-process MCP clients.
export const dynamic = 'force-dynamic'

const handle = (req: Request) => handleMetaMcpRequest(req)

export { handle as DELETE, handle as GET, handle as POST }
