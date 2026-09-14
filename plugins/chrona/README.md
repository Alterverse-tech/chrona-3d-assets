# Chrona

Chrona groups two Asset Center workflows under one plugin namespace while leaving the original standalone plugins available:

- `Chrona: Asset Center Library` uploads completed Character Workflow GLBs only after an explicit request, and searches, previews, selects, and imports published personal GLBs.
- `Chrona: 3D Character Workflow` creates, rigs, and animates human-biped characters, then stops when the base and action GLBs are complete.

Both Skills share one Chrona sign-in: the first Asset Center request from either Skill opens the OAuth flow once, and the cached tokens serve both MCP servers.

Install from the `chrona-3d-assets` marketplace:

```bash
codex plugin add chrona@chrona-3d-assets --json
```

The plugin loads in a new Codex task after installation.
