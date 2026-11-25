# Marketing agent

An AI marketing strategist for **anything**: a product, an app, a local
business, an event, a creator, a cause. Tell it what to market and it builds
one complete campaign:

- a measurable goal, the audience, and the key message
- the strategy: which 2 to 4 channels and why
- a timeline (usually 2 to 4 weeks)
- ready-to-use content for each channel (posts, email, short-video scripts,
  ad copy, a poster), with image ideas
- how to measure it, and budget notes

Every campaign passes an honesty check, then waits for a human. Nothing is
published automatically.

```
build  ──►  honesty check  ──►  data/campaigns/pending  ──►  you approve/reject  ──►  export to outbox/
            (rules + a separate                              rejection reasons teach the next run
             Claude reviewer)
```

## Run it

**On your Claude plan (no API key): the Agent Console.** In `~/agent-console`,
run `npm start`, open http://localhost:4747, and choose *Marketing*. Type what to
market, add notes if you have them (dates, prices, links, who it's for), and
click *Build campaign*. Approve or reject it on the same page. Claude Code runs the
agent with only its MCP tools (`src/mcp.ts`) plus web search, and the honesty
reviewer runs through Claude Code too.

**With an Anthropic API key (it starts with `sk-ant-`): the command line.**

```bash
cd ~/marketing-agent
cp .env.example .env            # then paste your key after ANTHROPIC_API_KEY=
npm install

npm run plan -- "a Saturday pottery class for beginners in Leeds" --brief "starts March 8, £25, 10 spots"
npm run plan -- "a school bake sale" --no-web
npm run plan -- "PropertyShare" --brand property-share
npm run review        # approve or reject each campaign
npm run publish       # approved campaigns → outbox/<id>.md
npm run brands        # queue counts and the optional brand packs
```

## The honesty check

`submit_campaign` runs two checks, and a campaign must pass both to reach you:

1. **Fixed rules** (`src/compliance.ts`): phrases that are never acceptable for any
   subject ("guaranteed results", "risk-free", "get rich", miracle cures), channel
   length limits (X 280, SMS 160), and, when a brand pack is used, that brand's
   forbidden patterns and required disclosure. No model is involved.
2. **A separate Claude reviewer** with `core/compliance.md`. It reads the whole
   campaign once and fails it for invented facts (stats, reviews, testimonials,
   partners), guaranteed outcomes, unsupported health, legal or money claims,
   fake urgency, unfair claims about others, harmful content, undisclosed
   sponsorship, or a misleading overall impression. It never sees the drafting
   conversation, so the drafting agent can't argue it into a pass.

Failures go back to the agent with the reasons, and it rewrites. Every check
is logged to `data/campaigns/check-log.jsonl`.

## Brand packs (optional)

For an app you market often, a brand pack adds its own voice, facts and rules
to the campaign. Copy `brands/_template` to `brands/<id>`, fill in the files,
then choose it in the console or pass `--brand <id>`.

**PropertyShare** (`brands/property-share`) is a regulated brand: tokenized real
estate can count as a security. Its `claims-forbidden.md` is a conservative AI
draft that a securities lawyer should rewrite before any campaign mentions a
real offering.

## What's not built yet

- **Channel APIs.** Export writes Markdown to `outbox/` for you to post by hand. To
  post directly, add an adapter in `send()` in `src/publish.ts`.
- **Results.** Nothing pulls analytics back in yet. Rejection reasons are the
  agent's feedback for now.

The agent's instructions are in `.claude/agents/marketing-agent.md`. Both ways
of running it read that file.

## Settings (`.env`)

| Variable | Default |
|---|---|
| `ANTHROPIC_API_KEY` | only for the command-line path; must start with `sk-ant-` |
| `MARKETING_MODEL` | `claude-opus-5-5` |
| `MARKETING_EFFORT` | `medium` (`low` is cheaper, `high` is more thorough) |
