export type ToolSpec = {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export const FILE_TOOLS: ToolSpec[] = [
  {
    name: "fs_list",
    description: "List files and directories in the session worktree. Path is relative, use . for root. Cross-platform, do not use shell commands.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Relative directory, default ." } },
    },
  },
  {
    name: "fs_stat",
    description: "Metadata for a file or directory: size, type, modified time.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Relative path" } },
      required: ["path"],
    },
  },
  {
    name: "fs_read",
    description: "Read a text file from the worktree. Secrets are replaced with DETECTED_SECRET_<KIND>_<HASH> tokens. Do not pass absolute OS paths.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Relative file path" } },
      required: ["path"],
    },
  },
  {
    name: "fs_write",
    description: "Create or overwrite a text file in the worktree. Creates parent directories. For an existing file you must keep, use fs_append or fs_edit instead of overwriting.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path" },
        content: { type: "string", description: "Full file contents" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "fs_edit",
    description: "Replace exactly one occurrence of old with new in an existing worktree file. Fails if the snippet is missing or appears more than once. Prefer this over fs_write when changing a file. DETECTED_SECRET_* in old is matched against the real secret on disk.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path" },
        old: { type: "string", description: "Exact text to replace (one occurrence)" },
        new: { type: "string", description: "Replacement text" },
      },
      required: ["path", "old", "new"],
    },
  },
  {
    name: "fs_append",
    description: "Append text to a worktree file. Creates the file if it does not exist. Use this to add a line without losing existing content.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path" },
        content: { type: "string", description: "Text to append" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "fs_mkdir",
    description: "Create a directory in the worktree, including parents.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Relative directory path" } },
      required: ["path"],
    },
  },
  {
    name: "fs_search",
    description: "Search file contents in the worktree. Skips .git, node_modules, dist. A DETECTED_SECRET_* query matches the real secret on disk.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring to find" },
        path: { type: "string", description: "Relative start directory, default ." },
      },
      required: ["query"],
    },
  },
  {
    name: "fs_remove",
    description: "Delete a file or empty directory in the worktree. Cannot delete the worktree root.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Relative path" } },
      required: ["path"],
    },
  },
];

export const SHELL_TOOL: ToolSpec = {
  name: "shell",
  description:
    "Run a command in the session worktree and wait (up to 120s). Cross-platform: cmd.exe on Windows, /bin/sh elsewhere. cwd is the worktree. For builds/servers that take longer, process_spawn then process_logs. Prefer fs_* for files. Privileged, recursive wipe, and remote|sh commands are blocked. DETECTED_SECRET_* in the command is substituted with the real secret before exec; stdout is remasked.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Command line to run in the worktree" },
    },
    required: ["command"],
  },
};

export const PLUGIN_TOOLS: ToolSpec[] = [
  {
    name: "plugin_list",
    description: "List plugins around the kernel: ~/.barney/plugins, legacy skills/mcp, and AgentSkills from Claude/OpenCode/Claw if those folders exist. Check before writing a new one.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "plugin_write",
    description:
      "Create or update a plugin outside the kernel. Files go to ~/.barney/plugins/<name>/. Typical files: plugin.json, SKILL.md or PLUGIN.md, ui.html, mcp.json. Then plugin_read or plugin_open.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "kebab-case plugin name, e.g. file-viewer" },
        path: { type: "string", description: "File inside the plugin, e.g. ui.html or plugin.json" },
        content: { type: "string", description: "Full file contents" },
      },
      required: ["name", "path", "content"],
    },
  },
  {
    name: "plugin_read",
    description: "Read a plugin skill body from ~/.barney (SKILL.md / PLUGIN.md, or a path inside the plugin). Use after plugin_list when the one-line index is not enough.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Plugin name" },
        path: { type: "string", description: "Optional file inside the plugin, e.g. SKILL.md" },
      },
      required: ["name"],
    },
  },
  {
    name: "plugin_open",
    description: "Open a plugin UI in the portal. Reuse an existing plugin instead of rewriting it.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Plugin name" },
        path: { type: "string", description: "Optional worktree file to show" },
      },
      required: ["name"],
    },
  },
];

