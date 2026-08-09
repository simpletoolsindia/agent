# Agent

A TypeScript coding-agent prototype with exactly five workspace tools:

| Tool | Purpose |
| --- | --- |
| `read` | Read files or list directories inside the workspace. |
| `search` | Search code quickly with ripgrep. |
| `write` | Create or replace a file atomically. |
| `update` | Edit exact line ranges with file-hash and range-hash checks. |
| `bash` | Run one focused, non-interactive shell command. |

It can run with Ollama through Ollama's OpenAI-compatible API.

## What you get

- One-shot CLI agent: `harness ai ...` after `./install.sh`, or `npm run cli -- ai ...` inside the clone
- Interactive terminal UI: `harness tui --setup` after install, or `npm run tui -- ...` inside the clone
- Local Ollama setup shortcut in TUI: `/settings ollama`
- Local Ollama support: `--base-url http://localhost:11434/v1 --api-key ollama`
- Safer edits: `update` refuses stale file hashes and wrong line ranges
- Benchmarks and correctness checks
- Shared CLI/TUI agent loop with step logging, stable tool ordering, failure recovery hints, context compaction, and a higher safety step limit for long tasks
- Shell-string `bash` commands, so prompts can ask for `npm run build` directly

## Requirements

Install these first:

- Node.js 20 or newer
- npm
- Git
- Ollama, if you want local models

Check Node:

```bash
node --version
npm --version
```

## Install Agent

Run this from an already cloned repository:

```bash
cd /path/to/agent
./install.sh
```

The installer:

1. checks for Node.js 20+ and npm,
2. installs dependencies with `npm ci` when `package-lock.json` exists,
3. builds TypeScript,
4. smoke-checks the CLI help output,
5. links `harness` into `${HOME}/.local/bin` by default.

Add the install directory to your shell profile if needed:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Manual equivalent without linking:

```bash
npm ci
npm run build
npm run cli -- --help
```

Version and uninstall:

```bash
./version.sh
./uninstall.sh
```

Custom install location:

```bash
HARNESS_INSTALL_BIN_DIR=/usr/local/bin ./install.sh
```

## Install and start Ollama

Download Ollama:

```txt
https://ollama.com/download
```

Linux install command:

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Start Ollama:

```bash
ollama serve
```

If Ollama is already installed as a service, `ollama serve` may say the address is already in use. That is fine.

Check Ollama:

```bash
curl http://localhost:11434/v1/models
```

## Pull a model

Small coding model:

```bash
ollama pull qwen2.5-coder:7b
```

Stronger tool-calling models may work better:

```bash
ollama pull gpt-oss:20b
ollama pull qwen3:8b
```

Use the same model name in `--model`.

## Quick start with Ollama

Run one request:

```bash
npm run cli -- ai \
  --prompt "Read package.json and explain the scripts" \
  --model qwen2.5-coder:7b \
  --base-url http://localhost:11434/v1 \
  --api-key ollama
```

Run against another project:

```bash
npm run cli -- ai \
  --cwd /path/to/your/project \
  --prompt "Search for TODO comments and summarize them" \
  --model qwen2.5-coder:7b \
  --base-url http://localhost:11434/v1 \
  --api-key ollama
```

Run the terminal UI. The default UI density is `compact`, so tool-heavy sessions stay readable while the interface stays rich and animated:

```bash
npm run tui -- \
  --cwd /path/to/your/project \
  --model qwen2.5-coder:7b \
  --base-url http://localhost:11434/v1 \
  --api-key ollama \
  --ui-density compact
```

The one-shot CLI now follows the Oh My Pi cockpit style: rounded panels, segmented metric strips, stage timelines, and animated `AI running` status. The TUI opens an OMP-inspired setup cockpit when key connection settings are missing. Use it to edit model name, OpenAI-compatible server URL, API key, approval mode, `agent.md`, and `skills.md` before the chat starts. The setup screen groups connection and workspace fields, shows active profile chips, docs count, keyboard shortcuts, a live spinner, and bounded status/progress rows for narrow terminals. During model/tool work the chat UI shows rounded message cards, `You` / `Assistant · reply` / `Thinking` labels, streamed reasoning, inline tool progress, `bash` command status, parallel tool counts, scroll hints, stage timelines, and rotating usage suggestions such as when to use `search`, `read`, `update`, `write`, `bash`, `/settings`, `/agents`, `/sessions`, and `/compact`. The title uses a compact status-line style with workspace, model, approval mode, context usage, and slash-command hints. `--context-size` defaults to `32768`.

UI density presets:

| Preset | Tool cards | Reasoning | Use when |
| --- | --- | --- | --- |
| `compact` | collapsed | auto-collapsed | Default. Shows inline progress and rotating suggestions without full reasoning spam. |
| `normal` | auto-collapsed | collapsed | Shows the latest active tool with more detail. |
| `debug` | full | full | Shows full tool input/output and reasoning. |

Override a preset when needed:

```bash
npm run tui -- --ui-density compact --tool-display auto-collapsed
```

