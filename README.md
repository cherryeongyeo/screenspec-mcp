# screenspec-mcp

**Your screen spec in Figma becomes the single source of truth, for developers and their AI agents alike.**

`screenspec-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server that reads *screen spec* (화면정의서) frames in Figma and turns them into:

- **structured specs**: every element's PM policy and Design spec as JSON
- **lint reports**: what's still unwritten before hand-off, and where numbers or versions drift
- **Jira ticket drafts**: summary, acceptance criteria and Figma link, generated from the PM's policy

The goal: a developer opens Figma and has everything needed to build. No separate spec doc, no copy-pasting policy into tickets.

```
 PM writes policy ─┐
                   ├─► Figma screen spec ──► screenspec-mcp ──► Claude / Cursor / any MCP client
 Designer adds     ┘                              │
 visual spec                                      ├─ get_screen_spec   → JSON spec
                                                  ├─ lint_spec         → hand-off check
                                                  └─ draft_jira_ticket → ticket with AC
```

## Tools

| Tool | What it does |
|---|---|
| `list_screens` | Find every screen spec in a file or section (ID, title, version, status) |
| `get_screen_spec` | Full spec: header, overview, elements (PM + Design fields), feedback log, change log |
| `get_element` | One element by its badge number, with related feedback and a rendered image of the element card |
| `lint_spec` | Completeness % for PM / Design, unfilled fields, skipped element numbers, version vs change log mismatch |
| `draft_jira_ticket` | Ticket draft from an element's PM policy. State, Policy and Exception become acceptance criteria. The screen ID goes into labels so the Feedback Log can find the ticket later |

All tools are read-only. `draft_jira_ticket` doesn't create issues. Hand the draft to a Jira MCP (e.g. Atlassian's) in the same conversation, or paste it.

## Quick start

1. Create a Figma personal access token with `file_content:read` scope.
2. Add the server to your MCP client:

```json
{
  "mcpServers": {
    "screenspec": {
      "command": "npx",
      "args": ["-y", "screenspec-mcp"],
      "env": {
        "FIGMA_TOKEN": "figd_…",
        "SCREENSPEC_CONFIG": "/path/to/screenspec.config.json"
      }
    }
  }
}
```

3. Ask your agent:

> Lint the screen spec at https://www.figma.com/design/…?node-id=…  
> Draft a Jira ticket for element 1 of M-07, for API integration.

**No token yet?** Run against the bundled sample: `SCREENSPEC_FIXTURE=test/fixtures/sample-section.json npx screenspec-mcp`.

## The spec template

The parser follows layer names, not visual layout, so designers can restyle freely as long as names stay.

| Layer name | Meaning |
|---|---|
| `📄 <ID> <title> · 화면정의서` | A screen spec document (marker configurable) |
| `Doc Header` → `chip / [화면ID]`, `chip / v1.0`, instance `상태` | Screen ID, version, status variant |
| `개요` → `row / <label>` | Screen overview rows (purpose, entry path) |
| `ITEM / <n> / <name>` | One element card. `n` matches the badge on the mockup |
| `PM column` / `Design column` → `row / <label>` | Fields. First text is the label, the rest is the value |
| `feedback table` → `head`, `row / <JIRA-KEY>` → `cell n` | Feedback log synced from Jira |
| `변경 이력` → `row` | Change log: version, date, role, author, change |

Values still equal to the template's guide text count as **unfilled**. That's how `lint_spec` measures completeness.

## Configuration: public core, private settings

Everything team-specific lives in a JSON file outside the repo (`*.private.json` is git-ignored):

```json
{
  "ticket": {
    "projectKey": "DEMO",
    "defaultIssueType": "작업",
    "summaryTemplate": "[{ref}] {itemName} {intent}",
    "labels": ["screenspec"]
  },
  "feedback": { "doneStatuses": ["종료", "검수완료"] },
  "placeholders": ["extra guide text to treat as empty"]
}
```

See [`examples/screenspec.config.example.json`](examples/screenspec.config.example.json).

## Roadmap

- [x] **v0.1**: read-only parser, 5 tools, offline fixture mode
- [ ] **v0.2**: badge component on the mockup → element crop images; spec diff between versions
- [ ] **v0.3**: Jira adapter interface; link Jira issues to element nodes via Figma Dev Resources (visible in Dev Mode)
- [ ] **v0.4**: Figma plugin "Sync" button that refreshes the Feedback Log table from Jira (Jira → Figma, one way)
- [ ] **v1.0**: spec change → Jira sub-task suggestions, Slack notifications

## Development

```bash
npm install
npm run build
npm test                # parser, lint, ticket unit tests
node scripts/smoke.mjs  # spawns the server over stdio and calls every tool
```

---

### 한국어 요약

피그마 화면정의서를 개발의 단일 기준으로 만드는 MCP 서버예요. 기획자는 요소별 정책(기능·콘텐츠·Interaction·State·Policy·Exception)을, 디자이너는 Visual Spec을 피그마에 작성해요. 개발자는 AI 에이전트에게 "M-07 1번 요소 지라 티켓 초안 만들어줘"라고 하면 정책 기반의 완료 조건이 담긴 티켓을 받아요. 팀 고유 설정(Jira 프로젝트 키, 상태명 등)은 비공개 config로 분리했어요.

MIT © Chaeryeong Yeo