export const WEB_SEARCH_TOOL: ToolSpec = {
  name: "web_search",
  description:
    "Search the public web. Returns titles, full URLs, and snippets. Then browser_open at least two sources and verify. Do not answer from snippets alone.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "Search query" } },
    required: ["query"],
  },
};

export const BROWSER_TOOLS: ToolSpec[] = [
  {
    name: "browser_open",
    description:
      "Open an http(s) page in the hidden agent browser and extract visible text. Does not show a window to the operator. Use browser_show only if they asked to see the page.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "http(s) URL" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_read",
    description: "Read visible text of the currently open page.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "browser_screenshot",
    description:
      "Take a screenshot of the current page (or open url first). The image is for you only. Do not show the operator unless they asked — then use browser_show.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Optional URL to open first" },
        fullPage: { type: "string", description: "true for full-page shot" },
      },
    },
  },
  {
    name: "browser_show",
    description: "Show the current page or a URL to the operator in a portal modal. Use only when they asked to see the site.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "Optional URL; defaults to the open page" } },
    },
  },
  {
    name: "browser_click",
    description: "Click an element on the open page. Prefer visible text; use a CSS selector when text is ambiguous.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Visible text to click" },
        selector: { type: "string", description: "CSS selector, e.g. button.submit or #login" },
      },
    },
  },
  {
    name: "browser_fill",
    description: "Fill an input/textarea on the open page. Then browser_press Enter if you need to submit.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of the field" },
        value: { type: "string", description: "Text to type" },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: "browser_press",
    description: "Press a keyboard key on the open page, e.g. Enter, Tab, Escape.",
    parameters: {
      type: "object",
      properties: { key: { type: "string", description: "Key name, e.g. Enter" } },
      required: ["key"],
    },
  },
  {
    name: "browser_scroll",
    description: "Scroll the open page. Positive dy scrolls down.",
    parameters: {
      type: "object",
      properties: { dy: { type: "string", description: "Pixels, default 600. Negative scrolls up." } },
    },
  },
];

export const MEMORY_TOOLS: ToolSpec[] = [
  {
    name: "memory_search",
    description: "Search shared long-term memory and past episodes. Use before planning or repeating work.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Keywords, task class, or skill name" } },
      required: ["query"],
    },
  },
  {
    name: "memory_write",
    description: "Save a durable note to shared memory (all agents). Upserts by key. Write lessons, facts, and subtask results.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "Stable id, e.g. lesson/api-auth or plan/checkout" },
        title: { type: "string", description: "Short title" },
        body: { type: "string", description: "What to remember" },
        tags: { type: "string", description: "Comma tags, e.g. lesson,auth" },
      },
      required: ["title", "body"],
    },
  },
  {
    name: "memory_read",
    description: "Read one shared memory note by key or id.",
    parameters: {
      type: "object",
      properties: { key: { type: "string", description: "Memory key or id" } },
      required: ["key"],
    },
  },
  {
    name: "board_write",
    description: "Pin a session board row. Motive is the operator goal and cannot be replaced. action/operation are the current turn.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", description: "motive | action | operation | fact | blocker | decision | note" },
        text: { type: "string", description: "One concrete line" },
      },
      required: ["kind", "text"],
    },
  },
  {
    name: "board_read",
    description: "Read the session board (facts, blockers, decisions).",
    parameters: { type: "object", properties: {} },
  },
];

export const TEAM_TOOLS: ToolSpec[] = [
  {
    name: "plan_set",
    description: "Save a multi-step plan for this session. One task per line. For large goals, plan first, then spawn/delegate.",
    parameters: {
      type: "object",
      properties: { tasks: { type: "string", description: "Newline-separated tasks. Prefix with [plugin:name] or [agent:name] if known." } },
      required: ["tasks"],
    },
  },
  {
    name: "agent_list",
    description: "List specialist agents that can take delegated subtasks.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "agent_spawn",
    description: "Create a specialist sub-agent for a class of tasks. Pin existing plugins. Then agent_delegate a concrete subtask.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "kebab or short name, e.g. docs-writer" },
        task: { type: "string", description: "What this specialist is for" },
        skills: { type: "string", description: "Comma plugin names to pin" },
      },
      required: ["name", "task"],
    },
  },
  {
    name: "agent_delegate",
    description: "Run a subtask with a specialist (same worktree, nested session). The child writes results to shared memory. Do not nest further.",
    parameters: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Agent name or id" },
        task: { type: "string", description: "Concrete subtask" },
      },
      required: ["agent", "task"],
    },
  },
];

