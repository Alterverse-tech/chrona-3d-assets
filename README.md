# Chrona 3D Assets

The canonical source repository for Chrona's Codex and Claude Code 3D asset workflows.

## Plugin structure

```text
Chrona
├── Asset Center Library
└── Character Workflow
```

- `Chrona: Asset Center Library` searches, previews, selects, and imports published personal Asset Center GLBs.
- `Chrona: Character Workflow` creates, rigs, animates, and publishes human-biped characters.

The same `plugins/chrona` package contains:

- `.codex-plugin/plugin.json` and `.mcp.json` for Codex;
- `.claude-plugin/plugin.json` for Claude Code;
- shared Skill, MCP server, OAuth, and Asset Center sourcing-board source.

See [INSTALL.md](./INSTALL.md) for installation and verification commands.

## Repository boundaries

This repository is the source of truth for the `chrona` plugin. The legacy standalone plugins in `sharky-3d-assets` remain separate and are not modified by this repository.
