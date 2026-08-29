# Quickstart: spec CLI

## Setup
```bash
pnpm build          # compile dist/src + dist/hooks
```

## Validate `spec list`
```bash
# with specs present
node dist/bin/openwolf.js spec list
# →   001-spec-cli * active

# empty specs dir
mkdir -p specs && node dist/bin/openwolf.js spec list
# →   No specs. Run /specify first.   (exit 0)
```

## Validate `spec next` auto-complete
```bash
node dist/bin/openwolf.js spec set 001-spec-cli
# advance to tasks phase, write tasks.md with all tasks checked
node dist/bin/openwolf.js spec next
# →   All tasks checked. Status: complete
node dist/bin/openwolf.js spec status
# →   Status: complete
```

## Test
```bash
node --test tests/specs.test.ts
```