Provider setup cockpit controls:

| Key | Action |
| --- | --- |
| `Tab` / `↓` | Move to the next field. |
| `↑` | Move to the previous field. |
| `Enter` | Move next, or start from the final markdown field. |
| `Ctrl+S` | Start the TUI with the current values. |
| `Ctrl+O` | Fill Ollama provider defaults: `qwen2.5-coder:7b`, `http://localhost:11434/v1`, `ollama`. |
| `Ctrl+A` | Toggle approval mode between `safe` and `auto`. |
| `Ctrl+D` | Use the default OpenAI endpoint by clearing server URL and API key. |
| `Ctrl+U` | Clear the active field. |
| Markdown fields | Optional workspace-relative paths for extra agent and skill instructions. |

Resumable sessions:

```bash
npm run tui -- --resume               # resume the latest session for this workspace
npm run tui -- --resume smoke-session # resume a specific saved session
npm run tui -- --no-resume            # start clean
npm run cli -- sessions               # list the five saved sessions
```

Saved TUI sessions keep the latest five local conversations in `~/.harness-tools/sessions.json`.

Force the setup screen even when values are already supplied:

```bash
npm run tui -- --setup
```

Skip it:

```bash
npm run tui -- --no-setup
```

TUI slash commands run locally and do not spend an LLM call:

| Command | Action |
| --- | --- |
| `/settings menu` | Show quick setup shortcuts, active values, and examples. |
| `/settings ollama` | Configure local Ollama defaults in one command. |
| `/settings openai` | Clear the custom endpoint and use OpenAI default. |
| `/settings help` | Show all settings commands. |
| `/settings model <id>` | Switch the model for future turns. |
| `/settings base-url <url>` | Switch OpenAI-compatible endpoint for future turns; `none` clears it. |
| `/settings api-key <key>` | Update the API key; use `none` to unset it. |
| `/settings approval safe\|auto` | Change approval mode without restarting the TUI. |
| `/settings agent-md <path>` | Load additional agent instructions markdown for future turns. |
| `/settings skills-md <path>` | Load additional skills markdown for future turns. |
| `/compact` | Drop slash-command chatter and prune older tool-heavy history for future turns. |
| `/agents` | Show the built-in read-only subagent roles and simplified task payload format. |

Long model starts show a lightweight processing indicator before streaming begins.

## Important Ollama settings

Use this base URL:

```txt
http://localhost:11434/v1
```

Use this API key:

```txt
ollama
```

Ollama ignores the key value, but OpenAI-compatible clients require the field.

Quick raw Ollama test:

```bash
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2.5-coder:7b",
    "messages": [{ "role": "user", "content": "Say hello" }],
    "stream": false
  }'
```

If this curl command fails, fix Ollama before running Agent.

## Approval modes

Default mode is `safe`.

In `safe` mode, the agent asks before tools that can change files or run commands:

- `write`
- `update`
- `bash`

In the TUI these tools are labeled with `Approval required · ...`, so approval requests are easier to notice even when tool cards are collapsed.

Choose safe mode explicitly:

```bash
npm run tui -- \
  --approval-mode safe \
  --model qwen2.5-coder:7b \
  --base-url http://localhost:11434/v1 \
  --api-key ollama
```

Choose auto mode when working in a trusted or disposable workspace:

```bash
npm run tui -- \
  --approval-mode auto \
  --model qwen2.5-coder:7b \
  --base-url http://localhost:11434/v1 \
  --api-key ollama
```

Shortcut:

```bash
npm run tui -- --auto-approve
```

`--auto-approve` is the same as `--approval-mode auto`.

## CLI reference

### One-shot agent

```bash
npm run cli -- ai --prompt "your task" [options]
```

Options:

```txt
-p, --prompt <prompt>   Required. User task for the agent.
--cwd <path>            Workspace root. Default: current project.
--model <model>         Model name. Default: gpt-4o-mini.
--base-url <url>        OpenAI-compatible API base URL.
--api-key <key>         API key.
--provider-name <name>  Name used in logs.
--approval-mode <mode>  Approval mode: safe|auto. Default: safe.
--agent-md <path>      Load extra agent instructions markdown from the workspace.
--skills-md <path>     Load extra skills markdown from the workspace.
--auto-approve          Shortcut for --approval-mode auto.
-h, --help              Show help.
```

### Terminal UI

```bash
npm run tui -- [options]
```

Options:

```txt
--cwd <path>                 Workspace root. Default: current project.
--model <model>              Model name. Default: gpt-4o-mini.
--base-url <url>             OpenAI-compatible API base URL.
--api-key <key>              API key.
--provider-name <name>       Name used in logs.
--approval-mode <mode>       Approval mode: safe|auto. Default: safe.
--auto-approve               Shortcut for --approval-mode auto.
--agent-md <path>           Load extra agent instructions markdown from the workspace.
--skills-md <path>          Load extra skills markdown from the workspace.
--context-size <tokens>      Show context usage percentage in the TUI title. Default: 32768.
--ui-density <mode>          UI preset: compact|normal|debug. Default: compact.
--tool-display <mode>        Override tool cards: full|collapsed|auto-collapsed|hidden.
--reasoning-display <mode>   Override reasoning: full|collapsed|auto-collapsed|hidden.
--resume [id]                Resume the latest saved session or a specific session id.
--no-resume                  Start without loading a saved session.
--session-id <id>            Stable id to use when saving this TUI session.
--setup                     Always open the rich provider setup UI before chat.
--no-setup                  Skip the provider setup UI.
-h, --help                   Show help.
```

Useful TUI slash commands:

```txt
/settings menu              Show setup cockpit, active config, examples, and a runtime tip.
/settings ollama            Configure local Ollama defaults.
/settings auto              Turn on auto approval for tools that support it.
/settings safe              Turn approval prompts back on.
/settings model <id>        Switch model for future turns.
/sessions                   List the five saved resumable sessions.
/agents                     Show read-only subagent delegation modes.
/compact                    Drop old slash chatter and tool-heavy history.
```

## Safety model

| Tool | Reads files | Changes files | Runs commands | Approval by default |
| --- | --- | --- | --- | --- |
| `read` | yes | no | no | no |
| `search` | yes | no | yes, ripgrep only | no |
| `write` | no | yes | no | yes |
| `update` | no | yes | no | yes |
| `bash` | maybe | maybe | yes | yes |

`update` is designed for safer edits. It requires:

1. current file hash,
2. expected edited-range hash,
3. exact start line,
4. exact end line,
5. non-overlapping edit ranges.

If the file changed after the model read it, the edit is rejected.

## Agent loop

CLI and TUI use the same `ToolLoopAgent` setup:

- stable tool order: `subagent`, `search`, `read`, `update`, `write`, `bash`
- step logs with finish reason, tool names, token usage, and elapsed time
- targeted recovery hints after failed tool results
- automatic context compaction for long sessions
- read-only subagent delegation for broad research, review, and non-mutating plans; only `taskGoal` is required, with optional reference files when known
- high safety step limit for long tasks; the model is instructed not to final-answer while requested work remains
- non-trivial tasks start with a sequential task list containing goal, current folder path, reference files, implementation steps, validation, expected outcome, and clean-code/SOLID notes
- subagent calls are encouraged for context-heavy steps, then the main agent inspects the result, validates the task, and continues
- repository context comes from `search` and `read`; the agent is instructed not to run git commands just to provide context to the LLM
- optional `--agent-md <path>` and `--skills-md <path>` append workspace markdown instructions to the agent prompt
- independent `subagent`, `search`, `read`, and `bash` calls are issued in the same model step when possible so the AI SDK executes them in parallel; `write` and `update` stay serialized when they touch the same file
- the TUI renderer patch makes upstream `@ai-sdk/tui` look closer to Oh My Pi: rounded viewport chrome, renamed chat sections, richer code fences, scrollbar, and progress footer
- `write` and `update` return compact diff summaries plus best-effort LSP diagnostics for edited files

`bash` accepts one shell command string and runs it in the selected workspace:

```json
{ "command": "npm run build", "cwd": ".", "timeoutMs": 120000 }
```

The command output includes `exitCode`, `stdout`, `stderr`, byte counts, and a `truncated` flag. Non-zero command exits are returned as command results so the agent can inspect and fix them.

## Development commands

```bash
npm run build
npm run cli -- --help
npm run correctness
npm run benchmark
```

## Troubleshooting

### `ECONNREFUSED` or connection failed

Ollama is not running.

Start it:

```bash
ollama serve
```

Check it:

```bash
curl http://localhost:11434/v1/models
```

### Model not found

Pull the model:

```bash
ollama pull qwen2.5-coder:7b
```

Then run Agent again.

### Model replies but does not use tools correctly

Try a stronger model:

```bash
ollama pull gpt-oss:20b
npm run cli -- ai \
  --prompt "Read package.json and explain scripts" \
  --model gpt-oss:20b \
  --base-url http://localhost:11434/v1 \
  --api-key ollama
```

### TUI has display problems

First check the one-shot CLI:

```bash
npm run cli -- ai \
  --prompt "Read package.json and explain scripts" \
  --model qwen2.5-coder:7b \
  --base-url http://localhost:11434/v1 \
  --api-key ollama
```

If that works, retry TUI:

```bash
npm run tui -- \
  --model qwen2.5-coder:7b \
  --base-url http://localhost:11434/v1 \
  --api-key ollama
```

## Use another OpenAI-compatible provider

```bash
npm run cli -- ai \
  --prompt "Read package.json" \
  --model your-model \
  --base-url https://your-provider.example/v1 \
  --api-key "$API_KEY"
```

For OpenAI, omit `--base-url`:

```bash
npm run cli -- ai \
  --prompt "Read package.json" \
  --model gpt-4o-mini \
  --api-key "$OPENAI_API_KEY"
```