export const PROCESS_TOOLS: ToolSpec[] = [
  {
    name: "process_spawn",
    description: "Start a long-running command in the worktree without the shell timeout. Then process_logs / process_kill. Same deny list as shell.",
    parameters: {
      type: "object",
      properties: { command: { type: "string", description: "Command line to run in the worktree" } },
      required: ["command"],
    },
  },
  {
    name: "process_list",
    description: "List background processes started in this session.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "process_logs",
    description: "Read stdout/stderr captured so far from a background process.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Id from process_spawn, e.g. proc_ab12cd34" } },
      required: ["id"],
    },
  },
  {
    name: "process_kill",
    description: "Stop a background process started with process_spawn.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Id from process_spawn" } },
      required: ["id"],
    },
  },
];

export const MCP_TOOLS: ToolSpec[] = [
  {
    name: "mcp_list",
    description: "List MCP recipes in ~/.barney/plugins and which servers are running.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "mcp_write",
    description: "Save an MCP recipe as a plugin (~/.barney/plugins/<name>/mcp.json). Then mcp_start. Prefer a UI/prompt plugin if that is enough.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "kebab-case, e.g. context7" },
        command: { type: "string", description: "Executable, e.g. npx" },
        args: { type: "string", description: "Space-separated args, e.g. -y @upstash/context7-mcp" },
        description: { type: "string", description: "What this MCP is for" },
      },
      required: ["name", "command"],
    },
  },
  {
    name: "mcp_start",
    description: "Start an MCP server from a saved recipe (stdio JSON-RPC) and list its tools. Then mcp_call.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "Recipe / plugin name" } },
      required: ["name"],
    },
  },
  {
    name: "mcp_call",
    description: "Call a tool on a running MCP server. mcp_start first if it is not running.",
    parameters: {
      type: "object",
      properties: {
        server: { type: "string", description: "MCP server name" },
        tool: { type: "string", description: "Tool name from mcp_start" },
        arguments: { type: "string", description: "JSON object of tool arguments" },
      },
      required: ["server", "tool"],
    },
  },
  {
    name: "mcp_stop",
    description: "Stop a running MCP server. The recipe on disk stays.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "Server name" } },
      required: ["name"],
    },
  },
];

export const SELF_TOOLS: ToolSpec[] = [
  {
    name: "self_status",
    description: "Status of ~/.barney as a local git body (Self, plugins). Kernel is not in this repo.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "self_log",
    description: "History of how the agent became itself in ~/.barney.",
    parameters: {
      type: "object",
      properties: { limit: { type: "string", description: "How many commits, default 12" } },
    },
  },
  {
    name: "self_commit",
    description: "Apply the current becoming: commit tracked home files (self/, plugins/). Not the kernel.",
    parameters: {
      type: "object",
      properties: { message: { type: "string", description: "What changed in the body" } },
    },
  },
  {
    name: "self_rollback",
    description: "Roll back ~/.barney tracked body to a previous commit. Sessions/sqlite stay. Not the kernel.",
    parameters: {
      type: "object",
      properties: { rev: { type: "string", description: "Commit sha or HEAD~1" } },
      required: ["rev"],
    },
  },
];

export const AGENT_TOOLS: ToolSpec[] = [...FILE_TOOLS, SHELL_TOOL, WEB_SEARCH_TOOL, ...PLUGIN_TOOLS, ...BROWSER_TOOLS, ...MEMORY_TOOLS, ...TEAM_TOOLS, ...PROCESS_TOOLS, ...MCP_TOOLS, ...SELF_TOOLS];
export const CHILD_TOOLS: ToolSpec[] = AGENT_TOOLS.filter((tool) => !["agent_spawn", "agent_delegate", "plan_set", "self_rollback"].includes(tool.name));
