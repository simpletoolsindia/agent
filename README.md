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

- One-shot CLI agent: `npm run cli -- ai ...`
- Interactive terminal UI: `npm run tui -- ...`
- Local Ollama support: `--base-url http://localhost:11434/v1 --api-key ollama`
- Safer edits: `update` refuses stale file hashes and wrong line ranges
- Benchmarks and correctness checks
- Shared CLI/TUI agent loop with step logging, stable tool ordering, failure recovery hints, and context compaction
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

```bash
git clone https://github.com/simpletoolsindia/agent.git
cd agent
npm install
npm run build
```

Check that the CLI works:

```bash
npm run cli -- --help
```

You should see:

```txt
Commands:
  ai   Run one OpenAI-compatible LLM request
  tui  Open the interactive terminal UI
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

Run the terminal UI. The default UI density is `compact`, so tool-heavy sessions stay readable:

```bash
npm run tui -- \
  --cwd /path/to/your/project \
  --model qwen2.5-coder:7b \
  --base-url http://localhost:11434/v1 \
  --api-key ollama \
  --ui-density compact
```

The TUI title shows the workspace, model, approval mode, and slash-command hints. `--context-size` defaults to `32768` and shows context usage in the title. Override it if your model has a different context window.

UI density presets:

| Preset | Tool cards | Reasoning | Use when |
| --- | --- | --- | --- |
| `compact` | collapsed | collapsed | Default. Best for long tool-heavy sessions. |
| `normal` | auto-collapsed | collapsed | Shows the latest active tool with more detail. |
| `debug` | full | full | Shows full tool input/output and reasoning. |

Override a preset when needed:

```bash
npm run tui -- --ui-density compact --tool-display auto-collapsed
```

TUI slash commands run locally and do not spend an LLM call:

| Command | Action |
| --- | --- |
| `/settings show` | Show active model, endpoint, approval, and step settings. |
| `/settings model <id>` | Switch the model for future turns. |
| `/settings base-url <url>` | Switch OpenAI-compatible endpoint for future turns. |
| `/settings api-key <key>` | Update the API key; use `none` to unset it. |
| `/settings approval safe\|auto` | Change approval mode without restarting the TUI. |
| `/settings max-steps <count>` | Change the model/tool loop step budget. |
| `/compact` | Drop slash-command chatter and prune older tool-heavy history for future turns. |

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
--max-steps <count>     Maximum model/tool loop steps. Default: 20.
--approval-mode <mode>  Approval mode: safe|auto. Default: safe.
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
--max-steps <count>          Maximum model/tool loop steps. Default: 20.
--approval-mode <mode>       Approval mode: safe|auto. Default: safe.
--auto-approve               Shortcut for --approval-mode auto.
--context-size <tokens>      Show context usage percentage in the TUI title. Default: 32768.
--ui-density <mode>          UI preset: compact|normal|debug. Default: compact.
--tool-display <mode>        Override tool cards: full|collapsed|auto-collapsed|hidden.
--reasoning-display <mode>   Override reasoning: full|collapsed|auto-collapsed|hidden.
-h, --help                   Show help.
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

- stable tool order: `search`, `read`, `update`, `write`, `bash`
- step logs with finish reason, tool names, token usage, and elapsed time
- targeted recovery hints after failed tool results
- automatic context compaction for long sessions

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
