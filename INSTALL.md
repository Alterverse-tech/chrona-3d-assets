# Install Chrona 3D Assets

Install the `chrona` plugin from the `chrona-3d-assets` marketplace. The plugin exposes two Skills:

- `Chrona: Asset Center Library`
- `Chrona: 3D Character Workflow`

## Codex

```bash
codex plugin marketplace add Alterverse-tech/chrona-3d-assets --ref main --json
codex plugin add chrona@chrona-3d-assets --json
```

Verify:

```bash
codex plugin marketplace list --json
codex plugin list --json
```

## Claude Code

```bash
claude plugin marketplace add Alterverse-tech/chrona-3d-assets
claude plugin install chrona@chrona-3d-assets
```

Verify:

```bash
claude plugin marketplace list
claude plugin list
```

## Authentication

Installation does not require an Asset Center token. On first library or workflow use, Asset Center opens its OAuth authorization flow. Never paste service tokens into chat or source code.

Start a new Codex task or Claude Code session after installation so the new Skills and MCP tools are discovered.
