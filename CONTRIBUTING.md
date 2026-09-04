# Contributing to OpenWolf

Thanks for your interest in contributing to OpenWolf. This guide covers how to get involved.

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/openwolf.git
   cd openwolf
   ```
3. Install dependencies:
   ```bash
   pnpm install
   ```
4. Build:
   ```bash
   pnpm build
   ```
5. Test your local build:
   ```bash
   node dist/bin/openwolf.js --help
   ```

## Development

### Project Structure

```
src/
├── cli/           CLI commands and program setup
├── daemon/        Background task scheduler (cron engine)
├── scanner/       Project structure scanner (anatomy.md)
├── tracker/       Token tracking and ledger
├── hooks/         Claude Code lifecycle hooks
├── dashboard/     React web dashboard (Vite + TailwindCSS)
├── buglog/        Bug memory system
├── utils/         Shared utilities
└── templates/     Files created by `openwolf init`
```

### Building

```bash
pnpm build           # Full build (TypeScript + hooks + dashboard)
pnpm dev             # Watch mode for TypeScript only
pnpm docs:dev        # Local docs site
```

### Key Files

- `src/cli/program/register.subclis.ts` — where CLI subcommands are registered
- `src/hooks/` — the 6 Claude Code lifecycle hook scripts
- `src/templates/` — files copied into `.wolf/` on `openwolf init`
- `src/utils/platform.ts` — platform detection (Windows/macOS/Linux)

## Making Changes

1. Create a branch: `git checkout -b my-change`
2. Make your changes
3. Build and verify: `pnpm build && node dist/bin/openwolf.js --help`
4. Commit with a clear message describing **what** and **why**
5. Push and open a pull request

## Pull Request Guidelines

- Keep PRs focused. One feature or fix per PR.
- Describe what your PR does and why in the description.
- If your change is platform-specific, note which platforms you tested on.
- Update `README.md` if you add or change commands.
- Update `src/templates/` if you change the `.wolf/` file structure.

## Reporting Bugs

Open an issue at [github.com/nottyjay/openwolf/issues](https://github.com/nottyjay/openwolf/issues) with:

- Your OS and Node.js version
- Claude Code version
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs (if any)

## Platform Notes

OpenWolf supports Windows, macOS, and Linux. Platform-specific code is centralized in `src/utils/platform.ts`. If your change involves process management, file paths, or shell commands, make sure it works across platforms or uses the platform utilities.

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0](LICENSE) license.
