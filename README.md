# Harness Tools Prototype

A small TypeScript coding harness with five tools:

- `read` — reads files and directories inside the workspace.
- `search` — fast text search powered by ripgrep.
- `write` — creates or replaces files atomically.
- `update` — hash-guarded line updates for safe edits.
- `bash` — runs focused non-interactive commands.

The project includes:

- a CLI command for one-shot agent runs,
- an interactive terminal UI,
- an OpenAI-compatible model adapter,
- benchmarks and correctness checks.

## Requirements

- Node.js 20+
- npm
- Git
- Ollama, for local model usage

## Install from GitHub

```bash
git clone https://github.com/simpletoolsindia/agent.git
cd agent
npm install
npm run build
```

Check the CLI:

```bash
npm run cli -- --help
```

Expected commands:

```txt
harness ai   Run one OpenAI-compatible LLM request
harness tui  Open the interactive terminal UI
```

## Set up Ollama

Install Ollama from the official site:

```txt
https://ollama.com/download
```

On Linux, Ollama's install command is usually:

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Start Ollama if it is not already running:

```bash
ollama serve
```

Pull a model:

```bash
ollama pull qwen2.5-coder:7b
```

You can use another tool-capable model instead, for example:

```bash
ollama pull gpt-oss:20b
ollama pull qwen3:8b
```

Ollama exposes an OpenAI-compatible API at:

```txt
http://localhost:11434/v1
```

Ollama requires an API key field for OpenAI-compatible clients, but the value is ignored. Use `ollama`.

Quick API check:

```bash
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2.5-coder:7b",
    "messages": [{ "role": "user", "content": "Say hello" }],
    "stream": false
  }'
```

## Run one agent request with Ollama

Use the `ai` command:

```bash
npm run cli -- ai \
  --prompt "Read package.json and explain the scripts" \
  --model qwen2.5-coder:7b \
  --base-url http://localhost:11434/v1 \
  --api-key ollama
```

Use a different workspace:

```bash
npm run cli -- ai \
  --cwd /path/to/your/project \
  --prompt "Search for TODO comments and summarize them" \
  --model qwen2.5-coder:7b \
  --base-url http://localhost:11434/v1 \
  --api-key ollama
```

Allow file writes, updates, and bash commands without approval prompts:

```bash
npm run cli -- ai \
  --cwd /path/to/your/project \
  --prompt "Add a small README usage section" \
  --model qwen2.5-coder:7b \
  --base-url http://localhost:11434/v1 \
  --api-key ollama \
  --auto-approve
```

Use `--auto-approve` only in a disposable or trusted workspace.

## Run the interactive TUI with Ollama

```bash
npm run tui -- \
  --model qwen2.5-coder:7b \
  --base-url http://localhost:11434/v1 \
  --api-key ollama
```

With a target workspace:

```bash
npm run tui -- \
  --cwd /path/to/your/project \
  --model qwen2.5-coder:7b \
  --base-url http://localhost:11434/v1 \
  --api-key ollama
```

The TUI shows the assistant output, tool cards, reasoning sections, and approval prompts for unsafe tools unless `--auto-approve` is passed.

## Available CLI options

### `harness ai`

```txt
-p, --prompt <prompt>   user prompt to send to the AI
--cwd <path>            workspace root
--model <model>         model id
--base-url <url>        OpenAI-compatible API base URL
--api-key <key>         API key
--provider-name <name>  provider name for logs
--max-steps <count>     maximum tool loop steps
--auto-approve          allow write/update/bash tools without approval
-h, --help              display help for command
```

### `harness tui`

```txt
--cwd <path>            workspace root
--model <model>         model id
--base-url <url>        OpenAI-compatible API base URL
--api-key <key>         API key
--provider-name <name>  provider name for logs
--max-steps <count>     maximum tool loop steps
--auto-approve          allow write/update/bash tools without approval
-h, --help              display help for command
```

## Tool safety model

Default approval behavior:

| Tool | Reads data | Writes data | Approval |
| --- | --- | --- | --- |
| `read` | yes | no | not required |
| `search` | yes | no | not required |
| `write` | no | yes | required |
| `update` | no | yes | required |
| `bash` | depends | depends | required |

`update` is safer than blind replacement because it requires:

- the current file hash,
- the expected range hash,
- exact start and end lines,
- non-overlapping edit ranges.

If a file changes after the model reads it, `update` rejects the edit and asks the model to read again.

## Development commands

```bash
npm run build
npm run cli -- --help
npm run correctness
npm run benchmark
```

## Troubleshooting Ollama

### `ECONNREFUSED` or connection failed

Ollama is not running. Start it:

```bash
ollama serve
```

Then retry:

```bash
curl http://localhost:11434/v1/models
```

### Model not found

Pull the model:

```bash
ollama pull qwen2.5-coder:7b
```

Then retry the harness command.

### The model answers but does not use tools well

Use a stronger local model with tool-calling support:

```bash
ollama pull gpt-oss:20b
npm run cli -- ai \
  --prompt "Read package.json and summarize scripts" \
  --model gpt-oss:20b \
  --base-url http://localhost:11434/v1 \
  --api-key ollama
```

### TUI does not open cleanly

Use the one-shot CLI first:

```bash
npm run cli -- ai \
  --prompt "Read package.json and summarize scripts" \
  --model qwen2.5-coder:7b \
  --base-url http://localhost:11434/v1 \
  --api-key ollama
```

If that works, retry:

```bash
npm run tui -- \
  --model qwen2.5-coder:7b \
  --base-url http://localhost:11434/v1 \
  --api-key ollama
```

## OpenAI-compatible providers

The same harness can use any OpenAI-compatible API:

```bash
npm run cli -- ai \
  --prompt "Read package.json" \
  --model your-model-name \
  --base-url https://your-provider.example/v1 \
  --api-key "$API_KEY"
```

For OpenAI itself, omit `--base-url`:

```bash
npm run cli -- ai \
  --prompt "Read package.json" \
  --model gpt-4o-mini \
  --api-key "$OPENAI_API_KEY"
```
